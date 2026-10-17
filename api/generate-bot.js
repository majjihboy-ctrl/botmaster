const { fillBotTemplate } = require('./_lib/bot-template');
const {
    STRATEGY_IDS,
    VALID_SYMBOLS,
    normalizeStrategyParams,
    buildStrategyXml,
    describeParams,
} = require('./_lib/strategy-templates');

// Accumulator growth rate only accepts these five values on Deriv.
const VALID_GROWTH_RATES = ['0.01', '0.02', '0.03', '0.04', '0.05'];

const DEFAULTS = {
    symbol: '1HZ100V',
    growth_rate: '0.01',
    take_profit: 10,
    initial_stake: 10,
    martingale_size: 10,
    profit_threshold: 10,
    loss_threshold: 10,
};

function clampPositiveNumber(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.round(n * 100) / 100;
}

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

async function callGeminiModel(model, apiKey, systemPrompt, description) {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: description }] }],
                generationConfig: { temperature: 0, responseMimeType: 'application/json' },
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
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
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
            const text = name === 'gemini' ? await callGemini(systemPrompt, description) : await callXai(systemPrompt, description);
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

const ALL_STRATEGIES = ['accumulator', ...STRATEGY_IDS];

function buildSystemPrompt() {
    return `You turn a user's plain-English description of a Deriv trading bot into JSON settings. You do not write bot code.

Respond ONLY with a raw JSON object, no markdown fences, no preamble, no explanation.

"strategy" must be one of ${JSON.stringify(ALL_STRATEGIES)}:
- "accumulator": accumulator contracts with a growth rate. Use it when the user mentions accumulator or growth rate, or names no strategy at all.
- "rise_fall": rise/fall (call/put, higher/lower) contracts.
- "even_odd": digit even/odd contracts.
- "over_under": digit over/under contracts (needs a "prediction" digit).
- "matches_differs": digit matches/differs contracts (needs a "prediction" digit).

Always include:
- "strategy"
- "symbol": one of ${JSON.stringify(VALID_SYMBOLS)} (closest match to what the user described; default "1HZ100V")
- "initial_stake": starting stake in USD (default 1 for non-accumulator, 10 for accumulator)
- "take_profit": positive number in USD

If strategy is "accumulator", also include:
- "growth_rate": one of ${JSON.stringify(VALID_GROWTH_RATES)} as a string (default "0.01")
- "martingale_size": the stake step added after a loss (default 10)
- "profit_threshold": total profit at which the bot stops (default 10)
- "loss_threshold": total loss at which the bot stops (default 10)
For accumulator, "take_profit" is the take-profit per trade (default 10).

For every other strategy, also include:
- "direction": for rise_fall "rise" or "fall"; even_odd "even" or "odd"; over_under "over" or "under"; matches_differs "differs" or "matches"
- "prediction": the digit 0-9 (only for over_under and matches_differs; over accepts 0-8, under accepts 1-9)
- "duration_ticks": whole number of ticks per trade (rise_fall 5-10, others 1-10)
- "martingale_multiplier": how much the stake is multiplied after a loss (2 = double, 1 = no martingale; default 2)
- "take_profit": total profit in USD at which the bot stops (default 10)
- "stop_loss": total loss in USD at which the bot stops (default 10)

If the user does not mention a value, use the default. Never invent a symbol or strategy outside the allowed lists.

Examples:
"Volatility 100 index, 2% growth rate, stop at $20 profit or $15 loss" ->
{"strategy":"accumulator","symbol":"R_100","growth_rate":"0.02","take_profit":10,"initial_stake":10,"martingale_size":10,"profit_threshold":20,"loss_threshold":15}
"Rise on Volatility 75, 5 ticks, stake $2, double after a loss, stop at $30 profit or $20 loss" ->
{"strategy":"rise_fall","symbol":"R_75","direction":"rise","duration_ticks":5,"initial_stake":2,"martingale_multiplier":2,"take_profit":30,"stop_loss":20}
"Even digits on the 1 second Volatility 10 index, $1 stake, x2 martingale" ->
{"strategy":"even_odd","symbol":"1HZ10V","direction":"even","duration_ticks":1,"initial_stake":1,"martingale_multiplier":2,"take_profit":10,"stop_loss":10}
"Digit over 3 on Volatility 100, stake 0.5, stop at 5 profit" ->
{"strategy":"over_under","symbol":"R_100","direction":"over","prediction":3,"duration_ticks":1,"initial_stake":0.5,"martingale_multiplier":2,"take_profit":5,"stop_loss":10}
"Differs 7 on Volatility 50, no martingale" ->
{"strategy":"matches_differs","symbol":"R_50","direction":"differs","prediction":7,"duration_ticks":1,"initial_stake":1,"martingale_multiplier":1,"take_profit":10,"stop_loss":10}`;
}

function parseModelJson(text) {
    const raw = String(text || '').replace(/```json|```/g, '').trim();
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    const cleaned = first !== -1 && last > first ? raw.slice(first, last + 1) : raw;
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error('Could not parse model response as JSON');
    }
}

function accumulatorParams(parsed) {
    // Validate + sanitize every field against strict whitelists/ranges.
    const symbol = VALID_SYMBOLS.includes(parsed.symbol) ? parsed.symbol : DEFAULTS.symbol;
    const growth_rate = VALID_GROWTH_RATES.includes(String(parsed.growth_rate))
        ? String(parsed.growth_rate)
        : DEFAULTS.growth_rate;

    return {
        symbol,
        growth_rate,
        take_profit: clampPositiveNumber(parsed.take_profit, DEFAULTS.take_profit),
        initial_stake: clampPositiveNumber(parsed.initial_stake, DEFAULTS.initial_stake),
        martingale_size: clampPositiveNumber(parsed.martingale_size, DEFAULTS.martingale_size),
        profit_threshold: clampPositiveNumber(parsed.profit_threshold, DEFAULTS.profit_threshold),
        loss_threshold: clampPositiveNumber(parsed.loss_threshold, DEFAULTS.loss_threshold),
    };
}

function accumulatorSummary(p) {
    return [
        ['Strategy', 'Accumulator'],
        ['Symbol', p.symbol],
        ['Growth rate', `${Math.round(Number(p.growth_rate) * 100)}%`],
        ['Initial stake', `$${p.initial_stake}`],
        ['Stake step', `$${p.martingale_size}`],
        ['Take profit', `$${p.take_profit}`],
        ['Stop at profit', `$${p.profit_threshold}`],
        ['Stop at loss', `$${p.loss_threshold}`],
    ];
}

// Returns { strategy, params, xml, summary } for whatever the user described.
async function generateBot(description) {
    const parsed = parseModelJson(await callModel(buildSystemPrompt(), description));

    // An unknown or missing strategy falls back to Accumulator, the original behaviour.
    const strategy = ALL_STRATEGIES.includes(parsed.strategy) ? parsed.strategy : 'accumulator';

    if (strategy === 'accumulator') {
        const params = accumulatorParams(parsed);
        return { strategy, params, xml: fillBotTemplate(params), summary: accumulatorSummary(params) };
    }

    const params = normalizeStrategyParams(strategy, parsed);
    return { strategy, params, xml: buildStrategyXml(strategy, params), summary: describeParams(params) };
}

// Plain Vercel serverless function handler (CommonJS — this project is a
// static Rsbuild/React Router SPA, not Next.js, and the earlier TypeScript
// version with ESM `import` syntax crashed at runtime because Node tried to
// load the compiled output as CommonJS. Plain require/module.exports avoids
// that ambiguity entirely).
module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const description = ((req.body && req.body.description) || '').trim();

        if (!description) {
            res.status(400).json({ error: 'Description is required' });
            return;
        }
        if (description.length > 2000) {
            res.status(400).json({ error: 'Description is too long (max 2000 characters)' });
            return;
        }

        const { strategy, params, xml, summary } = await generateBot(description);

        res.status(200).json({ xml, params, strategy, summary });
    } catch (err) {
        console.error('generate-bot error:', err);
        res.status(500).json({ error: (err && err.message) || 'Failed to generate bot' });
    }
};
