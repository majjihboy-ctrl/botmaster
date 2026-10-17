const { fillBotTemplate } = require('./_lib/bot-template');

// Valid Deriv synthetic index symbols this template supports (all live under
// MARKET_LIST=synthetic_index, SUBMARKET_LIST=random_index, same as the
// reference bot). Keeping this whitelist strict means the AI can never
// slot in a symbol string that doesn't actually exist on Deriv.
const VALID_SYMBOLS = [
    '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
];

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

async function extractParams(description) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set in environment variables');
    }

    const systemPrompt = `You extract trading bot parameters from a user's plain-English description of a Martingale/Accumulator strategy for Deriv.

Respond ONLY with a raw JSON object, no markdown fences, no preamble, no explanation. The JSON must have exactly these keys:
- "symbol": one of ${JSON.stringify(VALID_SYMBOLS)} (pick the closest match to what the user described; default to "1HZ100V" if unclear or unspecified)
- "growth_rate": one of ${JSON.stringify(VALID_GROWTH_RATES)} as a string (default "0.01" if unspecified)
- "take_profit": a positive number, the take-profit amount per trade in USD (default 10)
- "initial_stake": a positive number, the starting stake in USD (default 10)
- "martingale_size": a positive number, the stake step/increment used to grow the stake after a loss (default 10)
- "profit_threshold": a positive number, total profit at which the bot stops trading (default 10)
- "loss_threshold": a positive number, total loss at which the bot stops trading (default 10)

If the user's description doesn't mention a value, use the default. Never invent a symbol not in the allowed list.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 500,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: description },
            ],
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const messageContent = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!messageContent) {
        throw new Error('No text response from model');
    }

    const cleaned = messageContent.replace(/```json|```/g, '').trim();
    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (e) {
        throw new Error('Could not parse model response as JSON');
    }

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

        const params = await extractParams(description);
        const xml = fillBotTemplate(params);

        res.status(200).json({ xml, params });
    } catch (err) {
        console.error('generate-bot error:', err);
        res.status(500).json({ error: (err && err.message) || 'Failed to generate bot' });
    }
};
