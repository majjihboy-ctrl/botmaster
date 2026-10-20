/**
 * Advanced AI Bot Builder: every bot the module builder can produce must load into the real Blockly
 * workspace, generate the engine code, and behave correctly when the generated program is run against
 * scripted wins / losses and tick analysis. The few-shot examples taught to the AI are built here too.
 */
import vm from 'vm';

jest.mock('../../../services/api/api-base', () => ({ api_base: {} }));
jest.mock('../../../services/api/api-helpers', () => ({ __esModule: true, default: { instance: {} } }));
jest.mock('../../../services/api/ticks_service', () => ({ __esModule: true, default: class {} }));
jest.mock('../../../services/tradeEngine/utils/interpreter', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('../../dbot-store', () => ({
    __esModule: true,
    default: { instance: { client: { is_logged_in: true, loginid: 'CR123', currency: 'USD' } } },
}));

const { normalizeSpec } = require('../../../../../../api/_lib/bot-spec');
const { buildAdvancedXml } = require('../../../../../../api/_lib/advanced-bot');
const { validateBotXml } = require('../../../../../../api/_lib/validate-xml');
const { EXAMPLES } = require('../../../../../../api/_lib/prompt');
const { compileBot } = require('../../../../../../api/_lib/pipeline');

let Blockly;
let DBot;

beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    require('@deriv-com/translations').localize.mockImplementation((text, values = {}) =>
        text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (values[key] !== undefined ? values[key] : match))
    );
    const { loadBlockly } = await import('../../blockly');
    await loadBlockly(false);
    Blockly = window.Blockly;
    ['initSvg', 'renderEfficiently', 'queueRender', 'render', 'bumpNeighbours', 'scheduleSnapAndBump'].forEach(name => {
        if (typeof Blockly.Block.prototype[name] !== 'function') Blockly.Block.prototype[name] = function () {};
    });
    DBot = (await import('../../dbot')).default;
}, 120000);

const build = raw => {
    const { spec } = normalizeSpec(raw);
    return { spec, xml: buildAdvancedXml(spec) };
};

function loadXml(xml) {
    const workspace = new Blockly.Workspace();
    const varDB = new Blockly.Names('window');
    varDB.variableMap = workspace.getVariableMap();
    Blockly.JavaScript.variableDB_ = varDB;
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), workspace);
    return workspace;
}

// Runs the app's real generated program against a stub `Bot`. `analysis` answers the tick-analysis
// blocks; `ticksPerRun` limits how many ticks the bot may wait for an entry before the script ends.
function simulate(workspace, profits, analysis = {}) {
    const code = DBot.generateCode.call({ workspace });
    const events = [];
    let total = 0;
    let run = -1;
    let purchased = false;
    let pending = 0;
    let tick = 0;
    let waited = 0;
    let lastWon = null;

    const Bot = {
        init: () => {},
        highlightBlock: () => {},
        getLastTick: () => ({ epoch: (tick += 1) }),
        start: o => {
            purchased = false;
            waited = 0;
            events.push({ type: 'start', amount: o.amount, prediction: o.prediction, duration: o.duration });
        },
        purchase: contract => {
            run += 1;
            if (run >= profits.length) throw new Error('RAN_OUT_OF_SCRIPT');
            purchased = true;
            pending = profits[run];
            events.push({ type: 'purchase', contract });
        },
        shouldRunAfterPurchase: () => {
            total += pending;
            lastWon = pending > 0;
            return true;
        },
        hasQueuedResult: () => false,
        isResult: result => (pending > 0 ? 'win' : 'loss') === result,
        getTotalProfit: () => total,
        getTotalRuns: () => run + 1,
        notify: o => events.push({ type: 'notify', message: o.message }),
        isTradeAgain: () => {},
        getLastDigit: () => (analysis.lastDigit ? analysis.lastDigit(lastWon, waited) : 0),
        getLastDigitsCondition: o => (analysis.digitsCondition ? analysis.digitsCondition(o, lastWon, waited) : true),
        getOverUnderPercent: o => (analysis.overUnderPercent ? analysis.overUnderPercent(o) : 100),
        getEvenOddPercent: o => (analysis.evenOddPercent ? analysis.evenOddPercent(o) : 100),
        checkDirection: d => (analysis.direction ? analysis.direction(d) : true),
        getTicks: () => [1, 2, 3],
        rsi: () => (analysis.rsi !== undefined ? analysis.rsi : 50),
        sma: () => (analysis.sma !== undefined ? analysis.sma : 100),
        ema: () => (analysis.ema !== undefined ? analysis.ema : 100),
    };

    let ranOut = false;
    try {
        vm.runInNewContext(
            code,
            {
                Bot,
                watch: stage => {
                    if (stage !== 'before') return !purchased ? false : false;
                    waited += 1;
                    if (waited > 25) throw new Error('NEVER_ENTERED');
                    return !purchased;
                },
                sleep: () => {},
            },
            { timeout: 5000 }
        );
    } catch (error) {
        if (error.message === 'RAN_OUT_OF_SCRIPT') ranOut = true;
        else if (error.message !== 'NEVER_ENTERED') throw error;
        else ranOut = 'never_entered';
    }
    return {
        code,
        ranOut,
        events,
        stakes: events.filter(e => e.type === 'start').map(e => e.amount),
        contracts: events.filter(e => e.type === 'purchase').map(e => e.contract),
        predictions: events.filter(e => e.type === 'start').map(e => e.prediction),
        notes: events.filter(e => e.type === 'notify').map(e => e.message),
    };
}

// ---- 1. everything the builder can express loads and generates code -----------------------------------

const LEGS = {
    rise_fall: [{ direction: 'rise' }, { direction: 'fall' }],
    even_odd: [{ direction: 'even' }, { direction: 'odd' }],
    over_under: [
        { direction: 'over', digit: 2 },
        { direction: 'under', digit: 7 },
    ],
    matches_differs: [
        { direction: 'differs', digit: 7 },
        { direction: 'matches', digit: 3 },
    ],
};
const ENTRIES = [
    { type: 'none' },
    { type: 'last_digit', op: 'GTE', digit: 4 },
    { type: 'last_digits', count: 3, op: 'LT', digit: 5, apply: 'after_loss' },
    { type: 'digit_percent', side: 'over', digit: 4, ticks: 100, min_percent: 60 },
    { type: 'parity_percent', parity: 'odd', ticks: 50, min_percent: 55 },
    { type: 'direction', direction: 'rise' },
    { type: 'rsi', period: 14, op: 'LT', level: 30 },
    { type: 'sma', period: 20, op: 'GT' },
    { type: 'ema', period: 20, op: 'LT' },
    { type: 'price', op: 'GT', value: 1234.5 },
];
const STAKES = [
    { stake_mode: 'martingale', martingale_multiplier: 2 },
    { stake_mode: 'dalembert', stake_step: 0.5, max_stake: 10 },
    { stake_mode: 'fibonacci', reset_after_losses: 3 },
    { stake_mode: 'flat' },
];
const SHAPES = [
    { name: 'single', extra: s => ({ direction: LEGS[s][0].direction, prediction: LEGS[s][0].digit }) },
    { name: 'two legs', extra: s => ({ base_legs: LEGS[s] }) },
    { name: 'recovery', extra: s => ({ base_legs: [LEGS[s][0]], recovery_legs: [LEGS[s][1]] }) },
];

const MATRIX = [];
Object.keys(LEGS).forEach(strategy => {
    SHAPES.forEach(shape => {
        ENTRIES.forEach((entry, i) => {
            const stake = STAKES[(i + MATRIX.length) % STAKES.length];
            MATRIX.push([
                `${strategy} / ${shape.name} / ${entry.type} / ${stake.stake_mode}`,
                {
                    strategy,
                    symbol: 'R_75',
                    duration_ticks: 5,
                    entries: [entry],
                    ...shape.extra(strategy),
                    ...stake,
                    max_consecutive_losses: 4,
                    max_runs: 50,
                },
            ]);
        });
    });
});

describe('every module combination loads into Blockly and generates the engine code', () => {
    it.each(MATRIX)('%s', (_name, raw) => {
        const { xml } = build(raw);
        expect(validateBotXml(xml)).toEqual([]);
        const workspace = loadXml(xml);
        const top = workspace
            .getTopBlocks()
            .map(b => b.type)
            .sort();
        expect(top).toEqual(['after_purchase', 'before_purchase', 'trade_definition']);
        const code = Blockly.JavaScript.javascriptGenerator.workspaceToCode(workspace);
        expect(code).toContain("symbol              : 'R_75'");
        expect(code).toContain('Bot.purchase(');
        // The app's own wrapper must also be able to produce runnable code from it.
        expect(DBot.generateCode.call({ workspace }).length).toBeGreaterThan(200);
        workspace.dispose();
    });
});

describe('the examples taught to the AI all build valid bots', () => {
    it.each(EXAMPLES.map(e => [e.prompt.slice(0, 60), e.spec]))('%s', (_label, spec) => {
        const result = compileBot(spec);
        expect(result.errors).toEqual([]);
        const workspace = loadXml(result.xml);
        expect(workspace.getAllBlocks().length).toBeGreaterThan(5);
        workspace.dispose();
    });
});

// ---- 2. behaviour ---------------------------------------------------------------------------------------

describe('stake modes', () => {
    const base = { strategy: 'even_odd', direction: 'even', initial_stake: 1, take_profit: 500, stop_loss: 500 };

    it('martingale: x2 after each loss, back to the initial stake after a win', () => {
        const { stakes } = simulate(loadXml(build({ ...base, stake_mode: 'martingale' }).xml), [-1, -2, 5, -1, 3]);
        expect(stakes).toEqual([1, 2, 4, 1, 2, 1]);
    });

    it("d'Alembert: +step after a loss, -step after a win, never below the initial stake", () => {
        const raw = { ...base, stake_mode: 'dalembert', stake_step: 0.5 };
        const { stakes } = simulate(loadXml(build(raw).xml), [-1, -1, -1, 2, 2, 2, 2]);
        expect(stakes.slice(0, 7)).toEqual([1, 1.5, 2, 2.5, 2, 1.5, 1]);
    });

    it('fibonacci: 1, 1, 2, 3, 5 after consecutive losses, reset on a win', () => {
        const { stakes } = simulate(
            loadXml(build({ ...base, stake_mode: 'fibonacci' }).xml),
            [-1, -1, -1, -1, -1, 9, -1]
        );
        expect(stakes.slice(0, 8)).toEqual([1, 1, 2, 3, 5, 8, 1, 1]);
    });

    it('flat: the stake never changes', () => {
        const { stakes } = simulate(loadXml(build({ ...base, stake_mode: 'flat' }).xml), [-1, -1, 4, -1]);
        expect(stakes.slice(0, 4)).toEqual([1, 1, 1, 1]);
    });

    it('max_stake caps the stake', () => {
        const raw = { ...base, stake_mode: 'martingale', martingale_multiplier: 3, max_stake: 5 };
        const { stakes } = simulate(loadXml(build(raw).xml), [-1, -1, -1, -1]);
        expect(stakes.slice(0, 4)).toEqual([1, 3, 5, 5]);
    });

    it('reset_after_losses goes back to the initial stake after N losses in a row', () => {
        const raw = { ...base, stake_mode: 'martingale', reset_after_losses: 3 };
        const { stakes } = simulate(loadXml(build(raw).xml), [-1, -1, -1, -1, -1]);
        expect(stakes.slice(0, 5)).toEqual([1, 2, 4, 1, 2]);
    });
});

describe('risk stops', () => {
    const base = {
        strategy: 'rise_fall',
        direction: 'rise',
        initial_stake: 1,
        stake_mode: 'flat',
        take_profit: 500,
        stop_loss: 500,
    };

    it('stops after N losses in a row', () => {
        const { stakes, notes, ranOut } = simulate(
            loadXml(build({ ...base, max_consecutive_losses: 3 }).xml),
            [-1, -1, -1, -1, -1]
        );
        expect(ranOut).toBe(false);
        expect(stakes).toEqual([1, 1, 1]);
        expect(notes).toEqual(['Too many losses in a row - bot stopped.']);
    });

    it('a win resets the losses-in-a-row count', () => {
        const { stakes } = simulate(
            loadXml(build({ ...base, max_consecutive_losses: 3 }).xml),
            [-1, -1, 4, -1, -1, -1, -1]
        );
        expect(stakes).toEqual([1, 1, 1, 1, 1, 1]);
    });

    it('stops after the maximum number of runs', () => {
        const { stakes, notes, ranOut } = simulate(loadXml(build({ ...base, max_runs: 4 }).xml), [1, 1, 1, 1, 1, 1]);
        expect(ranOut).toBe(false);
        expect(stakes).toEqual([1, 1, 1, 1]);
        expect(notes).toEqual(['Maximum runs reached - bot stopped.']);
    });
});

describe('entry conditions', () => {
    const base = {
        strategy: 'over_under',
        direction: 'over',
        prediction: 1,
        initial_stake: 1,
        take_profit: 500,
        stop_loss: 500,
    };

    it('waits until the entry condition holds before buying', () => {
        const raw = { ...base, entries: [{ type: 'last_digit', op: 'EQ', digit: 1 }] };
        let polls = 0;
        const { stakes, contracts } = simulate(loadXml(build(raw).xml), [1, 1], {
            lastDigit: () => {
                polls += 1;
                return polls % 3 === 0 ? 1 : 7; // only every third tick qualifies
            },
        });
        expect(contracts.slice(0, 2)).toEqual(['DIGITOVER', 'DIGITOVER']);
        expect(polls).toBeGreaterThanOrEqual(6);
        expect(stakes.length).toBeGreaterThanOrEqual(2);
    });

    it('after_loss: trades straight away until a loss, then waits for the entry', () => {
        const raw = { ...base, entries: [{ type: 'last_digit', op: 'EQ', digit: 1, apply: 'after_loss' }] };
        const digitsSeen = [];
        const { contracts } = simulate(loadXml(build(raw).xml), [-1, 5], {
            lastDigit: (lastWon, waited) => {
                digitsSeen.push({ lastWon, waited });
                return waited >= 3 ? 1 : 8;
            },
        });
        // First trade does not need the entry (losses = 0); after the loss it waits until digit 1 shows up.
        expect(contracts).toEqual(['DIGITOVER', 'DIGITOVER']);
        expect(digitsSeen.some(d => d.lastWon === false && d.waited >= 3)).toBe(true);
    });

    it('never buys while the entry is false (RSI)', () => {
        const raw = {
            strategy: 'rise_fall',
            direction: 'rise',
            entry: { type: 'rsi', period: 14, op: 'LT', level: 30 },
        };
        const { ranOut, contracts } = simulate(loadXml(build(raw).xml), [1], { rsi: 55 });
        expect(ranOut).toBe('never_entered');
        expect(contracts).toEqual([]);
    });

    it('buys when the RSI condition is met', () => {
        const raw = {
            strategy: 'rise_fall',
            direction: 'rise',
            entry: { type: 'rsi', period: 14, op: 'LT', level: 30 },
        };
        const { contracts } = simulate(loadXml(build(raw).xml), [1], { rsi: 22 });
        expect(contracts[0]).toBe('CALL');
    });

    it('digit percentage entry compares against the minimum', () => {
        const raw = {
            ...base,
            entries: [{ type: 'digit_percent', side: 'over', digit: 1, ticks: 100, min_percent: 60 }],
        };
        expect(simulate(loadXml(build(raw).xml), [1], { overUnderPercent: () => 59 }).ranOut).toBe('never_entered');
        expect(simulate(loadXml(build(raw).xml), [1], { overUnderPercent: () => 60 }).contracts[0]).toBe('DIGITOVER');
    });
});

describe('several conditions', () => {
    const base = {
        strategy: 'over_under',
        direction: 'over',
        prediction: 1,
        initial_stake: 1,
        take_profit: 500,
        stop_loss: 500,
    };
    const entries = [
        { type: 'last_digit', op: 'EQ', digit: 1 },
        { type: 'rsi', period: 14, op: 'LT', level: 30 },
    ];

    it('ALL: buys only when every condition holds', () => {
        const raw = { ...base, entries, entry_logic: 'all' };
        const run = (digit, rsi) => simulate(loadXml(build(raw).xml), [1], { lastDigit: () => digit, rsi });
        expect(run(1, 50).ranOut).toBe('never_entered');
        expect(run(7, 20).ranOut).toBe('never_entered');
        expect(run(1, 20).contracts[0]).toBe('DIGITOVER');
    });

    it('ANY: buys when at least one condition holds', () => {
        const raw = { ...base, entries, entry_logic: 'any' };
        const run = (digit, rsi) => simulate(loadXml(build(raw).xml), [1], { lastDigit: () => digit, rsi });
        expect(run(7, 50).ranOut).toBe('never_entered');
        expect(run(1, 50).contracts[0]).toBe('DIGITOVER');
        expect(run(7, 20).contracts[0]).toBe('DIGITOVER');
    });

    it('price and EMA conditions load and gate the purchase', () => {
        const raw = {
            strategy: 'rise_fall',
            direction: 'rise',
            entries: [
                { type: 'ema', period: 20, op: 'GT' },
                { type: 'price', op: 'GT', value: 1200 },
            ],
            entry_logic: 'all',
        };
        const xml = build(raw).xml;
        expect(validateBotXml(xml)).toEqual([]);
        expect(simulate(loadXml(xml), [1], { sma: 100 }).code).toContain('Bot.ema(');
    });
});

describe('contract legs', () => {
    const base = {
        strategy: 'over_under',
        initial_stake: 1,
        stake_mode: 'martingale',
        take_profit: 500,
        stop_loss: 500,
    };

    it('rotates two base legs in turns', () => {
        const raw = {
            ...base,
            base_legs: [
                { direction: 'under', digit: 7 },
                { direction: 'over', digit: 2 },
            ],
        };
        const { contracts, predictions } = simulate(loadXml(build(raw).xml), [1, 1, 1, 1]);
        expect(contracts.slice(0, 4)).toEqual(['DIGITUNDER', 'DIGITOVER', 'DIGITUNDER', 'DIGITOVER']);
        expect(predictions.slice(0, 4)).toEqual([7, 2, 7, 2]);
    });

    it('switches to the recovery legs after a loss and back after a win', () => {
        const raw = {
            ...base,
            base_legs: [{ direction: 'over', digit: 2 }],
            recovery_legs: [
                { direction: 'under', digit: 6 },
                { direction: 'over', digit: 4 },
            ],
        };
        const { contracts, predictions } = simulate(loadXml(build(raw).xml), [-1, -1, -1, 5, 1]);
        expect(contracts.slice(0, 5)).toEqual(['DIGITOVER', 'DIGITUNDER', 'DIGITOVER', 'DIGITUNDER', 'DIGITOVER']);
        expect(predictions.slice(0, 5)).toEqual([2, 6, 4, 6, 2]);
    });

    it('uses a plain static contract when nothing rotates', () => {
        const raw = { ...base, direction: 'under', prediction: 6 };
        const { code } = simulate(loadXml(build(raw).xml), [1]);
        expect(code).toContain('contractTypes       : ["DIGITUNDER"]');
        expect(code).toContain('prediction         : 6');
    });
});
