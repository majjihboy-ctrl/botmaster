// Prompt + structured-output schema for the AI Bot Builder.
//
// The few-shot EXAMPLES double as tests: ai-advanced-bots.spec.js builds every one of them and loads it
// into the real Blockly workspace, so the patterns the model is taught can never drift out of sync with
// what the builder supports. Several are modelled on bots in api/_lib/library/own.
//
// Plain CommonJS so Vercel's Node runtime never has to guess the module system.

const { VALID_SYMBOLS } = require('./strategy-templates');
const { SPEC_STRATEGIES, STAKE_MODES, ENTRY_TYPES } = require('./bot-spec');

const VALID_GROWTH_RATES = ['0.01', '0.02', '0.03', '0.04', '0.05'];

const EXAMPLES = [
    {
        prompt: 'Volatility 100 index, 2% growth rate, stop at $20 profit or $15 loss',
        spec: {
            strategy: 'accumulator',
            symbol: 'R_100',
            growth_rate: '0.02',
            take_profit: 10,
            initial_stake: 10,
            martingale_size: 10,
            profit_threshold: 20,
            loss_threshold: 15,
        },
    },
    {
        prompt: 'Rise on Volatility 75, 5 ticks, stake $2, double after a loss, stop at $30 profit or $20 loss',
        spec: {
            strategy: 'rise_fall',
            symbol: 'R_75',
            direction: 'rise',
            duration_ticks: 5,
            initial_stake: 2,
            stake_mode: 'martingale',
            martingale_multiplier: 2,
            take_profit: 30,
            stop_loss: 20,
        },
    },
    {
        // Pattern from the library bot "over 1 with entry search after loss".
        prompt: 'Over 1 on the 1 second Volatility 10, after a loss wait until the last digit is 1 before trading again, x2 martingale, stop at $10 profit or $20 loss',
        spec: {
            strategy: 'over_under',
            symbol: '1HZ10V',
            direction: 'over',
            prediction: 1,
            duration_ticks: 1,
            entries: [{ type: 'last_digit', op: 'EQ', digit: 1, apply: 'after_loss' }],
            initial_stake: 1,
            stake_mode: 'martingale',
            martingale_multiplier: 2,
            take_profit: 10,
            stop_loss: 20,
        },
    },
    {
        // Pattern from "over 2 / under 6 / over 4": different contracts in recovery.
        prompt: 'Trade over 2 on Volatility 100 (1s). After a loss trade under 6 then over 4 in turns until I win. $1 stake, x2 martingale, stop at $15 profit or $25 loss',
        spec: {
            strategy: 'over_under',
            symbol: '1HZ100V',
            base_legs: [{ direction: 'over', digit: 2 }],
            recovery_legs: [
                { direction: 'under', digit: 6 },
                { direction: 'over', digit: 4 },
            ],
            duration_ticks: 1,
            initial_stake: 1,
            stake_mode: 'martingale',
            martingale_multiplier: 2,
            take_profit: 15,
            stop_loss: 25,
        },
    },
    {
        // Pattern from "two consecutive digits".
        prompt: 'Trade under 7 only when the last 2 digits are both below 4, Volatility 50, $0.50 stake, stop after 5 losses in a row',
        spec: {
            strategy: 'over_under',
            symbol: 'R_50',
            direction: 'under',
            prediction: 7,
            entry: { type: 'last_digits', count: 2, op: 'LT', digit: 4, apply: 'always' },
            initial_stake: 0.5,
            stake_mode: 'martingale',
            martingale_multiplier: 2,
            max_consecutive_losses: 5,
            take_profit: 10,
            stop_loss: 10,
        },
    },
    {
        prompt: 'Even digits on Volatility 75 only when at least 60% of the last 100 digits are even, Fibonacci stakes, never above $20, stop after 200 runs',
        spec: {
            strategy: 'even_odd',
            symbol: 'R_75',
            direction: 'even',
            duration_ticks: 1,
            entry: { type: 'parity_percent', parity: 'even', ticks: 100, min_percent: 60, apply: 'always' },
            initial_stake: 1,
            stake_mode: 'fibonacci',
            max_stake: 20,
            max_runs: 200,
            take_profit: 20,
            stop_loss: 20,
        },
    },
    {
        prompt: "Rise/fall on Volatility 100 (1s), buy rise when RSI(14) is under 30, 5 ticks, D'Alembert with $0.50 steps, stop at $10 profit or $10 loss",
        spec: {
            strategy: 'rise_fall',
            symbol: '1HZ100V',
            direction: 'rise',
            duration_ticks: 5,
            entry: { type: 'rsi', period: 14, op: 'LT', level: 30, apply: 'always' },
            initial_stake: 1,
            stake_mode: 'dalembert',
            stake_step: 0.5,
            take_profit: 10,
            stop_loss: 10,
        },
    },
    {
        prompt: 'Under 6 on Volatility 100 (1s) when the last digit is below 3 and RSI(10) is under 35, flat $1 stake',
        spec: {
            strategy: 'over_under',
            symbol: '1HZ100V',
            direction: 'under',
            prediction: 6,
            entries: [
                { type: 'last_digit', op: 'LT', digit: 3 },
                { type: 'rsi', period: 10, op: 'LT', level: 35 },
            ],
            entry_logic: 'all',
            initial_stake: 1,
            stake_mode: 'flat',
            take_profit: 10,
            stop_loss: 10,
        },
    },
    {
        prompt: 'Rise on Volatility 75 when price is above the 20 EMA or above 1200, but only in the evening and only after 2 losses',
        spec: {
            strategy: 'rise_fall',
            symbol: 'R_75',
            direction: 'rise',
            duration_ticks: 5,
            entries: [
                { type: 'ema', period: 20, op: 'GT' },
                { type: 'price', op: 'GT', value: 1200 },
            ],
            entry_logic: 'any',
            unsupported: ['only in the evening', 'only after 2 losses'],
            initial_stake: 1,
            stake_mode: 'martingale',
            martingale_multiplier: 2,
            take_profit: 10,
            stop_loss: 10,
        },
    },
    {
        // Digit-pattern rules with their own recovery rule and journal messages ("digit_rules").
        prompt: 'Over 2 when digits 1, 2 and 0 have not appeared in 10 ticks. If I lose, over 4 when the last digit is 0 or 9. Show journals',
        spec: {
            strategy: 'digit_rules',
            symbol: '1HZ100V',
            duration_ticks: 1,
            initial_stake: 1,
            martingale_multiplier: 2,
            take_profit: 10,
            stop_loss: 10,
            journal: true,
            entry: {
                contract: 'DIGITOVER',
                prediction: 2,
                when: [{ type: 'digits_absent', digits: [1, 2, 0], ticks: 10 }],
            },
            recovery: { contract: 'DIGITOVER', prediction: 4, when: [{ type: 'last_digit_in', digits: [0, 9] }] },
            unsupported: [],
        },
    },
    {
        prompt: 'Differs 7 on Volatility 50, flat $1 stake, stop at $5 profit',
        spec: {
            strategy: 'matches_differs',
            symbol: 'R_50',
            direction: 'differs',
            prediction: 7,
            initial_stake: 1,
            stake_mode: 'flat',
            take_profit: 5,
            stop_loss: 10,
        },
    },
];

function buildSystemPrompt(previous) {
    const examples = EXAMPLES.map(e => `Request: ${JSON.stringify(e.prompt)}\nAnswer: ${JSON.stringify(e.spec)}`).join(
        '\n\n'
    );
    const refine = previous
        ? `\n\nThe user already has this bot (JSON):\n${JSON.stringify(previous)}\nTreat the new request as a CHANGE to it: keep everything the user did not mention and return the FULL updated JSON.`
        : '';

    return `You turn a user's plain-English description of a Deriv trading bot into JSON settings. You never write bot code or XML.

Respond ONLY with one raw JSON object: no markdown fences, no preamble, no explanation. Omit fields the user did not mention (defaults are applied).

"strategy" is one of ${JSON.stringify(['accumulator', ...SPEC_STRATEGIES, 'digit_rules'])}:
- "accumulator": accumulator contracts. Use it when the user mentions accumulator or growth rate, or names no strategy at all.
- "rise_fall": rise/fall (call/put).  direction: "rise" | "fall".  duration_ticks 5-10.
- "even_odd": digit even/odd.  direction: "even" | "odd".  duration_ticks 1-10.
- "over_under": digit over/under.  direction: "over" (digit 0-8) | "under" (digit 1-9).  duration_ticks 1-10.
- "matches_differs": digit matches/differs.  direction: "differs" | "matches" (digit 0-9).  duration_ticks 1-10.
- "digit_rules": a digit contract that only buys when a tick-digit pattern holds, optionally with a DIFFERENT trade (with its own pattern) after a loss, and optional journal messages. Use it when the user gives a digit pattern the "entries" types below cannot express ("digits 1, 2 and 0 have not appeared in the last 10 ticks", "the last digit is 0 or 9") or when the recovery trade needs its own entry condition. Fields described under "digit_rules" below.

Always: "symbol" (one of ${JSON.stringify(VALID_SYMBOLS)}; default "1HZ100V"), "initial_stake" (USD, minimum 0.35), "take_profit" and "stop_loss" (positive USD).
Digit strategies (over_under, matches_differs) also take "prediction": the barrier digit.

Optional modules for every non-accumulator strategy:
- Several contracts: "base_legs": 1-2 objects {"direction":..., "digit":n} traded in turns. "recovery_legs": 1-2 objects in the same shape, traded after a loss until the next win. (For a single contract use "direction"/"prediction".)
- "entries": a list of 1-3 conditions; the bot only trades when they hold, otherwise it waits for the next tick. "entry_logic": "all" (every condition, default) or "any" (at least one). The first condition's "apply":"after_loss" means the first trade (and trades after a win) go straight in and the conditions are only required while recovering from a loss. Each condition is one of these types (at most one rsi, one sma and one ema):
  {"type":"last_digit","op":"EQ"|"NEQ"|"LT"|"LTE"|"GT"|"GTE","digit":0-9}
  {"type":"last_digits","count":1-20,"op":"LT"|"LTE"|"GT"|"GTE"|"EQ"|"NEQ","digit":0-9}   (the last N digits ALL satisfy it)
  {"type":"digit_percent","side":"over"|"under","digit":0-9,"ticks":10-1000,"min_percent":1-100}
  {"type":"parity_percent","parity":"even"|"odd","ticks":10-1000,"min_percent":1-100}
  {"type":"direction","direction":"rise"|"fall"}   (the market just moved that way)
  {"type":"rsi","period":2-50,"op":"LT"|"GT","level":1-99}
  {"type":"sma","period":2-100,"op":"GT"|"LT"}   (last price above/below the simple moving average)
  {"type":"ema","period":2-100,"op":"GT"|"LT"}   (last price above/below the exponential moving average)
  {"type":"price","op":"GT"|"LT","value":number}   (last price above/below a fixed level)
- Stake: "stake_mode": ${JSON.stringify(STAKE_MODES)} (default "martingale"). "martingale_multiplier" 1-10 (default 2), "stake_step" (dalembert), "max_stake" (cap in USD), "reset_after_losses" (go back to the initial stake after N losses in a row).
- Extra stops: "max_consecutive_losses", "max_runs".
- "unsupported": an array of short phrases (copied from the request) for anything the user asked for that none of the options above can express, for example time-of-day rules, news, waiting for N losses before the first trade, or custom code. NEVER silently drop a condition: every condition in the request must end up in "entries" or in "unsupported".

digit_rules fields (instead of the optional modules above): besides symbol, duration_ticks 1-10, initial_stake, martingale_multiplier, take_profit and stop_loss:
- "entry": {"contract": "DIGITOVER"|"DIGITUNDER"|"DIGITMATCH"|"DIGITDIFF"|"DIGITEVEN"|"DIGITODD", "prediction": digit (not for even/odd; over 0-8, under 1-9), "when": [conditions]}
- "recovery" (optional, only when the user wants a different trade after a loss): same shape, same contract family as "entry" (over/under with over/under, matches/differs with matches/differs, even/odd with even/odd).
- "journal": true if the user asks for journal messages, notifications or logs.
- Conditions in "when" (all must hold): {"type":"digits_absent","digits":[1,2,0],"ticks":10} (none of these digits appeared in the last N ticks), {"type":"last_digit_in","digits":[0,9]}, {"type":"last_digit_not_in","digits":[4,5]}, {"type":"last_digits","ticks":3,"op":"LESS"|"LEQ"|"GREATER"|"GEQ"|"EQ"|"NEQ","digit":4} (the last N digits all satisfy it).
- A digit_rules bot has ONE entry rule and ONE recovery rule: two entry rules that need different digits cannot both be armed, so build the first one and list the other in "unsupported".
- "unsupported": short phrases for every part of the request you could not build. Never drop anything silently.

Accumulator fields instead: "growth_rate" one of ${JSON.stringify(VALID_GROWTH_RATES)} (string, default "0.01"), "initial_stake" (default 10), "take_profit" per trade (default 10), "martingale_size" stake step after a loss (default 10), "profit_threshold" and "loss_threshold" total stops (default 10).

Allowed entry types: ${JSON.stringify(ENTRY_TYPES.filter(t => t !== 'none'))}. Never invent a symbol, strategy, entry type or stake mode outside the lists. If part of the request cannot be expressed, build the closest bot you can and list that part in "unsupported".

Examples:

${examples}${refine}`;
}

// JSON schema for Gemini's structured output (OpenAPI subset). Everything is optional except "strategy".
const leg = {
    type: 'OBJECT',
    properties: { direction: { type: 'STRING' }, digit: { type: 'INTEGER' } },
};
const ENTRY_SCHEMA = {
    type: 'OBJECT',
    properties: {
        type: { type: 'STRING', enum: ENTRY_TYPES },
        apply: { type: 'STRING', enum: ['always', 'after_loss'] },
        op: { type: 'STRING' },
        digit: { type: 'INTEGER' },
        count: { type: 'INTEGER' },
        side: { type: 'STRING', enum: ['over', 'under'] },
        parity: { type: 'STRING', enum: ['even', 'odd'] },
        direction: { type: 'STRING', enum: ['rise', 'fall'] },
        ticks: { type: 'INTEGER' },
        min_percent: { type: 'INTEGER' },
        period: { type: 'INTEGER' },
        level: { type: 'INTEGER' },
        value: { type: 'NUMBER' },
    },
};
const RULE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        ...ENTRY_SCHEMA.properties,
        direction: { type: 'STRING' },
        contract: {
            type: 'STRING',
            enum: ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF', 'DIGITEVEN', 'DIGITODD'],
        },
        prediction: { type: 'INTEGER' },
        when: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    type: { type: 'STRING' },
                    digits: { type: 'ARRAY', items: { type: 'INTEGER' } },
                    ticks: { type: 'INTEGER' },
                    op: { type: 'STRING' },
                    digit: { type: 'INTEGER' },
                },
            },
        },
    },
};
const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        strategy: { type: 'STRING', enum: ['accumulator', ...SPEC_STRATEGIES, 'digit_rules'] },
        symbol: { type: 'STRING', enum: VALID_SYMBOLS },
        direction: { type: 'STRING' },
        prediction: { type: 'INTEGER' },
        duration_ticks: { type: 'INTEGER' },
        base_legs: { type: 'ARRAY', items: leg },
        recovery_legs: { type: 'ARRAY', items: leg },
        entries: { type: 'ARRAY', items: ENTRY_SCHEMA },
        entry_logic: { type: 'STRING', enum: ['all', 'any'] },
        unsupported: { type: 'ARRAY', items: { type: 'STRING' } },
        // digit_rules uses entry/recovery as {contract, prediction, when[]}; the other strategies use a single
        // entry condition and a {direction, digit} recovery leg. One loose shape covers both.
        entry: RULE_SCHEMA,
        recovery: RULE_SCHEMA,
        journal: { type: 'BOOLEAN' },
        initial_stake: { type: 'NUMBER' },
        stake_mode: { type: 'STRING', enum: STAKE_MODES },
        martingale_multiplier: { type: 'NUMBER' },
        stake_step: { type: 'NUMBER' },
        max_stake: { type: 'NUMBER' },
        reset_after_losses: { type: 'INTEGER' },
        take_profit: { type: 'NUMBER' },
        stop_loss: { type: 'NUMBER' },
        max_consecutive_losses: { type: 'INTEGER' },
        max_runs: { type: 'INTEGER' },
        growth_rate: { type: 'STRING', enum: VALID_GROWTH_RATES },
        martingale_size: { type: 'NUMBER' },
        profit_threshold: { type: 'NUMBER' },
        loss_threshold: { type: 'NUMBER' },
    },
    required: ['strategy'],
};

module.exports = { EXAMPLES, buildSystemPrompt, RESPONSE_SCHEMA, VALID_GROWTH_RATES };
