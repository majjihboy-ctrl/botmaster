// Builds a bot's Blockly XML from a normalized spec (see spec.js) out of tested modules:
//   entry condition  -> stake mode -> contract legs (+ recovery legs) -> risk stops.
// Nothing from the model is copied into the XML; every number and option has been clamped first.
//
// Plain CommonJS so Vercel's Node runtime never has to guess the module system.

const { STRATEGIES } = require('./strategy-templates');

const VAR_IDS = {
    stake: 'bm_stake_var',
    losses: 'bm_losses_var',
    cycle: 'bm_cycle_var',
    fib_a: 'bm_fiba_var',
    fib_b: 'bm_fibb_var',
    digit: 'bm_digit_var',
    side: 'bm_side_var',
    turn: 'bm_turn_var',
    recovery: 'bm_recovery_var',
    rsi: 'bm_rsi_var',
    sma: 'bm_sma_var',
    ema: 'bm_ema_var',
};

const esc = text =>
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = n => `<block type="math_number"><field name="NUM">${n}</field></block>`;
const getV = name => `<block type="variables_get"><field name="VAR" id="${VAR_IDS[name]}">${name}</field></block>`;
const setV = (name, valueXml) =>
    `<block type="variables_set"><field name="VAR" id="${VAR_IDS[name]}">${name}</field><value name="VALUE">${valueXml}</value></block>`;
// Chains complete blocks into one statement stack (each block must end with </block>).
const stack = blocks =>
    [blocks]
        .flat(Infinity)
        .filter(Boolean)
        .reduceRight((next, b) => (next ? b.replace(/<\/block>$/, () => `<next>${next}</next></block>`) : b), '');
const cmp = (op, aXml, bXml) =>
    `<block type="logic_compare"><field name="OP">${op}</field><value name="A">${aXml}</value><value name="B">${bXml}</value></block>`;
const cmpVar = (op, name, n) => cmp(op, getV(name), num(n));
const logic = (op, aXml, bXml) =>
    `<block type="logic_operation"><field name="OP">${op}</field><value name="A">${aXml}</value><value name="B">${bXml}</value></block>`;
const ifThen = (cond, thenXml) =>
    `<block type="controls_if"><value name="IF0">${cond}</value><statement name="DO0">${stack(thenXml)}</statement></block>`;
const ifElse = (cond, thenXml, elseXml) =>
    `<block type="controls_if"><mutation else="1"></mutation><value name="IF0">${cond}</value><statement name="DO0">${stack(thenXml)}</statement><statement name="ELSE">${stack(elseXml)}</statement></block>`;
const arith = (op, aXml, bXml) =>
    `<block type="math_arithmetic"><field name="OP">${op}</field><value name="A"><shadow type="math_number"><field name="NUM">1</field></shadow>${aXml}</value><value name="B"><shadow type="math_number"><field name="NUM">1</field></shadow>${bXml}</value></block>`;
const text = t => `<block type="text"><field name="TEXT">${esc(t)}</field></block>`;
const purchase = contract => `<block type="purchase"><field name="PURCHASE_LIST">${contract}</field></block>`;
const notify = (type, message) =>
    `<block type="notify"><field name="NOTIFICATION_TYPE">${type}</field><field name="NOTIFICATION_SOUND">silent</field><value name="MESSAGE">${text(message)}</value></block>`;

// ---- derived layout -------------------------------------------------------------------------------

function layout(spec) {
    const strategy = STRATEGIES[spec.strategy];
    const directions = Object.keys(strategy.directions);
    const hasRecovery = spec.recovery_legs.length > 0;
    const baseLegs = spec.base_legs.length === 1 ? [spec.base_legs[0], spec.base_legs[0]] : spec.base_legs;
    const recoveryLegs = hasRecovery
        ? spec.recovery_legs.length === 1
            ? [spec.recovery_legs[0], spec.recovery_legs[0]]
            : spec.recovery_legs
        : baseLegs;
    const allLegs = [...baseLegs, ...recoveryLegs];
    const hasPrediction = Boolean(strategy.prediction);

    const sameDirection = allLegs.every(l => l.direction === allLegs[0].direction);
    const sameDigit = !hasPrediction || allLegs.every(l => l.digit === allLegs[0].digit);
    // One contract, one barrier, nothing to rotate: the simplest possible bot.
    const isStatic = spec.base_legs.length === 1 && !hasRecovery;

    return {
        strategy,
        directions,
        hasRecovery,
        baseLegs,
        recoveryLegs,
        hasPrediction,
        sameDirection,
        sameDigit,
        isStatic,
        contractOf: leg => strategy.directions[leg.direction],
        // "side" variable: index of the leg's direction in `directions`.
        sideOf: leg => directions.indexOf(leg.direction),
        typeList: sameDirection ? strategy.directions[allLegs[0].direction] : 'both',
        usesSide: !isStatic && !sameDirection,
        usesDigit: hasPrediction && !isStatic && !sameDigit,
        rotates: !isStatic,
    };
}

// ---- modules --------------------------------------------------------------------------------------

function entryCondition(entry) {
    switch (entry.type) {
        case 'last_digit':
            return cmp(entry.op, '<block type="last_digit"></block>', num(entry.digit));
        case 'last_digits':
            return `<block type="last_digits_condition"><field name="N">${entry.count}</field><field name="CONDITION">${entry.op}</field><field name="DIGIT">${entry.digit}</field></block>`;
        case 'digit_percent':
            return cmp(
                'GTE',
                `<block type="over_under_percent"><field name="TYPE">${entry.side === 'under' ? 'UNDER' : 'OVER'}</field><field name="THRESH">${entry.digit}</field><field name="N">${entry.ticks}</field></block>`,
                num(entry.min_percent)
            );
        case 'parity_percent':
            return cmp(
                'GTE',
                `<block type="even_odd_percent"><field name="TYPE">${entry.parity === 'odd' ? 'ODD' : 'EVEN'}</field><field name="N">${entry.ticks}</field><field name="LBL">DIGITS</field></block>`,
                num(entry.min_percent)
            );
        case 'direction':
            return `<block type="check_direction"><field name="CHECK_DIRECTION">${entry.direction}</field></block>`;
        case 'rsi':
            return cmp(entry.op, getV('rsi'), num(entry.level));
        case 'sma':
            return cmp(entry.op, '<block type="tick"></block>', getV('sma'));
        case 'ema':
            return cmp(entry.op, '<block type="tick"></block>', getV('ema'));
        case 'price':
            return cmp(entry.op, '<block type="tick"></block>', num(entry.value));
        default:
            return null;
    }
}

// Statements that must run before the entry condition is evaluated (indicator calculations).
function entryPrelude(entry) {
    const indicator = (type, varName, period) =>
        `<block type="${type}"><field name="VARIABLE" id="${VAR_IDS[varName]}">${varName}</field><statement name="STATEMENT"><block type="input_list"><value name="INPUT_LIST"><block type="ticks"></block></value><next><block type="period"><value name="PERIOD">${num(period)}</value></block></next></block></statement></block>`;
    if (entry.type === 'rsi') return indicator('rsi_statement', 'rsi', entry.period);
    if (entry.type === 'sma') return indicator('sma_statement', 'sma', entry.period);
    if (entry.type === 'ema') return indicator('ema_statement', 'ema', entry.period);
    return '';
}

function purchaseBlock(spec, lay) {
    if (lay.usesSide) {
        return ifElse(
            cmpVar('EQ', 'side', 0),
            purchase(lay.strategy.directions[lay.directions[0]]),
            purchase(lay.strategy.directions[lay.directions[1]])
        );
    }
    return purchase(lay.contractOf(lay.baseLegs[0]));
}

const entriesOf = spec => [spec.entry, ...(spec.extra_entries || [])].filter(e => e && e.type !== 'none');

function beforePurchaseStack(spec, lay) {
    const buy = purchaseBlock(spec, lay);
    const entries = entriesOf(spec);
    if (entries.length === 0) return buy;
    // All conditions together (AND) or any one of them (OR).
    const op = spec.entry_logic === 'any' ? 'OR' : 'AND';
    const cond = entries.map(entryCondition).reduce((a, b) => logic(op, a, b));
    // "after_loss": the first trade (and every trade after a win) goes straight in; the entry is only
    // required while recovering from a loss.
    const gate = spec.entry.apply === 'after_loss' ? logic('OR', cmpVar('EQ', 'losses', 0), cond) : cond;
    return stack([entries.map(entryPrelude), ifThen(gate, buy)]);
}

const needsLosses = spec =>
    spec.entry.apply === 'after_loss' && spec.entry.type !== 'none' ? true : spec.max_consecutive_losses > 0;

function stakeResetBlocks(spec) {
    return [
        setV('stake', num(spec.initial_stake)),
        ...(spec.stake_mode === 'fibonacci' ? [setV('fib_a', num(0)), setV('fib_b', num(1))] : []),
    ];
}

function stakeOnWin(spec) {
    if (spec.stake_mode === 'flat') return '';
    if (spec.stake_mode === 'dalembert') {
        // Step back down by one step, never below the initial stake.
        return ifElse(
            cmp('GTE', arith('MINUS', getV('stake'), num(spec.stake_step)), num(spec.initial_stake)),
            setV('stake', arith('MINUS', getV('stake'), num(spec.stake_step))),
            setV('stake', num(spec.initial_stake))
        );
    }
    return stakeResetBlocks(spec);
}

function stakeOnLoss(spec) {
    const parts = [];
    if (spec.stake_mode === 'martingale') {
        parts.push(setV('stake', arith('MULTIPLY', getV('stake'), num(spec.martingale_multiplier))));
    } else if (spec.stake_mode === 'dalembert') {
        parts.push(setV('stake', arith('ADD', getV('stake'), num(spec.stake_step))));
    } else if (spec.stake_mode === 'fibonacci') {
        // fib_b = fib_a + fib_b, then fib_a = (new fib_b) - (old fib_a) = old fib_b
        parts.push(setV('fib_b', arith('ADD', getV('fib_a'), getV('fib_b'))));
        parts.push(setV('fib_a', arith('MINUS', getV('fib_b'), getV('fib_a'))));
        parts.push(setV('stake', arith('MULTIPLY', num(spec.initial_stake), getV('fib_b'))));
    }
    if (spec.reset_after_losses > 0 && spec.stake_mode !== 'flat') {
        parts.push(setV('cycle', arith('ADD', getV('cycle'), num(1))));
        parts.push(
            ifThen(
                cmpVar('GTE', 'cycle', spec.reset_after_losses),
                stack([...stakeResetBlocks(spec), setV('cycle', num(0))])
            )
        );
    }
    if (spec.max_stake > 0 && spec.stake_mode !== 'flat') {
        parts.push(ifThen(cmp('GT', getV('stake'), num(spec.max_stake)), setV('stake', num(spec.max_stake))));
    }
    return parts;
}

function resultBlock(spec, lay) {
    const flip = setV('turn', arith('MINUS', num(1), getV('turn')));
    let legWin = '';
    let legLoss = '';
    if (lay.rotates) {
        // With recovery legs, a win/loss that changes mode restarts that mode's rotation at its first leg.
        legWin = lay.hasRecovery
            ? ifElse(cmpVar('EQ', 'recovery', 1), stack([setV('recovery', num(0)), setV('turn', num(0))]), flip)
            : flip;
        legLoss = lay.hasRecovery
            ? ifElse(cmpVar('EQ', 'recovery', 0), stack([setV('recovery', num(1)), setV('turn', num(0))]), flip)
            : flip;
    }
    const onWin = stack([
        stakeOnWin(spec),
        needsLosses(spec) ? setV('losses', num(0)) : '',
        spec.reset_after_losses > 0 && spec.stake_mode !== 'flat' ? setV('cycle', num(0)) : '',
        legWin,
    ]);
    const onLoss = stack([
        stakeOnLoss(spec),
        needsLosses(spec) ? setV('losses', arith('ADD', getV('losses'), num(1))) : '',
        legLoss,
    ]);
    if (!onWin && !onLoss) return '';
    return ifElse('<block type="contract_check_result"><field name="CHECK_RESULT">win</field></block>', onWin, onLoss);
}

function setLeg(spec, lay, leg) {
    return stack([
        lay.usesSide ? setV('side', num(lay.sideOf(leg))) : '',
        lay.usesDigit ? setV('digit', num(leg.digit)) : '',
    ]);
}

function selectLegBlock(spec, lay) {
    if (!lay.rotates || (!lay.usesSide && !lay.usesDigit)) return '';
    const [b0, b1] = lay.baseLegs;
    const [r0, r1] = lay.recoveryLegs;
    const pick = (a, b) => ifElse(cmpVar('EQ', 'turn', 0), setLeg(spec, lay, a), setLeg(spec, lay, b));
    return ifElse(cmpVar('EQ', 'recovery', 0), pick(b0, b1), pick(r0, r1));
}

function limitsBlock(spec) {
    const stops = [
        [
            cmp('GTE', '<block type="total_profit"></block>', num(spec.take_profit)),
            'success',
            'Take profit reached - bot stopped.',
        ],
        [
            cmp('LTE', '<block type="total_profit"></block>', num(-spec.stop_loss)),
            'warn',
            'Stop loss reached - bot stopped.',
        ],
    ];
    if (spec.max_runs > 0) {
        stops.push([
            cmp('GTE', '<block type="total_runs"></block>', num(spec.max_runs)),
            'info',
            'Maximum runs reached - bot stopped.',
        ]);
    }
    if (spec.max_consecutive_losses > 0) {
        stops.push([
            cmpVar('GTE', 'losses', spec.max_consecutive_losses),
            'warn',
            'Too many losses in a row - bot stopped.',
        ]);
    }
    const branches = stops
        .map(
            ([cond, type, message], i) =>
                `<value name="IF${i}">${cond}</value><statement name="DO${i}">${notify(type, message)}</statement>`
        )
        .join('');
    return `<block type="controls_if"><mutation elseif="${stops.length - 1}" else="1"></mutation>${branches}<statement name="ELSE"><block type="trade_again"></block></statement></block>`;
}

function initialization(spec, lay) {
    const first = lay.baseLegs[0];
    return stack([
        setV('stake', num(spec.initial_stake)),
        needsLosses(spec) ? setV('losses', num(0)) : '',
        spec.reset_after_losses > 0 && spec.stake_mode !== 'flat' ? setV('cycle', num(0)) : '',
        ...(spec.stake_mode === 'fibonacci' ? [setV('fib_a', num(0)), setV('fib_b', num(1))] : []),
        lay.usesSide ? setV('side', num(lay.sideOf(first))) : '',
        lay.usesDigit ? setV('digit', num(first.digit)) : '',
        ...(lay.rotates ? [setV('turn', num(0)), setV('recovery', num(0))] : []),
    ]);
}

function buildAdvancedXml(spec) {
    const lay = layout(spec);
    const first = lay.baseLegs[0];
    const prediction = lay.hasPrediction
        ? `<value name="PREDICTION"><shadow type="math_number_positive"><field name="NUM">${first.digit}</field></shadow>${lay.usesDigit ? getV('digit') : ''}</value>`
        : '';

    const body = `<block type="trade_definition" deletable="false" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${spec.symbol}</field>
        <next>
          <block type="trade_definition_tradetype" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${lay.strategy.category}</field>
            <field name="TRADETYPE_LIST">${lay.strategy.trade_type}</field>
            <next>
              <block type="trade_definition_contracttype" deletable="false" movable="false">
                <field name="TYPE_LIST">${lay.typeList}</field>
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
    <statement name="INITIALIZATION">${initialization(spec, lay)}</statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions">
        <mutation has_first_barrier="false" has_second_barrier="false" has_prediction="${lay.hasPrediction}"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="CURRENCY_LIST">USD</field>
        <value name="DURATION"><shadow type="math_number_positive"><field name="NUM">${spec.duration_ticks}</field></shadow></value>
        <value name="AMOUNT"><shadow type="math_number_positive"><field name="NUM">${spec.initial_stake}</field></shadow>${getV('stake')}</value>
        ${prediction}
      </block>
    </statement>
  </block>
  <block type="before_purchase" x="0" y="600">
    <statement name="BEFOREPURCHASE_STACK">${beforePurchaseStack(spec, lay)}</statement>
  </block>
  <block type="after_purchase" x="720" y="0">
    <statement name="AFTERPURCHASE_STACK">${stack([resultBlock(spec, lay), selectLegBlock(spec, lay), limitsBlock(spec)])}</statement>
  </block>`;

    const used = Object.entries(VAR_IDS).filter(([, id]) => body.includes(`id="${id}"`));
    const variables = used.map(([name, id]) => `<variable id="${id}">${name}</variable>`).join('\n    ');
    return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    ${variables}
  </variables>
  ${body}
</xml>
`;
}

// ---- summary rows for the UI ----------------------------------------------------------------------

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const legLabel = (spec, leg) =>
    STRATEGIES[spec.strategy].prediction ? `${cap(leg.direction)} ${leg.digit}` : cap(leg.direction);
const legsText = (spec, legs) => {
    const list =
        legs.length === 2 && legs[0].direction === legs[1].direction && legs[0].digit === legs[1].digit
            ? [legs[0]]
            : legs;
    return list.map(l => legLabel(spec, l)).join(' / ');
};
const OPS = { EQ: '=', NEQ: '≠', LT: '<', LTE: '≤', GT: '>', GTE: '≥', LESS: '<', LEQ: '≤', GREATER: '>', GEQ: '≥' };

function describeEntry(entry) {
    const when = entry.apply === 'after_loss' ? ' (only after a loss)' : '';
    switch (entry.type) {
        case 'last_digit':
            return `Last digit ${OPS[entry.op]} ${entry.digit}${when}`;
        case 'last_digits':
            return `Last ${entry.count} digits ${OPS[entry.op]} ${entry.digit}${when}`;
        case 'digit_percent':
            return `${cap(entry.side)} ${entry.digit} in ≥ ${entry.min_percent}% of last ${entry.ticks} ticks${when}`;
        case 'parity_percent':
            return `${cap(entry.parity)} in ≥ ${entry.min_percent}% of last ${entry.ticks} ticks${when}`;
        case 'direction':
            return `Market is ${entry.direction === 'fall' ? 'falling' : 'rising'}${when}`;
        case 'rsi':
            return `RSI(${entry.period}) ${OPS[entry.op]} ${entry.level}${when}`;
        case 'sma':
            return `Price ${OPS[entry.op]} SMA(${entry.period})${when}`;
        case 'ema':
            return `Price ${OPS[entry.op]} EMA(${entry.period})${when}`;
        case 'price':
            return `Price ${OPS[entry.op]} ${entry.value}${when}`;
        default:
            return 'Every run';
    }
}

function describeStake(spec) {
    switch (spec.stake_mode) {
        case 'flat':
            return 'Flat stake';
        case 'dalembert':
            return `D'Alembert (±$${spec.stake_step})`;
        case 'fibonacci':
            return 'Fibonacci';
        default:
            return spec.martingale_multiplier === 1 ? 'Martingale off' : `Martingale x${spec.martingale_multiplier}`;
    }
}

function describeSpec(spec) {
    const strategy = STRATEGIES[spec.strategy];
    const rows = [
        ['Strategy', strategy.label],
        ['Symbol', spec.symbol],
        ['Trades', legsText(spec, spec.base_legs) + (spec.base_legs.length === 2 ? ' (in turns)' : '')],
    ];
    if (spec.recovery_legs.length) rows.push(['After a loss', legsText(spec, spec.recovery_legs)]);
    rows.push(
        [
            'Entry',
            entriesOf(spec).length
                ? entriesOf(spec)
                      .map(describeEntry)
                      .join(spec.entry_logic === 'any' ? ' OR ' : ' AND ')
                : 'Every run',
        ],
        ['Duration', `${spec.duration_ticks} tick${spec.duration_ticks === 1 ? '' : 's'}`],
        ['Initial stake', `$${spec.initial_stake}`],
        ['Stake after a loss', describeStake(spec)]
    );
    if (spec.max_stake > 0) rows.push(['Max stake', `$${spec.max_stake}`]);
    if (spec.reset_after_losses > 0) rows.push(['Reset stake after', `${spec.reset_after_losses} losses`]);
    rows.push(['Take profit', `$${spec.take_profit}`], ['Stop loss', `$${spec.stop_loss}`]);
    if (spec.max_consecutive_losses > 0) rows.push(['Stop after', `${spec.max_consecutive_losses} losses in a row`]);
    if (spec.max_runs > 0) rows.push(['Max runs', String(spec.max_runs)]);
    return rows;
}

module.exports = { buildAdvancedXml, describeSpec, VAR_IDS };
