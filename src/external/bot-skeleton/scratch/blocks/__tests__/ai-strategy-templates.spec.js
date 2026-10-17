/**
 * AI Bot Builder strategy templates: every generated bot must load into the real Blockly workspace,
 * produce the code the trade engine expects (using the app's own generateCode wrapper), and behave
 * correctly when run against a scripted sequence of wins and losses.
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

const {
    STRATEGIES,
    STRATEGY_IDS,
    VALID_SYMBOLS,
    normalizeStrategyParams,
    buildStrategyXml,
    describeParams,
} = require('../../../../../../api/_lib/strategy-templates');

let Blockly;
let DBot;
const warnings = [];

beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args.join(' ')));
    // eslint-disable-next-line global-require
    require('@deriv-com/translations').localize.mockImplementation((text, values = {}) =>
        text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (values[key] !== undefined ? values[key] : match))
    );
    const { loadBlockly } = await import('../../blockly');
    await loadBlockly(false);
    Blockly = window.Blockly;
    // The headless workspace has no SVG; these blocks only call these methods to draw themselves.
    ['initSvg', 'renderEfficiently', 'queueRender', 'render', 'bumpNeighbours', 'scheduleSnapAndBump'].forEach(name => {
        if (typeof Blockly.Block.prototype[name] !== 'function') Blockly.Block.prototype[name] = function () {};
    });
    DBot = (await import('../../dbot')).default;
}, 120000);

const SAMPLE = {
    rise_fall: { rise: {}, fall: {} },
    even_odd: { even: {}, odd: {} },
    over_under: { over: { prediction: 3 }, under: { prediction: 6 } },
    matches_differs: { differs: { prediction: 7 }, matches: { prediction: 2 } },
};

const COMBOS = Object.entries(SAMPLE).flatMap(([strategy, dirs]) =>
    Object.entries(dirs).map(([direction, extra]) => [strategy, direction, extra])
);

function loadBot(strategy, params) {
    const workspace = new Blockly.Workspace();
    const varDB = new Blockly.Names('window');
    varDB.variableMap = workspace.getVariableMap();
    Blockly.JavaScript.variableDB_ = varDB;
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(buildStrategyXml(strategy, params)), workspace);
    return workspace;
}

// Runs the app's real generated program against a stub `Bot` that plays back scripted profits.
function simulate(workspace, profits) {
    const code = DBot.generateCode.call({ workspace });
    const events = [];
    let total = 0;
    let run = -1;
    let purchased = false;
    let pending = 0;
    let tick = 0;

    const Bot = {
        init: () => {},
        highlightBlock: () => {},
        getLastTick: () => ({ epoch: (tick += 1) }),
        start: options => {
            purchased = false;
            events.push({
                type: 'start',
                amount: options.amount,
                prediction: options.prediction,
                duration: options.duration,
            });
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
            return true;
        },
        hasQueuedResult: () => false,
        isResult: result => (pending > 0 ? 'win' : 'loss') === result,
        getTotalProfit: () => total,
        notify: options => events.push({ type: 'notify', message: options.message }),
        isTradeAgain: () => {},
    };

    let ranOut = false;
    try {
        vm.runInNewContext(
            code,
            { Bot, watch: stage => stage === 'before' && !purchased, sleep: () => {} },
            { timeout: 5000 }
        );
    } catch (error) {
        if (error.message !== 'RAN_OUT_OF_SCRIPT') throw error;
        ranOut = true;
    }
    return {
        events,
        ranOut,
        stakes: events.filter(e => e.type === 'start').map(e => e.amount),
        notes: events.filter(e => e.type === 'notify').map(e => e.message),
    };
}

describe('every strategy loads into Blockly and generates the engine code', () => {
    it.each(COMBOS)('%s / %s', (strategy, direction, extra) => {
        warnings.length = 0;
        const params = { symbol: 'R_75', direction, initial_stake: 2, duration_ticks: 6, ...extra };
        const workspace = loadBot(strategy, params);
        const top = workspace
            .getTopBlocks()
            .map(b => b.type)
            .sort();
        expect(top).toEqual(['after_purchase', 'before_purchase', 'trade_definition']);

        const expected = STRATEGIES[strategy].directions[direction];
        const code = Blockly.JavaScript.javascriptGenerator.workspaceToCode(workspace);
        expect(code).toContain("symbol              : 'R_75'");
        expect(code).toContain(`contractTypes       : ["${expected}"]`);
        expect(code).toContain(`Bot.purchase('${expected}')`);
        expect(code).toContain('stake = 2;');
        expect(code).toContain('amount             : +(Number(stake).toFixed(2))');
        expect(code).toContain('duration           : 6');
        if (extra.prediction !== undefined) {
            expect(code).toContain(`prediction         : ${extra.prediction}`);
        }
        expect(warnings.filter(w => /unknown|missing|invalid/i.test(w))).toEqual([]);
        workspace.dispose();
    });

    it('keeps a digit of 0 for Over (valid on Deriv)', () => {
        const workspace = loadBot('over_under', { direction: 'over', prediction: 0 });
        const code = Blockly.JavaScript.javascriptGenerator.workspaceToCode(workspace);
        expect(code).toContain('prediction         : 0');
        workspace.dispose();
    });

    it('trade type fields keep the values the template sets', () => {
        const workspace = loadBot('over_under', { direction: 'under', prediction: 6 });
        const type = workspace.getAllBlocks().find(b => b.type === 'trade_definition_tradetype');
        expect(type.getFieldValue('TRADETYPECAT_LIST')).toBe('digits');
        expect(type.getFieldValue('TRADETYPE_LIST')).toBe('overunder');
        const contract = workspace.getAllBlocks().find(b => b.type === 'trade_definition_contracttype');
        expect(contract.getFieldValue('TYPE_LIST')).toBe('DIGITUNDER');
        workspace.dispose();
    });
});

describe('generated bots behave correctly when run', () => {
    const base = { initial_stake: 1, martingale_multiplier: 2, take_profit: 10, stop_loss: 10 };

    it('multiplies the stake after each loss and resets it after a win', () => {
        const workspace = loadBot('even_odd', { ...base, direction: 'even' });
        // loss, loss, win, loss, win -> stakes 1, 2, 4, then reset to 1, 2, then reset to 1 (script ends)
        const { stakes } = simulate(workspace, [-1, -2, 5, -1, 3]);
        expect(stakes).toEqual([1, 2, 4, 1, 2, 1]);
        workspace.dispose();
    });

    it('keeps the stake flat when martingale is 1', () => {
        const workspace = loadBot('rise_fall', { ...base, direction: 'rise', martingale_multiplier: 1 });
        const { stakes } = simulate(workspace, [-1, -1, -1, -1]);
        expect(stakes.slice(0, 4)).toEqual([1, 1, 1, 1]);
        workspace.dispose();
    });

    it('stops at take profit with a notification and does not trade again', () => {
        const workspace = loadBot('over_under', { ...base, direction: 'over', prediction: 3 });
        const { stakes, notes, ranOut } = simulate(workspace, [6, 6, 6, 6]);
        expect(ranOut).toBe(false);
        expect(stakes).toEqual([1, 1]);
        expect(notes).toEqual(['Take profit reached - bot stopped.']);
        workspace.dispose();
    });

    it('stops at stop loss with a notification and does not trade again', () => {
        const workspace = loadBot('matches_differs', { ...base, direction: 'differs', prediction: 5 });
        // stakes 1, 2, 4 lose (-7 total), stake 8 loses (-15 total) which is past the $10 stop loss.
        const { stakes, notes, ranOut } = simulate(workspace, [-1, -2, -4, -8, -16, -32]);
        expect(ranOut).toBe(false);
        expect(stakes).toEqual([1, 2, 4, 8]);
        expect(notes).toEqual(['Stop loss reached - bot stopped.']);
        workspace.dispose();
    });
});

describe('parameter validation', () => {
    it('lists the strategies the AI may choose from', () => {
        expect(STRATEGY_IDS.sort()).toEqual(['even_odd', 'matches_differs', 'over_under', 'rise_fall']);
    });

    it('clamps everything the model returned to values Deriv accepts', () => {
        const p = normalizeStrategyParams('over_under', {
            symbol: 'NOT_A_SYMBOL',
            direction: 'sideways',
            prediction: 9,
            duration_ticks: 99,
            initial_stake: 0.01,
            martingale_multiplier: 50,
            take_profit: -5,
            stop_loss: 'abc',
        });
        expect(p).toEqual({
            strategy: 'over_under',
            symbol: '1HZ100V',
            direction: 'over',
            prediction: 8,
            duration_ticks: 10,
            initial_stake: 0.35,
            martingale_multiplier: 10,
            take_profit: 10,
            stop_loss: 10,
        });
        expect(VALID_SYMBOLS).toContain(p.symbol);
    });

    it('applies the per-direction digit range and the rise/fall minimum duration', () => {
        expect(normalizeStrategyParams('over_under', { direction: 'under', prediction: 0 }).prediction).toBe(1);
        expect(normalizeStrategyParams('over_under', { direction: 'over', prediction: 0 }).prediction).toBe(0);
        expect(normalizeStrategyParams('matches_differs', { direction: 'matches', prediction: 9 }).prediction).toBe(9);
        expect(normalizeStrategyParams('rise_fall', { duration_ticks: 1 }).duration_ticks).toBe(5);
        expect(normalizeStrategyParams('even_odd', {}).prediction).toBeUndefined();
    });

    it('never puts model text into the XML unescaped', () => {
        const xml = buildStrategyXml('even_odd', { symbol: '"><script>', direction: '<b>' });
        expect(xml).not.toContain('<script>');
        expect(xml).toContain('1HZ100V');
    });

    it('describes a bot for the UI', () => {
        const rows = describeParams(normalizeStrategyParams('over_under', { direction: 'under', prediction: 4 }));
        expect(rows).toEqual(
            expect.arrayContaining([
                ['Strategy', 'Over/Under'],
                ['Trade', 'Under'],
                ['Digit', '4'],
            ])
        );
    });
});
