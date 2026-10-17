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

// Clamp everything the model returned to values Deriv will accept. Anything missing or out of range
// falls back to a safe default; nothing from the model is ever copied into the XML unchecked.
function normalizeStrategyParams(strategyId, raw) {
    const spec = STRATEGIES[strategyId];
    if (!spec) throw new Error(`Unknown strategy: ${strategyId}`);
    const input = raw || {};

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

function buildStrategyXml(strategyId, rawParams) {
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
function describeParams(p) {
    const spec = STRATEGIES[p.strategy];
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
