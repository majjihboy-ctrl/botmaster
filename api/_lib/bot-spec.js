// Spec for the AI Bot Builder.
//
// The AI never writes Blockly XML. It returns a small JSON "spec"; normalizeSpec() clamps every field
// to values Deriv and the bot engine accept (recording what it changed in `notes`), and
// advanced-bot.js turns the clean spec into XML from tested building blocks.
//
// Plain CommonJS so Vercel's Node runtime never has to guess the module system.

const { STRATEGIES, VALID_SYMBOLS } = require('./strategy-templates');

const MIN_STAKE = 0.35; // Deriv's minimum stake

const SPEC_STRATEGIES = ['rise_fall', 'even_odd', 'over_under', 'matches_differs'];
const STAKE_MODES = ['martingale', 'dalembert', 'fibonacci', 'flat'];
const ENTRY_TYPES = [
    'none',
    'last_digit',
    'last_digits',
    'digit_percent',
    'parity_percent',
    'direction',
    'rsi',
    'sma',
    'ema',
    'price',
];
const INDICATOR_TYPES = ['rsi', 'sma', 'ema']; // each needs its own calculated variable, so one of each at most
const MAX_ENTRIES = 3;

// Over accepts digits 0-8, Under accepts 1-9 (Deriv rejects the others); matches/differs take 0-9.
const DIGIT_RANGE = { over: [0, 8, 2], under: [1, 9, 7], differs: [0, 9, 5], matches: [0, 9, 5] };

const DEFAULTS = {
    symbol: '1HZ100V',
    initial_stake: 1,
    martingale_multiplier: 2,
    stake_step: 1,
    take_profit: 10,
    stop_loss: 10,
};

// Short comparison words / symbols the model might use -> the block option names.
const COMPARE_OPS = {
    EQ: 'EQ',
    '=': 'EQ',
    '==': 'EQ',
    EQUAL: 'EQ',
    NEQ: 'NEQ',
    '!=': 'NEQ',
    NOT_EQUAL: 'NEQ',
    LT: 'LT',
    '<': 'LT',
    LESS: 'LT',
    LTE: 'LTE',
    '<=': 'LTE',
    LEQ: 'LTE',
    GT: 'GT',
    '>': 'GT',
    GREATER: 'GT',
    GTE: 'GTE',
    '>=': 'GTE',
    GEQ: 'GTE',
};
// last_digits_condition uses its own option names.
const DIGITS_CONDITION = { EQ: 'EQ', NEQ: 'NEQ', LT: 'LESS', LTE: 'LEQ', GT: 'GREATER', GTE: 'GEQ' };

const round2 = n => Math.round(n * 100) / 100;

function intIn(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (value === undefined || value === null || value === '' || !Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function numIn(value, min, max, fallback) {
    const n = Number(value);
    if (value === undefined || value === null || value === '' || !Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, round2(n)));
}

const provided = v => v !== undefined && v !== null && v !== '';

function normalizeOp(value, fallback) {
    const key = String(value === undefined || value === null ? '' : value)
        .trim()
        .toUpperCase()
        .replace(/[ -]/g, '_');
    return COMPARE_OPS[key] || fallback;
}

function normalizeLeg(strategyId, rawLeg, fallbackDirection, notes, label) {
    const spec = STRATEGIES[strategyId];
    const leg = rawLeg && typeof rawLeg === 'object' ? rawLeg : {};
    const direction = Object.prototype.hasOwnProperty.call(spec.directions, leg.direction)
        ? leg.direction
        : fallbackDirection;
    if (provided(leg.direction) && direction !== leg.direction) {
        notes.push(`${label}: "${leg.direction}" is not a ${spec.label} option, used ${direction}.`);
    }
    const out = { direction };
    if (spec.prediction || spec.switching) {
        const [min, max, fallback] = DIGIT_RANGE[direction] || [0, 9, 5];
        const raw = provided(leg.digit) ? leg.digit : leg.prediction;
        out.digit = intIn(raw, min, max, fallback);
        if (provided(raw) && Number(raw) !== out.digit) {
            notes.push(`${label}: digit ${raw} is not allowed for ${direction}, used ${out.digit}.`);
        }
    }
    return out;
}

function normalizeLegs(strategyId, rawLegs, fallbackDirection, notes, label) {
    if (!Array.isArray(rawLegs)) return [];
    return rawLegs
        .slice(0, 2)
        .map((leg, i) => normalizeLeg(strategyId, leg, fallbackDirection, notes, `${label} ${i + 1}`));
}

function normalizeEntry(raw, strategyId, notes) {
    const none = { type: 'none', apply: 'always' };
    if (!raw || typeof raw !== 'object') return none;
    const type = String(raw.type || 'none');
    if (!ENTRY_TYPES.includes(type) || type === 'none') return none;
    const apply = raw.apply === 'after_loss' ? 'after_loss' : 'always';

    switch (type) {
        case 'last_digit':
            return { type, apply, op: normalizeOp(raw.op, 'EQ'), digit: intIn(raw.digit, 0, 9, 0) };
        case 'last_digits': {
            const op = DIGITS_CONDITION[normalizeOp(raw.op, 'LT')];
            return { type, apply, count: intIn(raw.count, 1, 20, 2), op, digit: intIn(raw.digit, 0, 9, 5) };
        }
        case 'digit_percent': {
            const side = raw.side === 'under' ? 'under' : 'over';
            return {
                type,
                apply,
                side,
                digit: intIn(raw.digit, 0, 9, side === 'over' ? 4 : 5),
                ticks: intIn(raw.ticks, 10, 1000, 100),
                min_percent: intIn(raw.min_percent, 1, 100, 60),
            };
        }
        case 'parity_percent':
            return {
                type,
                apply,
                parity: raw.parity === 'odd' ? 'odd' : 'even',
                ticks: intIn(raw.ticks, 10, 1000, 100),
                min_percent: intIn(raw.min_percent, 1, 100, 60),
            };
        case 'direction':
            return { type, apply, direction: raw.direction === 'fall' ? 'fall' : 'rise' };
        case 'rsi':
            return {
                type,
                apply,
                period: intIn(raw.period, 2, 50, 14),
                op: normalizeOp(raw.op, 'LT') === 'GT' ? 'GT' : 'LT',
                level: intIn(raw.level, 1, 99, 30),
            };
        case 'sma':
        case 'ema':
            return {
                type,
                apply,
                period: intIn(raw.period, 2, 100, 20),
                op: normalizeOp(raw.op, 'GT') === 'LT' ? 'LT' : 'GT',
            };
        case 'price':
            return {
                type,
                apply,
                op: normalizeOp(raw.op, 'GT') === 'LT' ? 'LT' : 'GT',
                value: numIn(raw.value, 0.0001, 100000000, 1000),
            };
        default:
            notes.push(`Entry "${type}" is not supported; trading every run instead.`);
            return none;
    }
}

// Problems that need the model to try again (wrong shape / unknown ids), as opposed to numbers that
// can simply be clamped. Returns a list of plain-English issues.
function validateRaw(raw, allowedStrategies) {
    const issues = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['The answer must be one JSON object.'];
    if (!allowedStrategies.includes(raw.strategy)) {
        issues.push(`"strategy" must be one of ${JSON.stringify(allowedStrategies)}.`);
    }
    const listed = [raw.entry, ...(Array.isArray(raw.entries) ? raw.entries : [])];
    if (raw.entries !== undefined && !Array.isArray(raw.entries))
        issues.push('"entries" must be an array of conditions.');
    for (const e of listed) {
        if (e && typeof e === 'object' && e.type && !ENTRY_TYPES.includes(e.type)) {
            issues.push(`entry type "${e.type}" is not allowed; use one of ${JSON.stringify(ENTRY_TYPES)}.`);
        }
    }
    if (raw.stake_mode !== undefined && !STAKE_MODES.includes(raw.stake_mode)) {
        issues.push(`"stake_mode" must be one of ${JSON.stringify(STAKE_MODES)}.`);
    }
    return issues;
}

function normalizeSpec(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const strategyId = SPEC_STRATEGIES.includes(input.strategy) ? input.strategy : null;
    if (!strategyId) throw new Error(`Unknown strategy: ${input.strategy}`);
    const strategy = STRATEGIES[strategyId];
    const notes = [];

    const symbol = VALID_SYMBOLS.includes(input.symbol) ? input.symbol : DEFAULTS.symbol;
    if (provided(input.symbol) && symbol !== input.symbol)
        notes.push(`Symbol "${input.symbol}" is not available, used ${symbol}.`);

    // Base contract(s): explicit legs, or one leg from direction/prediction.
    let base = normalizeLegs(strategyId, input.base_legs, strategy.default_direction, notes, 'Trade');
    if (base.length === 0) {
        base = [
            normalizeLeg(
                strategyId,
                { direction: input.direction, digit: input.prediction },
                strategy.default_direction,
                notes,
                'Trade'
            ),
        ];
    }

    // Contract(s) to trade after a loss, until the next win.
    let recovery = normalizeLegs(strategyId, input.recovery_legs, strategy.default_direction, notes, 'Recovery');
    if (recovery.length === 0 && input.recovery && typeof input.recovery === 'object') {
        recovery = [normalizeLeg(strategyId, input.recovery, strategy.default_direction, notes, 'Recovery')];
    }

    const duration = intIn(input.duration_ticks, strategy.min_ticks, strategy.max_ticks, strategy.default_ticks);
    if (provided(input.duration_ticks) && Number(input.duration_ticks) !== duration) {
        notes.push(`${strategy.label} runs ${strategy.min_ticks}-${strategy.max_ticks} ticks, used ${duration}.`);
    }

    const initial_stake = Math.max(MIN_STAKE, numIn(input.initial_stake, 0, 100000, DEFAULTS.initial_stake));
    if (provided(input.initial_stake) && Number(input.initial_stake) < MIN_STAKE) {
        notes.push(`Stake raised to Deriv's minimum of $${MIN_STAKE}.`);
    }

    const stake_mode = STAKE_MODES.includes(input.stake_mode) ? input.stake_mode : 'martingale';
    const martingale_multiplier = numIn(input.martingale_multiplier, 1, 10, DEFAULTS.martingale_multiplier);
    if (provided(input.martingale_multiplier) && Number(input.martingale_multiplier) > 10) {
        notes.push('Martingale multiplier is capped at x10.');
    }

    // Entry conditions: "entries" (preferred) or a single "entry". Up to MAX_ENTRIES, all required ("all")
    // or any one ("any"). Only one condition per indicator, because each indicator owns one variable.
    const rawEntries = Array.isArray(input.entries) ? input.entries : input.entry ? [input.entry] : [];
    const entries = [];
    const seenIndicators = new Set();
    for (const raw of rawEntries.slice(0, MAX_ENTRIES + 2)) {
        const entry = normalizeEntry(raw, strategyId, notes);
        if (entry.type === 'none') continue;
        if (INDICATOR_TYPES.includes(entry.type)) {
            if (seenIndicators.has(entry.type)) {
                notes.push(
                    `Only one ${entry.type.toUpperCase()} condition is supported per bot, the extra one was left out.`
                );
                continue;
            }
            seenIndicators.add(entry.type);
        }
        if (entries.length < MAX_ENTRIES) entries.push(entry);
    }
    const unsupported = (Array.isArray(input.unsupported) ? input.unsupported : [])
        .filter(t => typeof t === 'string' && t.trim())
        .slice(0, 5)
        .map(t => t.trim().slice(0, 120));
    if (unsupported.length) notes.push(`Not supported yet, so not included: ${unsupported.join('; ')}.`);

    const spec = {
        strategy: strategyId,
        symbol,
        base_legs: base,
        recovery_legs: recovery,
        duration_ticks: duration,
        entry: entries[0] || { type: 'none', apply: 'always' },
        extra_entries: entries.slice(1),
        entry_logic: input.entry_logic === 'any' ? 'any' : 'all',
        initial_stake,
        stake_mode,
        martingale_multiplier,
        stake_step: Math.max(MIN_STAKE, numIn(input.stake_step, 0, 100000, DEFAULTS.stake_step)),
        max_stake: provided(input.max_stake) ? Math.max(initial_stake, numIn(input.max_stake, 0, 1000000, 0)) : 0,
        reset_after_losses: intIn(input.reset_after_losses, 0, 20, 0),
        take_profit: numIn(input.take_profit, 0.01, 1000000, DEFAULTS.take_profit),
        stop_loss: numIn(input.stop_loss, 0.01, 1000000, DEFAULTS.stop_loss),
        max_consecutive_losses: intIn(input.max_consecutive_losses, 0, 50, 0),
        max_runs: intIn(input.max_runs, 0, 100000, 0),
    };
    return { spec, notes, unsupported };
}

module.exports = {
    SPEC_STRATEGIES,
    STAKE_MODES,
    ENTRY_TYPES,
    MAX_ENTRIES,
    DEFAULTS,
    MIN_STAKE,
    normalizeSpec,
    validateRaw,
};
