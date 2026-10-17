// Strategy templates for the AI Bot Builder (everything except Accumulator, which keeps its own
// reference template in bot-template.js).
//
// The AI never writes Blockly XML. It only picks a strategy from STRATEGIES and fills in numbers;
// buildStrategyXml() turns those into a bot with a fixed, known-good block layout:
//   trade definition -> buy the chosen contract every run -> after each run: win resets the stake,
//   loss multiplies it (martingale), and the bot stops once total profit reaches the take-profit
//   or total loss reaches the stop-loss.
//
// Plain CommonJS (no ESM) so Vercel's Node runtime never has to guess the module system.

const VALID_SYMBOLS = ['1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V', 'R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

// direction -> Deriv contract type. prediction: allowed barrier digit range per direction.
const STRATEGIES = {
    rise_fall: {
        label: 'Rise/Fall',
        category: 'callput',
        trade_type: 'risefall',
        directions: { rise: 'CALL', fall: 'PUT' },
        default_direction: 'rise',
        min_ticks: 5,
        max_ticks: 10,
        default_ticks: 5,
    },
    even_odd: {
        label: 'Even/Odd',
        category: 'digits',
        trade_type: 'evenodd',
        directions: { even: 'DIGITEVEN', odd: 'DIGITODD' },
        default_direction: 'even',
        min_ticks: 1,
        max_ticks: 10,
        default_ticks: 1,
    },
    over_under: {
        label: 'Over/Under',
        category: 'digits',
        trade_type: 'overunder',
        directions: { over: 'DIGITOVER', under: 'DIGITUNDER' },
        default_direction: 'over',
        prediction: { over: [0, 8, 2], under: [1, 9, 7] }, // [min, max, default]
        min_ticks: 1,
        max_ticks: 10,
        default_ticks: 1,
    },
    // Alternates between up to two Over/Under contracts (one per run) and, after a loss, switches to a
    // second set of contracts until the next win. Handled by its own builder below (spec.switching).
    over_under_switch: {
        label: 'Over/Under (switching)',
        category: 'digits',
        trade_type: 'overunder',
        switching: true,
        min_ticks: 1,
        max_ticks: 10,
        default_ticks: 1,
    },
    matches_differs: {
        label: 'Matches/Differs',
        category: 'digits',
        trade_type: 'matchesdiffers',
        directions: { differs: 'DIGITDIFF', matches: 'DIGITMATCH' },
        default_direction: 'differs',
        prediction: { differs: [0, 9, 5], matches: [0, 9, 5] },
        min_ticks: 1,
        max_ticks: 10,
        default_ticks: 1,
    },
};

const STRATEGY_IDS = Object.keys(STRATEGIES);

const MIN_STAKE = 0.35; // Deriv's minimum stake

const DEFAULTS = {
    symbol: '1HZ100V',
    initial_stake: 1,
    martingale_multiplier: 2,
    take_profit: 10,
    stop_loss: 10,
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

// Over accepts digits 0-8, Under accepts 1-9 (Deriv rejects the others).
const LEG_RANGE = { over: [0, 8], under: [1, 9] };

function normalizeLegs(rawLegs) {
    if (!Array.isArray(rawLegs)) return [];
    return rawLegs.slice(0, 2).map(leg => {
        const input = leg || {};
        const direction = Object.prototype.hasOwnProperty.call(LEG_RANGE, input.direction) ? input.direction : 'over';
        const [min, max] = LEG_RANGE[direction];
        const fallback = direction === 'over' ? 2 : 7;
        return { direction, digit: integerInRange(input.digit !== undefined ? input.digit : input.prediction, min, max, fallback) };
    });
}

// A single leg is traded every run; two legs are traded in turns.
const padLegs = legs => (legs.length === 1 ? [legs[0], legs[0]] : legs);

function normalizeSwitchParams(strategyId, spec, input) {
    let base = normalizeLegs(input.base_legs);
    if (base.length === 0) base = [{ direction: 'over', digit: 2 }];
    const recovery = normalizeLegs(input.recovery_legs);
    return {
        strategy: strategyId,
        symbol: VALID_SYMBOLS.includes(input.symbol) ? input.symbol : DEFAULTS.symbol,
        duration_ticks: integerInRange(input.duration_ticks, spec.min_ticks, spec.max_ticks, spec.default_ticks),
        initial_stake: positive(input.initial_stake, DEFAULTS.initial_stake, MIN_STAKE),
        martingale_multiplier: Math.min(
            10,
            Math.max(1, positive(input.martingale_multiplier, DEFAULTS.martingale_multiplier))
        ),
        take_profit: positive(input.take_profit, DEFAULTS.take_profit),
        stop_loss: positive(input.stop_loss, DEFAULTS.stop_loss),
        base_legs: padLegs(base),
        // No recovery legs given: keep trading the base legs after a loss (stake still follows martingale).
        recovery_legs: recovery.length ? padLegs(recovery) : padLegs(base),
        has_recovery_legs: recovery.length > 0,
    };
}

// Clamp everything the model returned to values Deriv will accept. Anything missing or out of range
// falls back to a safe default; nothing from the model is ever copied into the XML unchecked.
function normalizeStrategyParams(strategyId, raw) {
    const spec = STRATEGIES[strategyId];
    if (!spec) throw new Error(`Unknown strategy: ${strategyId}`);
    const input = raw || {};

    if (spec.switching) return normalizeSwitchParams(strategyId, spec, input);

    const direction = Object.prototype.hasOwnProperty.call(spec.directions, input.direction)
        ? input.direction
        : spec.default_direction;

    const params = {
        strategy: strategyId,
        symbol: VALID_SYMBOLS.includes(input.symbol) ? input.symbol : DEFAULTS.symbol,
        direction,
        duration_ticks: integerInRange(input.duration_ticks, spec.min_ticks, spec.max_ticks, spec.default_ticks),
        initial_stake: positive(input.initial_stake, DEFAULTS.initial_stake, MIN_STAKE),
        martingale_multiplier: Math.min(
            10,
            Math.max(1, positive(input.martingale_multiplier, DEFAULTS.martingale_multiplier))
        ),
        take_profit: positive(input.take_profit, DEFAULTS.take_profit),
        stop_loss: positive(input.stop_loss, DEFAULTS.stop_loss),
    };

    if (spec.prediction) {
        const [min, max, fallback] = spec.prediction[direction];
        params.prediction = integerInRange(input.prediction, min, max, fallback);
    }
    return params;
}

function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STAKE_VAR_ID = 'bm_stake_var';

const stakeGet = () => `<block type="variables_get"><field name="VAR" id="${STAKE_VAR_ID}">stake</field></block>`;
const stakeSet = valueXml =>
    `<block type="variables_set"><field name="VAR" id="${STAKE_VAR_ID}">stake</field><value name="VALUE">${valueXml}</value>`;
const num = n => `<block type="math_number"><field name="NUM">${n}</field></block>`;

// ---- switching strategy ---------------------------------------------------------------------------
// Variables: stake, digit (barrier), side (0 = Over, 1 = Under), turn (0/1, which leg is next) and
// recovery (0 = trading base legs, 1 = trading recovery legs after a loss).
const SWITCH_VARS = {
    stake: STAKE_VAR_ID,
    digit: 'bm_digit_var',
    side: 'bm_side_var',
    turn: 'bm_turn_var',
    recovery: 'bm_recovery_var',
};
const getV = name => `<block type="variables_get"><field name="VAR" id="${SWITCH_VARS[name]}">${name}</field></block>`;
const setV = (name, valueXml) =>
    `<block type="variables_set"><field name="VAR" id="${SWITCH_VARS[name]}">${name}</field><value name="VALUE">${valueXml}</value></block>`;
// Chains complete blocks into one statement stack (each block must end with </block>).
const stack = blocks =>
    blocks.reduceRight((next, b) => (next ? b.replace(/<\/block>$/, () => `<next>${next}</next></block>`) : b), '');
const cmpEq = (name, n) =>
    `<block type="logic_compare"><field name="OP">EQ</field><value name="A">${getV(name)}</value><value name="B">${num(n)}</value></block>`;
const ifElse = (cond, thenXml, elseXml) =>
    `<block type="controls_if"><mutation else="1"></mutation><value name="IF0">${cond}</value><statement name="DO0">${thenXml}</statement><statement name="ELSE">${elseXml}</statement></block>`;
const arithmetic = (op, aXml, bXml) =>
    `<block type="math_arithmetic"><field name="OP">${op}</field><value name="A"><shadow type="math_number"><field name="NUM">1</field></shadow>${aXml}</value><value name="B"><shadow type="math_number"><field name="NUM">1</field></shadow>${bXml}</value></block>`;

const setLeg = leg => stack([setV('side', num(leg.direction === 'over' ? 0 : 1)), setV('digit', num(leg.digit))]);

function limitsBlock(p) {
    const stopMessage = text => `<block type="text"><field name="TEXT">${esc(text)}</field></block>`;
    return `<block type="controls_if">
  <mutation elseif="1" else="1"></mutation>
  <value name="IF0"><block type="logic_compare"><field name="OP">GTE</field><value name="A"><block type="total_profit"></block></value><value name="B">${num(p.take_profit)}</value></block></value>
  <statement name="DO0"><block type="notify"><field name="NOTIFICATION_TYPE">success</field><field name="NOTIFICATION_SOUND">silent</field><value name="MESSAGE">${stopMessage('Take profit reached - bot stopped.')}</value></block></statement>
  <value name="IF1"><block type="logic_compare"><field name="OP">LTE</field><value name="A"><block type="total_profit"></block></value><value name="B">${num(-p.stop_loss)}</value></block></value>
  <statement name="DO1"><block type="notify"><field name="NOTIFICATION_TYPE">warn</field><field name="NOTIFICATION_SOUND">silent</field><value name="MESSAGE">${stopMessage('Stop loss reached - bot stopped.')}</value></block></statement>
  <statement name="ELSE"><block type="trade_again"></block></statement>
</block>`;
}

function buildSwitchXml(strategyId, rawParams) {
    const spec = STRATEGIES[strategyId];
    const p = normalizeStrategyParams(strategyId, rawParams);
    const [base0, base1] = p.base_legs;
    const [rec0, rec1] = p.recovery_legs;

    const flipTurn = setV('turn', arithmetic('MINUS', num(1), getV('turn')));
    // With recovery legs, a win/loss that changes mode restarts that mode's rotation at its first leg.
    // Without them there is no mode to change, so the base legs simply keep alternating.
    const afterWin = p.has_recovery_legs
        ? ifElse(cmpEq('recovery', 1), stack([setV('recovery', num(0)), setV('turn', num(0))]), flipTurn)
        : flipTurn;
    const afterLoss = p.has_recovery_legs
        ? ifElse(cmpEq('recovery', 0), stack([setV('recovery', num(1)), setV('turn', num(0))]), flipTurn)
        : flipTurn;
    const result = ifElse(
        '<block type="contract_check_result"><field name="CHECK_RESULT">win</field></block>',
        stack([setV('stake', num(p.initial_stake)), afterWin]),
        stack([setV('stake', arithmetic('MULTIPLY', getV('stake'), num(p.martingale_multiplier))), afterLoss])
    );
    const pick = (a, b) => ifElse(cmpEq('turn', 0), setLeg(a), setLeg(b));
    const selectLeg = ifElse(cmpEq('recovery', 0), pick(base0, base1), pick(rec0, rec1));

    return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    ${Object.entries(SWITCH_VARS)
        .map(([name, id]) => `<variable id="${id}">${name}</variable>`)
        .join('\n    ')}
  </variables>
  <block type="trade_definition" deletable="false" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${p.symbol}</field>
        <next>
          <block type="trade_definition_tradetype" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${spec.category}</field>
            <field name="TRADETYPE_LIST">${spec.trade_type}</field>
            <next>
              <block type="trade_definition_contracttype" deletable="false" movable="false">
                <field name="TYPE_LIST">both</field>
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
    <statement name="INITIALIZATION">
      ${stack([
          setV('stake', num(p.initial_stake)),
          setV('side', num(base0.direction === 'over' ? 0 : 1)),
          setV('digit', num(base0.digit)),
          setV('turn', num(0)),
          setV('recovery', num(0)),
      ])}
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions">
        <mutation has_first_barrier="false" has_second_barrier="false" has_prediction="true"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="CURRENCY_LIST">USD</field>
        <value name="DURATION">
          <shadow type="math_number_positive"><field name="NUM">${p.duration_ticks}</field></shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number_positive"><field name="NUM">${p.initial_stake}</field></shadow>
          ${getV('stake')}
        </value>
        <value name="PREDICTION">
          <shadow type="math_number_positive"><field name="NUM">${base0.digit}</field></shadow>
          ${getV('digit')}
        </value>
      </block>
    </statement>
  </block>
  <block type="before_purchase" x="0" y="600">
    <statement name="BEFOREPURCHASE_STACK">
      ${ifElse(
          cmpEq('side', 0),
          '<block type="purchase"><field name="PURCHASE_LIST">DIGITOVER</field></block>',
          '<block type="purchase"><field name="PURCHASE_LIST">DIGITUNDER</field></block>'
      )}
    </statement>
  </block>
  <block type="after_purchase" x="720" y="0">
    <statement name="AFTERPURCHASE_STACK">
      ${stack([result, selectLeg, limitsBlock(p)])}
    </statement>
  </block>
</xml>
`;
}

function buildStrategyXml(strategyId, rawParams) {
    if (STRATEGIES[strategyId] && STRATEGIES[strategyId].switching) return buildSwitchXml(strategyId, rawParams);
    const spec = STRATEGIES[strategyId];
    const p = normalizeStrategyParams(strategyId, rawParams);
    const contract = spec.directions[p.direction];
    const hasPrediction = typeof p.prediction === 'number';

    const prediction = hasPrediction
        ? `<value name="PREDICTION"><shadow type="math_number_positive"><field name="NUM">${p.prediction}</field></shadow></value>`
        : '';

    const summary = `${spec.label} ${p.direction}${hasPrediction ? ` (digit ${p.prediction})` : ''} on ${p.symbol}`;

    const stopMessage = text => `<block type="text"><field name="TEXT">${esc(text)}</field></block>`;

    return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="${STAKE_VAR_ID}">stake</variable>
  </variables>
  <block type="trade_definition" deletable="false" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${p.symbol}</field>
        <next>
          <block type="trade_definition_tradetype" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${spec.category}</field>
            <field name="TRADETYPE_LIST">${spec.trade_type}</field>
            <next>
              <block type="trade_definition_contracttype" deletable="false" movable="false">
                <field name="TYPE_LIST">${contract}</field>
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
    <statement name="INITIALIZATION">
      ${stakeSet(num(p.initial_stake))}</block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions">
        <mutation has_first_barrier="false" has_second_barrier="false" has_prediction="${hasPrediction}"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="CURRENCY_LIST">USD</field>
        <value name="DURATION">
          <shadow type="math_number_positive"><field name="NUM">${p.duration_ticks}</field></shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number_positive"><field name="NUM">${p.initial_stake}</field></shadow>
          ${stakeGet()}
        </value>
        ${prediction}
      </block>
    </statement>
  </block>
  <block type="before_purchase" x="0" y="600">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase"><field name="PURCHASE_LIST">${contract}</field></block>
    </statement>
  </block>
  <block type="after_purchase" x="720" y="0">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if">
        <mutation else="1"></mutation>
        <value name="IF0"><block type="contract_check_result"><field name="CHECK_RESULT">win</field></block></value>
        <statement name="DO0">
          ${stakeSet(num(p.initial_stake))}</block>
        </statement>
        <statement name="ELSE">
          ${stakeSet(`<block type="math_arithmetic">
              <field name="OP">MULTIPLY</field>
              <value name="A"><shadow type="math_number"><field name="NUM">1</field></shadow>${stakeGet()}</value>
              <value name="B"><shadow type="math_number"><field name="NUM">${p.martingale_multiplier}</field></shadow></value>
            </block>`)}</block>
        </statement>
        <next>
          <block type="controls_if">
            <mutation elseif="1" else="1"></mutation>
            <value name="IF0">
              <block type="logic_compare">
                <field name="OP">GTE</field>
                <value name="A"><block type="total_profit"></block></value>
                <value name="B">${num(p.take_profit)}</value>
              </block>
            </value>
            <statement name="DO0">
              <block type="notify">
                <field name="NOTIFICATION_TYPE">success</field>
                <field name="NOTIFICATION_SOUND">silent</field>
                <value name="MESSAGE">${stopMessage('Take profit reached - bot stopped.')}</value>
              </block>
            </statement>
            <value name="IF1">
              <block type="logic_compare">
                <field name="OP">LTE</field>
                <value name="A"><block type="total_profit"></block></value>
                <value name="B">${num(-p.stop_loss)}</value>
              </block>
            </value>
            <statement name="DO1">
              <block type="notify">
                <field name="NOTIFICATION_TYPE">warn</field>
                <field name="NOTIFICATION_SOUND">silent</field>
                <value name="MESSAGE">${stopMessage('Stop loss reached - bot stopped.')}</value>
              </block>
            </statement>
            <statement name="ELSE">
              <block type="trade_again"></block>
            </statement>
          </block>
        </next>
      </block>
    </statement>
  </block>
</xml>
`;
}

// Short label/value pairs the UI shows for a generated bot.
const legText = legs =>
    (legs[0].direction === legs[1].direction && legs[0].digit === legs[1].digit ? [legs[0]] : legs)
        .map(l => `${l.direction === 'over' ? 'Over' : 'Under'} ${l.digit}`)
        .join(' / ');

function describeParams(p) {
    const spec = STRATEGIES[p.strategy];
    if (spec.switching) {
        return [
            ['Strategy', spec.label],
            ['Symbol', p.symbol],
            ['Trades (in turns)', legText(p.base_legs)],
            ['After a loss', p.has_recovery_legs ? legText(p.recovery_legs) : 'same contracts'],
            ['Duration', `${p.duration_ticks} tick${p.duration_ticks === 1 ? '' : 's'}`],
            ['Initial stake', `$${p.initial_stake}`],
            ['Martingale', p.martingale_multiplier === 1 ? 'off' : `x${p.martingale_multiplier} after a loss`],
            ['Take profit', `$${p.take_profit}`],
            ['Stop loss', `$${p.stop_loss}`],
        ];
    }
    const rows = [
        ['Strategy', spec.label],
        ['Symbol', p.symbol],
        ['Trade', p.direction.charAt(0).toUpperCase() + p.direction.slice(1)],
    ];
    if (typeof p.prediction === 'number') rows.push(['Digit', String(p.prediction)]);
    rows.push(
        ['Duration', `${p.duration_ticks} tick${p.duration_ticks === 1 ? '' : 's'}`],
        ['Initial stake', `$${p.initial_stake}`],
        ['Martingale', p.martingale_multiplier === 1 ? 'off' : `x${p.martingale_multiplier} after a loss`],
        ['Take profit', `$${p.take_profit}`],
        ['Stop loss', `$${p.stop_loss}`]
    );
    return rows;
}

module.exports = {
    STRATEGIES,
    STRATEGY_IDS,
    VALID_SYMBOLS,
    normalizeStrategyParams,
    buildStrategyXml,
    describeParams,
};
