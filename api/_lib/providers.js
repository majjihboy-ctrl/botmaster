// Calls the AI providers with a normal multi-turn conversation.
//
// Providers are tried in order, automatically: Gemini first (free tier available), then xAI Grok.
// A provider with no key is skipped; if one fails (quota, no credits, outage) the next is tried.
// Set AI_PROVIDER=xai to try xAI first instead.
//
// Plain CommonJS so Vercel's Node runtime never has to guess the module system.

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

async function callGeminiModel(model, apiKey, system, messages) {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: messages.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }],
                })),
                generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
            }),
        }
    );

    if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`Gemini API error (${model}): ${response.status} ${errText}`);
        err.status = response.status;
        throw err;
    }

    const data = await response.json();
    const parts =
        data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    return parts ? parts.map(p => p.text || '').join('') : '';
}

async function callGemini(system, messages) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set in environment variables');

    const failures = [];
    for (const model of geminiModelOrder()) {
        try {
            const text = await callGeminiModel(model, apiKey, system, messages);
            if (text) return text;
            failures.push(`${model}: empty response`);
        } catch (err) {
            const status = err && err.status;
            const retryable = status === 404 || status === 429 || (status >= 500 && status < 600);
            console.error(`ai-chat: gemini model ${model} failed:`, err && err.message);
            failures.push((err && err.message) || `${model} failed`);
            if (!retryable) break;
        }
    }
    throw new Error(failures.join(' | '));
}

// xAI (Grok) exposes an OpenAI-compatible chat completions endpoint.
async function callXai(system, messages) {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) throw new Error('XAI_API_KEY is not set in environment variables');

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: process.env.XAI_MODEL || 'grok-latest',
            temperature: 0.7,
            max_tokens: 8192,
            messages: [{ role: 'system', content: system }, ...messages],
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`xAI API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    return data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
}

// messages: [{ role: 'user' | 'assistant', content }], starting and ending with a user message.
async function chat(system, messages) {
    const providers = providerOrder();
    if (providers.length === 0) {
        throw new Error('No AI key set: add GEMINI_API_KEY (free) or XAI_API_KEY in the environment variables');
    }

    const errors = [];
    for (const name of providers) {
        try {
            const text = name === 'gemini' ? await callGemini(system, messages) : await callXai(system, messages);
            if (text) return text;
            errors.push(`${name}: empty response`);
        } catch (err) {
            console.error(`ai-chat: ${name} failed:`, err && err.message);
            errors.push((err && err.message) || `${name} failed`);
        }
    }

    const skipped = [];
    if (!process.env.GEMINI_API_KEY) skipped.push('GEMINI_API_KEY is not set, so Gemini was not tried');
    if (!process.env.XAI_API_KEY) skipped.push('XAI_API_KEY is not set, so xAI was not tried');
    throw new Error(`${errors.join(' | ')}${skipped.length ? ` (${skipped.join('; ')})` : ''}`);
}

module.exports = { chat, providerOrder };
