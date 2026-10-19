// "Digit rules" strategy for the AI Bot Builder: digit contracts that wait for a tick pattern before
// buying, with an optional recovery trade after a loss and optional journal messages.
//
// Like strategy-templates.js, the AI never writes blocks. It returns a small JSON description
// (see normalizeDigitRules) and buildDigitRulesXml() turns it into a fixed, known-good block layout
// made only from blocks that are registered in the app:
//   trade_definition, trade_definition_tradeoptions, before_purchase, purchase, after_purchase,
//   controls_if, logic_operation, logic_compare, logic_boolean, last_digit, last_digits_condition,
//   contract_check_result, total_profit, math_arithmetic, math_number, variables_get/set, notify, text,
//   trade_again.
//
// Deriv fixes the trade type, and the digit (barrier) for each trade, when a trade cycle starts. So one
// bot can hold ONE entry rule plus ONE recovery rule (armed after a loss). Two entry rules that need
// different digits at the same time (for example "Over 2 when A, Under 7 when B") cannot both be armed;
// the AI is told to list the one it could not build in "unsupported" instead of dropping it silently.
//
// Plain CommonJS (no ESM) so Vercel's Node runtime never has to guess the module system.

const { VALID_SYMBOLS } = require('./strategy-templates');

// contract -> trade type family and the allowed barrier digits [min, max, default].
const CONTRACTS = {
    DIGITOVER: {
        family: 'overunder',
        category: 'digits',
        trade_type: 'overunder',
        label: 'Over',
        prediction: [0, 8, 2],
    },
    DIGITUNDER: {
        family: 'overunder',
        category: 'digits',
        trade_type: 'overunder',
        label: 'Under',
        prediction: [1, 9, 7],
    },
    DIGITMATCH: {
        family: 'matchesdiffers',
        category: 'digits',
        trade_type: 'matchesdiffers',
        label: 'Matches',
        prediction: [0, 9, 5],
    },
    DIGITDIFF: {
        family: 'matchesdiffers',
        category: 'digits',
        trade_type: 'matchesdiffers',
        label: 'Differs',
        prediction: [0, 9, 5],
    },
    DIGITEVEN: { family: 'evenodd', category: 'digits', trade_type: 'evenodd', label: 'Even', prediction: null },
    DIGITODD: { family: 'evenodd', category: 'digits', trade_type: 'evenodd', label: 'Odd', prediction: null },
};

const CONDITION_TYPES = ['digits_absent', 'last_digit_in', 'last_digit_not_in', 'last_digits'];
const COMPARISONS = ['LESS', 'LEQ', 'GREATER', 'GEQ', 'EQ', 'NEQ'];
const COMPARISON_WORDS = {
    LESS: 'below',
    LEQ: 'at most',
    GREATER: 'above',
    GEQ: 'at least',
    EQ: 'equal to',
    NEQ: 'not equal to',
};

const MIN_STAKE = 0.35;
const MAX_LOOKBACK = 100;
const MAX_CONDITIONS = 6;
const MAX_NOTES = 5;

const DEFAULTS = {
    symbol: '1HZ100V',
    initial_stake: 1,
    martingale_multiplier: 2,
    take_profit: 10,
    stop_loss: 10,
    duration_ticks: 1,
    lookback: 10,
};

function round2(n) {
    return Math.round(n * 100) / 100;
}

function positive(value, fallback, min = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.max(round2(n), min);
}

function integerInRange(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function cleanDigits(value) {
    if (!Array.isArray(value)) return [];
    const digits = [];
    value.forEach(item => {
        const n = Number(item);
        if (Number.isInteger(n) && n >= 0 && n <= 9 && !digits.includes(n)) digits.push(n);
    });
    return digits;
}

// A condition is { type, ... }. Anything invalid is dropped and reported; nothing the model sends is
// copied into the XML unchecked.
function normalizeCondition(raw, notes) {
    if (!raw || typeof raw !== 'object' || !CONDITION_TYPES.includes(raw.type)) {
        notes.push('A condition was not understood and was left out.');
        return null;
    }
    if (raw.type === 'digits_absent') {
        const digits = cleanDigits(raw.digits);
        if (!digits.length) {
            notes.push('A "digit not seen" condition had no valid digits and was left out.');
            return null;
        }
        return { type: 'digits_absent', digits, ticks: integerInRange(raw.ticks, 1, MAX_LOOKBACK, DEFAULTS.lookback) };
    }
    if (raw.type === 'last_digit_in' || raw.type === 'last_digit_not_in') {
        const digits = cleanDigits(raw.digits);
        if (!digits.length) {
            notes.push('A "last digit is" condition had no valid digits and was left out.');
            return null;
        }
        return { type: raw.type, digits };
    }
    // last_digits: the last N digits all satisfy "<op> digit"
    if (!COMPARISONS.includes(raw.op) || !Number.isInteger(Number(raw.digit)) || raw.digit < 0 || raw.digit > 9) {
        notes.push('A "last digits" condition was incomplete and was left out.');
        return null;
    }
    return {
        type: 'last_digits',
        ticks: integerInRange(raw.ticks, 1, MAX_LOOKBACK, DEFAULTS.lookback),
        op: raw.op,
        digit: Number(raw.digit),
    };
}

function normalizeConditions(list, notes) {
    if (!Array.isArray(list)) return [];
    return list
        .slice(0, MAX_CONDITIONS)
        .map(c => normalizeCondition(c, notes))
        .filter(Boolean);
}

function normalizeRule(raw, fallbackContract, notes) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const contract = Object.prototype.hasOwnProperty.call(CONTRACTS, input.contract)
        ? input.contract
        : fallbackContract;
    const spec = CONTRACTS[contract];
    const rule = { contract, when: normalizeConditions(input.when, notes) };
    if (spec.prediction) {
        const [min, max, fallback] = spec.prediction;
        rule.prediction = integerInRange(input.prediction, min, max, fallback);
    }
    return rule;
}

function normalizeDigitRules(raw) {
    const input = raw || {};
    const notes = [];

    const entry = normalizeRule(input.entry, 'DIGITOVER', notes);

    let recovery = null;
    if (input.recovery && typeof input.recovery === 'object') {
        recovery = normalizeRule(input.recovery, entry.contract, notes);
        if (CONTRACTS[recovery.contract].family !== CONTRACTS[entry.contract].family) {
            notes.push(
                `The recovery trade (${CONTRACTS[recovery.contract].label}) uses a different trade type from the entry trade (${CONTRACTS[entry.contract].label}); Deriv fixes the trade type per bot, so the recovery rule was left out.`
            );
            recovery = null;
        }
    }

    const unsupported = (Array.isArray(input.unsupported) ? input.unsupported : [])
        .map(item => String(item).replace(/\s+/g, ' ').trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, MAX_NOTES);

    return {
        strategy: 'digit_rules',
        symbol: VALID_SYMBOLS.includes(input.symbol) ? input.symbol : DEFAULTS.symbol,
        duration_ticks: integerInRange(input.duration_ticks, 1, 10, DEFAULTS.duration_ticks),
        initial_stake: positive(input.initial_stake, DEFAULTS.initial_stake, MIN_STAKE),
        martingale_multiplier: Math.min(
            10,
            Math.max(1, positive(input.martingale_multiplier, DEFAULTS.martingale_multiplier))
        ),
        take_profit: positive(input.take_profit, DEFAULTS.take_profit),
        stop_loss: positive(input.stop_loss, DEFAULTS.stop_loss),
        journal: input.journal === true || input.journal === 'true',
        entry,
        recovery,
        // What the model said it could not build, plus anything the validator had to drop.
        unsupported: [...unsupported, ...notes].slice(0, MAX_NOTES * 2),
    };
}

// ---- plain-English descriptions (journal text and the summary shown in the UI) ----

const list = digits => digits.join(', ');

function describeCondition(c) {
    switch (c.type) {
        case 'digits_absent':
            return `none of ${list(c.digits)} in the last ${c.ticks} ticks`;
        case 'last_digit_in':
            return `last digit is ${c.digits.length > 1 ? 'one of ' : ''}${list(c.digits)}`;
        case 'last_digit_not_in':
            return `last digit is not ${c.digits.length > 1 ? 'any of ' : ''}${list(c.digits)}`;
        default:
            return `last ${c.ticks} digits ${COMPARISON_WORDS[c.op]} ${c.digit}`;
    }
}

function describeRule(rule) {
    const spec = CONTRACTS[rule.contract];
    const what = typeof rule.prediction === 'number' ? `${spec.label} ${rule.prediction}` : spec.label;
    return rule.when.length ? `${what} when ${rule.when.map(describeCondition).join(' and ')}` : `${what} every tick`;
}

// ---- XML ----

function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const VAR_IDS = { stake: 'bm_stake_var', prediction: 'bm_prediction_var', recovering: 'bm_recovering_var' };

const varGet = name => `<block type="variables_get"><field name="VAR" id="${VAR_IDS[name]}">${name}</field></block>`;
// A variables_set statement; the caller closes it (optionally after a <next>).
const varSet = (name, valueXml, nextXml = '') =>
    `<block type="variables_set"><field name="VAR" id="${VAR_IDS[name]}">${name}</field><value name="VALUE">${valueXml}</value>${
        nextXml ? `<next>${nextXml}</next>` : ''
    }</block>`;
const num = n => `<block type="math_number"><field name="NUM">${n}</field></block>`;
const text = t => `<block type="text"><field name="TEXT">${esc(t)}</field></block>`;
const bool = value => `<block type="logic_boolean"><field name="BOOL">${value ? 'TRUE' : 'FALSE'}</field></block>`;

const compare = (op, aXml, bXml) =>
    `<block type="logic_compare"><field name="OP">${op}</field><value name="A">${aXml}</value><value name="B">${bXml}</value></block>`;

const logic = (op, aXml, bXml) =>
    `<block type="logic_operation"><field name="OP">${op}</field><value name="A">${aXml}</value><value name="B">${bXml}</value></block>`;

// Folds a list of boolean blocks with AND / OR; an empty list is "true" for AND.
function fold(op, blocks) {
    if (!blocks.length) return bool(true);
    return blocks.slice(1).reduce((acc, block) => logic(op, acc, block), blocks[0]);
}

const lastDigitsBlock = (n, condition, digit) =>
    `<block type="last_digits_condition"><field name="N">${n}</field><field name="CONDITION">${condition}</field><field name="DIGIT">${digit}</field></block>`;

const lastDigitIs = (op, digit) => compare(op, '<block type="last_digit"></block>', num(digit));

function conditionXml(c) {
    switch (c.type) {
        case 'digits_absent':
            return fold(
                'AND',
                c.digits.map(d => lastDigitsBlock(c.ticks, 'NEQ', d))
            );
        case 'last_digit_in':
            return fold(
                'OR',
                c.digits.map(d => lastDigitIs('EQ', d))
            );
        case 'last_digit_not_in':
            return fold(
                'AND',
                c.digits.map(d => lastDigitIs('NEQ', d))
            );
        default:
            return lastDigitsBlock(c.ticks, c.op, c.digit);
    }
}

const rulesXml = rule => fold('AND', rule.when.map(conditionXml));

const notify = (type, message) =>
    `<block type="notify"><field name="NOTIFICATION_TYPE">${type}</field><field name="NOTIFICATION_SOUND">silent</field><value name="MESSAGE">${text(message)}</value></block>`;

// Chains statement blocks with <next>. Each item is a self-contained block string; blocks are nested
// by inserting the following block before the closing tag of the previous one.
function chain(blocks) {
    const items = blocks.filter(Boolean);
    if (!items.length) return '';
    return items.reduceRight(
        (tail, block) => (tail ? block.replace(/<\/block>$/, `<next>${tail}</next></block>`) : block),
        ''
    );
}

function buildDigitRulesXml(rawParams) {
    const p = normalizeDigitRules(rawParams);
    const { entry, recovery } = p;
    const entrySpec = CONTRACTS[entry.contract];
    const contracts = [...new Set([entry.contract, recovery && recovery.contract].filter(Boolean))];
    const contractList = contracts.length > 1 ? 'both' : contracts[0];
    const needsPrediction = Boolean(entrySpec.prediction);

    const summaryText = describeRule(entry);

    // ---- before purchase ----
    const buyBlock = (rule, label) =>
        chain([
            p.journal ? notify('info', `${label}: ${describeRule(rule)}`) : '',
            `<block type="purchase"><field name="PURCHASE_LIST">${rule.contract}</field></block>`,
        ]);

    const entryIf = `<block type="controls_if">
        <value name="IF0">${recovery ? logic('AND', compare('EQ', varGet('recovering'), num(0)), rulesXml(entry)) : rulesXml(entry)}</value>
        <statement name="DO0">${buyBlock(entry, 'Entry')}</statement>
      </block>`;
    const recoveryIf = recovery
        ? `<block type="controls_if">
        <value name="IF0">${logic('AND', compare('EQ', varGet('recovering'), num(1)), rulesXml(recovery))}</value>
        <statement name="DO0">${buyBlock(recovery, 'Recovery')}</statement>
      </block>`
        : '';
    const beforePurchase = chain([entryIf, recoveryIf]);

    // ---- after purchase ----
    const stakeUpdate = `<block type="controls_if">
        <mutation else="1"></mutation>
        <value name="IF0"><block type="contract_check_result"><field name="CHECK_RESULT">win</field></block></value>
        <statement name="DO0">${chain([
            p.journal ? notify('success', 'Win - stake reset.') : '',
            varSet('stake', num(p.initial_stake)),
        ])}</statement>
        <statement name="ELSE">${chain([
            p.journal ? notify('warn', 'Loss - stake increased.') : '',
            varSet(
                'stake',
                `<block type="math_arithmetic"><field name="OP">MULTIPLY</field><value name="A"><shadow type="math_number"><field name="NUM">1</field></shadow>${varGet('stake')}</value><value name="B"><shadow type="math_number"><field name="NUM">${p.martingale_multiplier}</field></shadow></value></block>`
            ),
        ])}</statement>
      </block>`;

    // After a recovery trade the bot goes back to the entry rule (win or lose); after an entry-trade
    // loss it arms the recovery rule. The next trade cycle reads the new digit from `prediction`.
    const recoveryUpdate = recovery
        ? `<block type="controls_if">
        <mutation elseif="1"></mutation>
        <value name="IF0">${compare('EQ', varGet('recovering'), num(1))}</value>
        <statement name="DO0">${chain([
            varSet('recovering', num(0)),
            needsPrediction ? varSet('prediction', num(entry.prediction)) : '',
            p.journal ? notify('info', 'Back to the entry rule.') : '',
        ])}</statement>
        <value name="IF1"><block type="contract_check_result"><field name="CHECK_RESULT">loss</field></block></value>
        <statement name="DO1">${chain([
            varSet('recovering', num(1)),
            needsPrediction ? varSet('prediction', num(recovery.prediction)) : '',
            p.journal ? notify('info', `Recovery armed: ${describeRule(recovery)}`) : '',
        ])}</statement>
      </block>`
        : '';

    const stopOrRepeat = `<block type="controls_if">
        <mutation elseif="1" else="1"></mutation>
        <value name="IF0">${compare('GTE', '<block type="total_profit"></block>', num(p.take_profit))}</value>
        <statement name="DO0">${notify('success', 'Take profit reached - bot stopped.')}</statement>
        <value name="IF1">${compare('LTE', '<block type="total_profit"></block>', num(-p.stop_loss))}</value>
        <statement name="DO1">${notify('warn', 'Stop loss reached - bot stopped.')}</statement>
        <statement name="ELSE"><block type="trade_again"></block></statement>
      </block>`;

    const afterPurchase = chain([stakeUpdate, recoveryUpdate, stopOrRepeat]);

    // ---- trade definition ----
    const initialization = chain([
        varSet('stake', num(p.initial_stake)),
        recovery ? varSet('recovering', num(0)) : '',
        needsPrediction ? varSet('prediction', num(entry.prediction)) : '',
    ]);

    const predictionInput = needsPrediction
        ? `<value name="PREDICTION"><shadow type="math_number_positive"><field name="NUM">${entry.prediction}</field></shadow>${varGet('prediction')}</value>`
        : '';

    const variables = [
        `<variable id="${VAR_IDS.stake}">stake</variable>`,
        needsPrediction ? `<variable id="${VAR_IDS.prediction}">prediction</variable>` : '',
        recovery ? `<variable id="${VAR_IDS.recovering}">recovering</variable>` : '',
    ]
        .filter(Boolean)
        .join('\n    ');

    const xml = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    ${variables}
  </variables>
  <block type="trade_definition" deletable="false" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${p.symbol}</field>
        <next>
          <block type="trade_definition_tradetype" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${entrySpec.category}</field>
            <field name="TRADETYPE_LIST">${entrySpec.trade_type}</field>
            <next>
              <block type="trade_definition_contracttype" deletable="false" movable="false">
                <field name="TYPE_LIST">${contractList}</field>
                <next>
                  <block type="trade_definition_candleinterval" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION">${initialization}</statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions">
        <mutation has_first_barrier="false" has_second_barrier="false" has_prediction="${needsPrediction}"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="CURRENCY_LIST">USD</field>
        <value name="DURATION">
          <shadow type="math_number_positive"><field name="NUM">${p.duration_ticks}</field></shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number_positive"><field name="NUM">${p.initial_stake}</field></shadow>
          ${varGet('stake')}
        </value>
        ${predictionInput}
      </block>
    </statement>
  </block>
  <block type="before_purchase" x="0" y="700">
    <statement name="BEFOREPURCHASE_STACK">${beforePurchase}</statement>
  </block>
  <block type="after_purchase" x="720" y="0">
    <statement name="AFTERPURCHASE_STACK">${afterPurchase}</statement>
  </block>
</xml>
`;
    return { xml, params: p, summaryText };
}

// Label/value rows the UI shows for a generated digit-rules bot.
function describeDigitRules(p) {
    const rows = [
        ['Strategy', 'Digit rules'],
        ['Symbol', p.symbol],
        ['Entry', describeRule(p.entry)],
    ];
    if (p.recovery) rows.push(['After a loss', describeRule(p.recovery)]);
    rows.push(
        ['Duration', `${p.duration_ticks} tick${p.duration_ticks === 1 ? '' : 's'}`],
        ['Initial stake', `$${p.initial_stake}`],
        ['Martingale', p.martingale_multiplier === 1 ? 'off' : `x${p.martingale_multiplier} after a loss`],
        ['Take profit', `$${p.take_profit}`],
        ['Stop loss', `$${p.stop_loss}`],
        ['Journal', p.journal ? 'on (entries, wins, losses)' : 'off']
    );
    if (p.martingale_multiplier > 1) {
        let cost = 0;
        for (let i = 0; i < 5; i++) cost += p.initial_stake * Math.pow(p.martingale_multiplier, i);
        rows.push(['5 losses in a row cost', `$${round2(cost)}`]);
    }
    return rows;
}

module.exports = {
    CONTRACTS,
    CONDITION_TYPES,
    normalizeDigitRules,
    buildDigitRulesXml,
    describeDigitRules,
};
