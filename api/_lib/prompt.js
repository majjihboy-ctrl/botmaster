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
            entry: { type: 'last_digit', op: 'EQ', digit: 1, apply: 'after_loss' },
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

"strategy" is one of ${JSON.stringify(['accumulator', ...SPEC_STRATEGIES])}:
- "accumulator": accumulator contracts. Use it when the user mentions accumulator or growth rate, or names no strategy at all.
- "rise_fall": rise/fall (call/put).  direction: "rise" | "fall".  duration_ticks 5-10.
- "even_odd": digit even/odd.  direction: "even" | "odd".  duration_ticks 1-10.
- "over_under": digit over/under.  direction: "over" (digit 0-8) | "under" (digit 1-9).  duration_ticks 1-10.
- "matches_differs": digit matches/differs.  direction: "differs" | "matches" (digit 0-9).  duration_ticks 1-10.

Always: "symbol" (one of ${JSON.stringify(VALID_SYMBOLS)}; default "1HZ100V"), "initial_stake" (USD, minimum 0.35), "take_profit" and "stop_loss" (positive USD).
Digit strategies (over_under, matches_differs) also take "prediction": the barrier digit.

Optional modules for every non-accumulator strategy:
- Several contracts: "base_legs": 1-2 objects {"direction":..., "digit":n} traded in turns. "recovery_legs": 1-2 objects in the same shape, traded after a loss until the next win. (For a single contract use "direction"/"prediction".)
- "entry": only trade when a condition holds, otherwise wait for the next tick. "apply":"after_loss" means the first trade (and trades after a win) go straight in and the condition is only required while recovering from a loss. Types:
  {"type":"last_digit","op":"EQ"|"NEQ"|"LT"|"LTE"|"GT"|"GTE","digit":0-9}
  {"type":"last_digits","count":1-20,"op":"LT"|"LTE"|"GT"|"GTE"|"EQ"|"NEQ","digit":0-9}   (the last N digits ALL satisfy it)
  {"type":"digit_percent","side":"over"|"under","digit":0-9,"ticks":10-1000,"min_percent":1-100}
  {"type":"parity_percent","parity":"even"|"odd","ticks":10-1000,"min_percent":1-100}
  {"type":"direction","direction":"rise"|"fall"}   (the market just moved that way)
  {"type":"rsi","period":2-50,"op":"LT"|"GT","level":1-99}
  {"type":"sma","period":2-100,"op":"GT"|"LT"}   (last price above/below the moving average)
- Stake: "stake_mode": ${JSON.stringify(STAKE_MODES)} (default "martingale"). "martingale_multiplier" 1-10 (default 2), "stake_step" (dalembert), "max_stake" (cap in USD), "reset_after_losses" (go back to the initial stake after N losses in a row).
- Extra stops: "max_consecutive_losses", "max_runs".

Accumulator fields instead: "growth_rate" one of ${JSON.stringify(VALID_GROWTH_RATES)} (string, default "0.01"), "initial_stake" (default 10), "take_profit" per trade (default 10), "martingale_size" stake step after a loss (default 10), "profit_threshold" and "loss_threshold" total stops (default 10).

Allowed entry types: ${JSON.stringify(ENTRY_TYPES.filter(t => t !== 'none'))}. Never invent a symbol, strategy, entry type or stake mode outside the lists. If the user asks for something these options cannot express, build the closest bot that they can.

Examples:

${examples}${refine}`;
}

// JSON schema for Gemini's structured output (OpenAPI subset). Everything is optional except "strategy".
const leg = {
    type: 'OBJECT',
    properties: { direction: { type: 'STRING' }, digit: { type: 'INTEGER' } },
};
const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        strategy: { type: 'STRING', enum: ['accumulator', ...SPEC_STRATEGIES] },
        symbol: { type: 'STRING', enum: VALID_SYMBOLS },
        direction: { type: 'STRING' },
        prediction: { type: 'INTEGER' },
        duration_ticks: { type: 'INTEGER' },
        base_legs: { type: 'ARRAY', items: leg },
        recovery_legs: { type: 'ARRAY', items: leg },
        entry: {
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
            },
        },
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
