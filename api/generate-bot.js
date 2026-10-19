const { checkAccess } = require('./_lib/access');
const { generateBot } = require('./_lib/pipeline');
const { RESPONSE_SCHEMA } = require('./_lib/prompt');

// Providers are tried in order, automatically: Gemini first (free tier available), then xAI Grok.
// A provider with no key is skipped; if one fails (quota, no credits, outage) the next is tried.
// Set AI_PROVIDER=xai to try xAI first instead.
function providerOrder() {
    const order = (process.env.AI_PROVIDER || '').toLowerCase() === 'xai' ? ['xai', 'gemini'] : ['gemini', 'xai'];
    return order.filter(name => (name === 'gemini' ? process.env.GEMINI_API_KEY : process.env.XAI_API_KEY));
}

// Gemini models to try, in order. GEMINI_MODEL (if set) is tried first. A model that is gone for this
// key (404) or temporarily limited/unavailable (429, 5xx) falls through to the next one; auth or
// bad-request errors (400/401/403) stop immediately because another model will not fix them.
const GEMINI_DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

function geminiModelOrder() {
    const configured = (process.env.GEMINI_MODEL || '')
        .split(',')
        .map(m => m.trim())
        .filter(Boolean);
    return [...new Set([...configured, ...GEMINI_DEFAULT_MODELS])];
}

async function callGeminiModel(model, apiKey, systemPrompt, description, useSchema = true) {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: description }] }],
                generationConfig: {
                    temperature: 0,
                    responseMimeType: 'application/json',
                    ...(useSchema ? { responseSchema: RESPONSE_SCHEMA } : {}),
                },
            }),
        }
    );

    if (!response.ok) {
        const errText = await response.text();
        // A schema the model rejects (400) must not cost the whole request: retry the same model without it.
        if (response.status === 400 && useSchema) {
            return callGeminiModel(model, apiKey, systemPrompt, description, false);
        }
        const err = new Error(`Gemini API error (${model}): ${response.status} ${errText}`);
        err.status = response.status;
        throw err;
    }

    const data = await response.json();
    const parts =
        data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    return parts ? parts.map(p => p.text || '').join('') : '';
}

async function callGemini(systemPrompt, description) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set in environment variables');

    const failures = [];
    for (const model of geminiModelOrder()) {
        try {
            const text = await callGeminiModel(model, apiKey, systemPrompt, description);
            if (text) return text;
            failures.push(`${model}: empty response`);
        } catch (err) {
            const status = err && err.status;
            const retryable = status === 404 || status === 429 || (status >= 500 && status < 600);
            console.error(`generate-bot: gemini model ${model} failed:`, err && err.message);
            failures.push((err && err.message) || `${model} failed`);
            if (!retryable) break;
        }
    }
    throw new Error(failures.join(' | '));
}

// xAI (Grok) exposes an OpenAI-compatible chat completions endpoint.
async function callXai(systemPrompt, description) {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) throw new Error('XAI_API_KEY is not set in environment variables');

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: process.env.XAI_MODEL || 'grok-latest',
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: description },
            ],
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`xAI API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    return data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
}

async function callModel(systemPrompt, description) {
    const providers = providerOrder();
    if (providers.length === 0) {
        throw new Error('No AI key set: add GEMINI_API_KEY (free) or XAI_API_KEY in the environment variables');
    }

    const errors = [];
    for (const name of providers) {
        try {
            const text =
                name === 'gemini'
                    ? await callGemini(systemPrompt, description)
                    : await callXai(systemPrompt, description);
            if (text) return text;
            errors.push(`${name}: empty response`);
        } catch (err) {
            console.error(`generate-bot: ${name} failed:`, err && err.message);
            errors.push((err && err.message) || `${name} failed`);
        }
    }

    const skipped = [];
    if (!process.env.GEMINI_API_KEY) skipped.push('GEMINI_API_KEY is not set, so Gemini was not tried');
    if (!process.env.XAI_API_KEY) skipped.push('XAI_API_KEY is not set, so xAI was not tried');
    throw new Error(`${errors.join(' | ')}${skipped.length ? ` (${skipped.join('; ')})` : ''}`);
}

// Best-effort per-IP rate limit (in-memory, per serverless instance). It will not stop a distributed
// flood, but it stops a single client from burning the Gemini / xAI quota with a loop.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;
const rateBuckets = new Map();

function clientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    return forwarded || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function isRateLimited(ip) {
    const now = Date.now();
    const recent = (rateBuckets.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    recent.push(now);
    rateBuckets.set(ip, recent);
    if (rateBuckets.size > 5000) {
        for (const [key, times] of rateBuckets) {
            if (!times.some(t => now - t < RATE_LIMIT_WINDOW_MS)) rateBuckets.delete(key);
        }
    }
    return recent.length > RATE_LIMIT_MAX;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    if (isRateLimited(clientIp(req))) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
        return;
    }

    try {
        // Private: only accounts listed in AI_ALLOWED_ACCOUNTS (verified through Deriv) may generate bots.
        const access = await checkAccess(req);
        if (!access.ok) {
            res.status(access.status).json({ error: access.error });
            return;
        }

        const description = ((req.body && req.body.description) || '').trim();

        if (!description) {
            res.status(400).json({ error: 'Description is required' });
            return;
        }
        if (description.length > 2000) {
            res.status(400).json({ error: 'Description is too long (max 2000 characters)' });
            return;
        }

        // Optional: the bot being refined ("make the stake smaller"). Only plain, small JSON is accepted.
        let previous;
        const incoming = req.body && req.body.previous;
        if (incoming && typeof incoming === 'object' && incoming.params && typeof incoming.params === 'object') {
            if (JSON.stringify(incoming).length <= 6000)
                previous = { strategy: incoming.strategy, params: incoming.params };
        }

        const { strategy, params, xml, summary, notes } = await generateBot({
            description,
            previous: previous && { ...previous.params, strategy: previous.strategy },
            ask: callModel,
        });

        res.status(200).json({ xml, params, strategy, summary, notes: notes || [] });
    } catch (err) {
        console.error('generate-bot error:', err);
        res.status(500).json({ error: (err && err.message) || 'Failed to generate bot' });
    }
};
