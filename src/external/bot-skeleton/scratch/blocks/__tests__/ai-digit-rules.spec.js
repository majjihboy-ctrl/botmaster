/**
 * AI Bot Builder "digit rules" strategy: the generated bot must load into the real Blockly workspace using
 * only registered blocks, and when its generated program is run against a scripted tick stream it must wait
 * for the entry pattern, arm the recovery rule after a loss, and respect the stop rules.
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
    normalizeDigitRules,
    buildDigitRulesXml,
    describeDigitRules,
} = require('../../../../../../api/_lib/digit-rules');

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
    ['initSvg', 'renderEfficiently', 'queueRender', 'render', 'bumpNeighbours', 'scheduleSnapAndBump'].forEach(name => {
        if (typeof Blockly.Block.prototype[name] !== 'function') Blockly.Block.prototype[name] = function () {};
    });
    DBot = (await import('../../dbot')).default;
}, 120000);

// The prompt that started this: "over 2 if digits 1,2,0 have not appeared in 10 ticks; if loss, over 4 if the
// last digit is 0 or 9; show journals".
const USER_PROMPT_PARAMS = {
    symbol: 'R_100',
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
    recovery: {
        contract: 'DIGITOVER',
        prediction: 4,
        when: [{ type: 'last_digit_in', digits: [0, 9] }],
    },
};

function loadBot(params) {
    const workspace = new Blockly.Workspace();
    const varDB = new Blockly.Names('window');
    varDB.variableMap = workspace.getVariableMap();
    Blockly.JavaScript.variableDB_ = varDB;
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(buildDigitRulesXml(params).xml), workspace);
    return workspace;
}

// Runs the app's real generated program against a stub `Bot` that feeds a scripted digit stream (one digit per
// before-purchase loop = one tick) and plays back scripted profits for each purchase.
function simulate(workspace, digits, profits) {
    const code = DBot.generateCode.call({ workspace });
    const history = [];
    const events = [];
    let total = 0;
    let run = -1;
    let purchased = false;
    let pending = 0;
    let options = {};

    const Bot = {
        init: () => {},
        highlightBlock: () => {},
        getLastTick: () => ({ epoch: history.length }),
        getLastDigit: () => history[history.length - 1],
        getLastDigitsCondition: ({ n, op, digit }) => {
            const last = history.slice(-n);
            if (last.length < n) return false;
            const test = {
                '<': x => x < digit,
                '<=': x => x <= digit,
                '>': x => x > digit,
                '>=': x => x >= digit,
                '===': x => x === digit,
                '!==': x => x !== digit,
            }[op];
            return last.every(test);
        },
        start: o => {
            purchased = false;
            options = o;
            events.push({ type: 'start', amount: o.amount, prediction: o.prediction });
        },
        purchase: contract => {
            run += 1;
            if (run >= profits.length) throw new Error('RAN_OUT_OF_SCRIPT');
            purchased = true;
            pending = profits[run];
            events.push({
                type: 'purchase',
                contract,
                tick: history.length,
                lastDigit: history[history.length - 1],
                prediction: options.prediction,
                amount: options.amount,
            });
        },
        shouldRunAfterPurchase: () => {
            total += pending;
            return true;
        },
        hasQueuedResult: () => false,
        isResult: result => (pending > 0 ? 'win' : 'loss') === result,
        getTotalProfit: () => total,
        notify: o => events.push({ type: 'notify', message: o.message }),
        isTradeAgain: () => {},
    };

    const watch = stage => {
        if (stage !== 'before' || purchased) return false;
        if (history.length >= digits.length) throw new Error('RAN_OUT_OF_TICKS');
        history.push(digits[history.length]);
        return true;
    };

    let ended = null;
    try {
        vm.runInNewContext(code, { Bot, watch, sleep: () => {} }, { timeout: 5000 });
    } catch (error) {
        if (!['RAN_OUT_OF_SCRIPT', 'RAN_OUT_OF_TICKS'].includes(error.message)) throw error;
        ended = error.message;
    }
    return {
        code,
        events,
        ended,
        purchases: events.filter(e => e.type === 'purchase'),
        starts: events.filter(e => e.type === 'start'),
        notes: events.filter(e => e.type === 'notify').map(e => e.message),
    };
}

describe('digit rules load into real Blockly', () => {
    it('the original prompt loads with only registered blocks and no warnings', () => {
        warnings.length = 0;
        const workspace = loadBot(USER_PROMPT_PARAMS);
        expect(
            workspace
                .getTopBlocks()
                .map(b => b.type)
                .sort()
        ).toEqual(['after_purchase', 'before_purchase', 'trade_definition']);
        const types = new Set(workspace.getAllBlocks(false).map(b => b.type));
        types.forEach(type => expect(Blockly.Blocks[type]).toBeDefined());
        expect(types.has('last_digits_condition')).toBe(true);
        expect(types.has('last_digit')).toBe(true);
        expect(types.has('notify')).toBe(true);
        expect(warnings).toEqual([]);
        // every block really connected (nothing floating at top level, no orphaned statement)
        expect(workspace.getAllBlocks(false).every(b => !b.isShadow() || b.getParent())).toBe(true);
    });

    it('generates engine code with the absence checks and both contracts', () => {
        const code = Blockly.JavaScript.javascriptGenerator.workspaceToCode(loadBot(USER_PROMPT_PARAMS));
        [1, 2, 0].forEach(d => expect(code).toContain(`Bot.getLastDigitsCondition({ n: 10, op: '!==', digit: ${d} })`));
        expect(code).toContain('Bot.getLastDigit()');
        expect(code).toContain('contractTypes       : ["DIGITOVER"]');
        expect(code).toContain("Bot.purchase('DIGITOVER')");
    });

    it.each([
        ['over/under', 'DIGITOVER', 'DIGITUNDER', 'overunder'],
        ['matches/differs', 'DIGITDIFF', 'DIGITMATCH', 'matchesdiffers'],
        ['even/odd', 'DIGITEVEN', 'DIGITODD', 'evenodd'],
    ])('%s entry with a different-contract recovery loads', (name, entry, recovery, tradeType) => {
        warnings.length = 0;
        const params = {
            ...USER_PROMPT_PARAMS,
            entry: { contract: entry, prediction: 5, when: [] },
            recovery: {
                contract: recovery,
                prediction: 5,
                when: [{ type: 'last_digits', ticks: 3, op: 'LESS', digit: 4 }],
            },
        };
        const workspace = loadBot(params);
        const code = Blockly.JavaScript.javascriptGenerator.workspaceToCode(workspace);
        expect(code).toContain(`Bot.purchase('${entry}')`);
        expect(code).toContain(`Bot.purchase('${recovery}')`);
        expect(workspace.getBlocksByType('trade_definition_tradetype')[0].getFieldValue('TRADETYPE_LIST')).toBe(
            tradeType
        );
        expect(workspace.getBlocksByType('trade_definition_contracttype')[0].getFieldValue('TYPE_LIST')).toBe('both');
        expect(warnings).toEqual([]);
    });
});

describe('digit rules behave correctly when run', () => {
    // Digits chosen so that a 1, 2 or 0 shows up at ticks 3 and 6; the first 10-tick window with none of
    // 1/2/0 ends at tick 16 (index 15).
    const STREAM = [5, 7, 8, 1, 9, 3, 2, 4, 5, 6, 7, 8, 9, 3, 4, 5, 6, 7, 8, 9, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

    it('waits for the entry pattern before the first trade', () => {
        const result = simulate(loadBot({ ...USER_PROMPT_PARAMS, recovery: null }), STREAM, [1]);
        const first = result.purchases[0];
        // ticks 1..7 contain 1 (idx3) and 2 (idx6): the first window with none of 1/2/0 ends at tick 17
        const window = STREAM.slice(first.tick - 10, first.tick);
        expect(window.some(d => [1, 2, 0].includes(d))).toBe(false);
        expect(first.tick).toBe(17);
        // and it did not buy any earlier tick that would also have qualified
        for (let t = 10; t < first.tick; t++) {
            expect(STREAM.slice(t - 10, t).some(d => [1, 2, 0].includes(d))).toBe(true);
        }
        expect(first.contract).toBe('DIGITOVER');
        expect(first.prediction).toBe(2);
    });

    it('after a loss it switches to the recovery digit and waits for last digit 0 or 9', () => {
        // entry window clear at tick 17 (digit idx16 = 6); loss; recovery waits for last digit 0/9
        const stream = [...STREAM.slice(0, 17), 6, 7, 8, 9, 5, 5, 5, 5, 5, 5, 5];
        const result = simulate(loadBot(USER_PROMPT_PARAMS), stream, [-1, 1]);
        const [entry, recovery] = result.purchases;
        expect(entry.prediction).toBe(2);
        expect(recovery.prediction).toBe(4);
        expect([0, 9]).toContain(recovery.lastDigit);
        // tick 17 is the entry; the next 0/9 after it is the 9 at index 20 -> tick 21
        expect(recovery.tick).toBe(21);
        // martingale: recovery trade stake is doubled
        expect(recovery.amount).toBe(2);
        expect(result.notes).toEqual(
            expect.arrayContaining([
                'Loss - stake increased.',
                expect.stringContaining('Recovery armed: Over 4 when last digit is one of 0, 9'),
            ])
        );
    });

    it('returns to the entry rule after a recovery trade, win or lose', () => {
        const stream = [...STREAM.slice(0, 17), 9, ...Array(40).fill(5)];
        // entry loses, recovery loses too: back to digit 2 afterwards
        const result = simulate(loadBot(USER_PROMPT_PARAMS), stream, [-1, -1, 1]);
        expect(result.purchases[0].prediction).toBe(2);
        expect(result.purchases[1].prediction).toBe(4);
        // the third trade starts with digit 2 again and quadrupled stake
        expect(result.starts[2].prediction).toBe(2);
        expect(result.starts[2].amount).toBe(4);
        // ...and it really trades again on the entry rule (the 5s satisfy it, but not the recovery rule)
        expect(result.purchases).toHaveLength(3);
        expect(result.purchases[2].prediction).toBe(2);
        expect(result.notes).toContain('Back to the entry rule.');
    });

    it('a win resets the stake and keeps the entry rule', () => {
        const stream = [...STREAM.slice(0, 17), ...Array(40).fill(5)];
        const result = simulate(loadBot(USER_PROMPT_PARAMS), stream, [1, 1]);
        expect(result.starts.map(s => s.amount)).toEqual([1, 1, 1]);
        expect(result.starts.map(s => s.prediction)).toEqual([2, 2, 2]);
    });

    it('stops at take profit and at stop loss', () => {
        const calm = [...STREAM.slice(0, 17), ...Array(80).fill(5)];
        const tp = simulate(loadBot({ ...USER_PROMPT_PARAMS, take_profit: 5, recovery: null }), calm, [3, 3, 3, 3]);
        expect(tp.purchases).toHaveLength(2);
        expect(tp.notes).toContain('Take profit reached - bot stopped.');
        const sl = simulate(
            loadBot({ ...USER_PROMPT_PARAMS, stop_loss: 3, martingale_multiplier: 1, recovery: null }),
            calm,
            [-1, -1, -1, -1, -1]
        );
        expect(sl.purchases).toHaveLength(3);
        expect(sl.notes).toContain('Stop loss reached - bot stopped.');
    });

    it('journal off means no journal messages other than the stop notices', () => {
        const calm = [...STREAM.slice(0, 17), ...Array(80).fill(5)];
        const result = simulate(
            loadBot({ ...USER_PROMPT_PARAMS, journal: false, stop_loss: 1, recovery: null }),
            calm,
            [-1]
        );
        expect(result.notes).toEqual(['Stop loss reached - bot stopped.']);
    });

    it('a rule with no conditions buys on the first tick', () => {
        const result = simulate(
            loadBot({ ...USER_PROMPT_PARAMS, recovery: null, entry: { contract: 'DIGITEVEN', when: [] } }),
            [4, 4, 4, 4],
            [1]
        );
        expect(result.purchases[0].tick).toBe(1);
        expect(result.purchases[0].contract).toBe('DIGITEVEN');
    });
});

describe('digit rules input is validated', () => {
    it('drops a recovery rule from another trade type and says so', () => {
        const p = normalizeDigitRules({
            entry: { contract: 'DIGITOVER', prediction: 2 },
            recovery: { contract: 'DIGITDIFF', prediction: 3 },
        });
        expect(p.recovery).toBeNull();
        expect(p.unsupported.join(' ')).toMatch(/recovery rule was left out/);
    });

    it('clamps digits, lookback, stake and falls back to safe defaults', () => {
        const p = normalizeDigitRules({
            symbol: 'EVIL<script>',
            initial_stake: -4,
            martingale_multiplier: 99,
            entry: {
                contract: 'NOT_A_CONTRACT',
                prediction: 42,
                when: [
                    { type: 'digits_absent', digits: [1, 1, 12, 'x', 3], ticks: 5000 },
                    { type: 'rm -rf', digits: [1] },
                    { type: 'last_digits', ticks: 3, op: 'DROP TABLE', digit: 1 },
                    { type: 'last_digit_in', digits: [] },
                ],
            },
        });
        expect(p.symbol).toBe('1HZ100V');
        expect(p.initial_stake).toBe(1);
        expect(p.martingale_multiplier).toBe(10);
        expect(p.entry.contract).toBe('DIGITOVER');
        expect(p.entry.prediction).toBe(8);
        expect(p.entry.when).toEqual([{ type: 'digits_absent', digits: [1, 3], ticks: 100 }]);
        expect(p.unsupported.length).toBe(3);
    });

    it('keeps the model\'s "unsupported" notes and escapes nothing into the XML', () => {
        const built = buildDigitRulesXml({
            ...USER_PROMPT_PARAMS,
            unsupported: ['Under 7 when 7, 8, 9 absent <b>cannot share a bot</b>'],
        });
        expect(built.params.unsupported[0]).toContain('Under 7');
        expect(built.xml).not.toContain('cannot share a bot');
    });

    it('describes the bot for the UI, including what 5 losses cost', () => {
        const rows = Object.fromEntries(describeDigitRules(normalizeDigitRules(USER_PROMPT_PARAMS)));
        expect(rows.Entry).toBe('Over 2 when none of 1, 2, 0 in the last 10 ticks');
        expect(rows['After a loss']).toBe('Over 4 when last digit is one of 0, 9');
        expect(rows['5 losses in a row cost']).toBe('$31');
        expect(rows.Journal).toMatch(/on/);
    });
});
