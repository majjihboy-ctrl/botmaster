// From the model's JSON answer to a finished bot: parse -> validate -> clamp -> build XML -> static
// XML check, with up to MAX_ATTEMPTS tries where the model is told exactly what was wrong.
//
// Plain CommonJS so Vercel's Node runtime never has to guess the module system.

const { fillBotTemplate } = require('./bot-template');
const { VALID_SYMBOLS } = require('./strategy-templates');
const { SPEC_STRATEGIES, normalizeSpec, validateRaw } = require('./bot-spec');
const { buildAdvancedXml, describeSpec } = require('./advanced-bot');
const { validateBotXml } = require('./validate-xml');
const { buildSystemPrompt, VALID_GROWTH_RATES } = require('./prompt');

const MAX_ATTEMPTS = 3;
const ALL_STRATEGIES = ['accumulator', ...SPEC_STRATEGIES];

const ACCUMULATOR_DEFAULTS = {
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

function accumulatorParams(parsed) {
    const symbol = VALID_SYMBOLS.includes(parsed.symbol) ? parsed.symbol : ACCUMULATOR_DEFAULTS.symbol;
    const growth_rate = VALID_GROWTH_RATES.includes(String(parsed.growth_rate))
        ? String(parsed.growth_rate)
        : ACCUMULATOR_DEFAULTS.growth_rate;
    return {
        strategy: 'accumulator',
        symbol,
        growth_rate,
        take_profit: clampPositiveNumber(parsed.take_profit, ACCUMULATOR_DEFAULTS.take_profit),
        initial_stake: clampPositiveNumber(parsed.initial_stake, ACCUMULATOR_DEFAULTS.initial_stake),
        martingale_size: clampPositiveNumber(parsed.martingale_size, ACCUMULATOR_DEFAULTS.martingale_size),
        profit_threshold: clampPositiveNumber(parsed.profit_threshold, ACCUMULATOR_DEFAULTS.profit_threshold),
        loss_threshold: clampPositiveNumber(parsed.loss_threshold, ACCUMULATOR_DEFAULTS.loss_threshold),
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

function parseModelJson(text) {
    const raw = String(text || '')
        .replace(/```json|```/g, '')
        .trim();
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    const cleaned = first !== -1 && last > first ? raw.slice(first, last + 1) : raw;
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error('Could not parse model response as JSON');
    }
}

// Pure, synchronous: whatever object comes in, either a valid bot comes out or `errors` says why not.
function compileBot(parsed) {
    const input = parsed && typeof parsed === 'object' ? { ...parsed } : parsed;
    if (input && input.strategy === 'over_under_switch') input.strategy = 'over_under'; // legacy id

    const issues = validateRaw(input, ALL_STRATEGIES);
    if (issues.length) return { errors: issues };

    if (input.strategy === 'accumulator') {
        const params = accumulatorParams(input);
        const xml = fillBotTemplate(params);
        const errors = validateBotXml(xml, { strict: false });
        return { errors, strategy: 'accumulator', params, xml, summary: accumulatorSummary(params), notes: [] };
    }

    const { spec, notes } = normalizeSpec(input);
    const xml = buildAdvancedXml(spec);
    const errors = validateBotXml(xml);
    return { errors, strategy: spec.strategy, params: spec, xml, summary: describeSpec(spec), notes };
}

// `ask(systemPrompt, userText)` returns the model's raw text and throws if no provider is reachable.
async function generateBot({ description, previous, ask }) {
    const system = buildSystemPrompt(previous);
    let feedback = '';

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const userText = feedback
            ? `${description}\n\nYour previous answer was rejected: ${feedback}\nReturn only the corrected JSON object.`
            : description;
        const text = await ask(system, userText);

        let parsed;
        try {
            parsed = parseModelJson(text);
        } catch (e) {
            feedback = 'it was not valid JSON.';
            continue;
        }

        const result = compileBot(parsed);
        if (result.errors.length === 0) return result;
        feedback = result.errors.slice(0, 5).join(' ');
    }

    if (previous) {
        const kept = compileBot(previous.params ? { ...previous.params, strategy: previous.strategy } : previous);
        if (kept.errors.length === 0) {
            return {
                ...kept,
                notes: ["I couldn't apply that change safely, so your bot is unchanged. Try rephrasing it."],
            };
        }
    }
    throw new Error("The AI couldn't produce a valid bot for that request. Try describing it a little differently.");
}

module.exports = { generateBot, compileBot, parseModelJson, ALL_STRATEGIES, MAX_ATTEMPTS };
