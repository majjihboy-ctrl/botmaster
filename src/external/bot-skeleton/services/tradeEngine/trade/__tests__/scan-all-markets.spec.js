import TicksMixin from '../Ticks';

let mockSymbols = [];

jest.mock('lodash.debounce', () => fn => fn);
jest.mock('@/constants/backend-error-messages', () => ({ getLocalizedErrorMessage: jest.fn() }));
jest.mock('../../../../utils/binary-utils', () => ({ getLast: list => list[list.length - 1] }));
jest.mock('../../../../utils/observer', () => ({ observer: { emit: jest.fn() } }));
jest.mock('../../../api/api-base', () => ({ api_base: {} }));
jest.mock('../../../api/api-helpers', () => ({
    __esModule: true,
    default: { instance: { active_symbols: { getSymbolsForBot: () => mockSymbols } } },
}));
jest.mock('../../utils/broadcast', () => ({ notify: jest.fn() }));
jest.mock('../../utils/helpers', () => ({
    getDirection: jest.fn(),
    getLastDigit: jest.fn(value => Number(String(value).slice(-1))),
}));
jest.mock('../../utils/sanitize', () => ({ expectPositiveInteger: jest.fn(n => n) }));

// eslint-disable-next-line import/first
import { notify } from '../../utils/broadcast';

const continuous = ['R_10', 'R_25', 'R_50'].map(value => ({ value, submarket: 'random_index' }));

const createEngine = ({ scope = 'BEFORE_PURCHASE', symbol = 'R_10' } = {}) => {
    const callbacks = {};
    const ticksService = {
        stopMonitor: jest.fn(async () => undefined),
        releaseSymbol: jest.fn(async () => undefined),
        monitor: jest.fn(async ({ symbol: s, callback }) => {
            callbacks[s] = callback;
            return `key-${s}`;
        }),
        request: jest.fn(),
    };
    const Engine = TicksMixin(class {});
    const engine = new Engine();
    engine.$scope = { ticksService };
    engine.options = { symbol };
    engine.store = { dispatch: jest.fn(), getState: jest.fn(() => ({ scope })) };
    engine.sessionRuns = 0;
    engine.market_switch = {
        forced_symbol: null,
        alternate: { enabled: false, every: 1 },
        current_symbol: null,
        last_rotation_runs: -1,
        warned_not_continuous: false,
        scan: { enabled: false, evaluated: false, eval_symbol: null, warned: false },
    };
    engine.tradeOptions = { symbol, duration: 1, duration_unit: 't', amount: 1 };
    return { engine, callbacks, ticksService };
};

const tick = epoch => [{ epoch, quote: 100.12 }];

beforeEach(() => {
    mockSymbols = [...continuous];
    notify.mockClear();
});

describe('Scan all markets', () => {
    it('gives a market one tick to the bot, then moves on without handling the next tick', async () => {
        const { engine, callbacks, ticksService } = createEngine();
        await engine.watchTicks('R_10');
        engine.setScanAllMarkets(true);

        callbacks.R_10(tick(1));
        expect(engine.store.dispatch).toHaveBeenCalledTimes(1);

        callbacks.R_10(tick(2)); // hop instead of handling this tick
        await engine.symbol_task;
        expect(engine.store.dispatch).toHaveBeenCalledTimes(1);
        expect(engine.symbol).toBe('R_25');
        expect(engine.tradeOptions.symbol).toBe('R_25');
        expect(engine.market_switch.current_symbol).toBe('R_25');
        expect(ticksService.monitor).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'R_25' }));
    });

    it('visits every Continuous Index in turn and wraps around', async () => {
        const { engine, callbacks } = createEngine();
        await engine.watchTicks('R_10');
        engine.setScanAllMarkets(true);

        const visited = [engine.symbol];
        for (let i = 0; i < 4; i++) {
            callbacks[engine.symbol](tick(10 * i + 1));
            callbacks[engine.symbol](tick(10 * i + 2));
            await engine.symbol_task;
            visited.push(engine.symbol);
        }
        expect(visited).toEqual(['R_10', 'R_25', 'R_50', 'R_10', 'R_25']);
    });

    it('does not scan when it is off, during a trade, or when a symbol is forced', async () => {
        const off = createEngine();
        await off.engine.watchTicks('R_10');
        off.callbacks.R_10(tick(1));
        off.callbacks.R_10(tick(2));
        expect(off.engine.symbol).toBe('R_10');
        expect(off.engine.store.dispatch).toHaveBeenCalledTimes(2);

        const during = createEngine({ scope: 'DURING_PURCHASE' });
        await during.engine.watchTicks('R_10');
        during.engine.setScanAllMarkets(true);
        during.callbacks.R_10(tick(1));
        during.callbacks.R_10(tick(2));
        expect(during.engine.symbol).toBe('R_10');

        const forced = createEngine();
        await forced.engine.watchTicks('R_10');
        forced.engine.setScanAllMarkets(true);
        forced.engine.market_switch.forced_symbol = 'R_10';
        forced.callbacks.R_10(tick(1));
        forced.callbacks.R_10(tick(2));
        expect(forced.engine.symbol).toBe('R_10');
    });

    it('does not scan when payout/ask-price blocks keep proposals open on one market', async () => {
        const { engine, callbacks } = createEngine();
        engine.is_proposal_subscription_required = true;
        engine.checkProposalReady = jest.fn();
        await engine.watchTicks('R_10');
        engine.setScanAllMarkets(true);
        callbacks.R_10(tick(1));
        callbacks.R_10(tick(2));
        expect(engine.symbol).toBe('R_10');
    });

    it('turns itself off with one warning on a market that is not a Continuous Index', async () => {
        mockSymbols = [{ value: 'frxEURUSD', submarket: 'major_pairs' }, ...continuous];
        const { engine, callbacks } = createEngine({ symbol: 'frxEURUSD' });
        await engine.watchTicks('frxEURUSD');
        engine.setScanAllMarkets(true);
        callbacks.frxEURUSD(tick(1));
        callbacks.frxEURUSD(tick(2));
        callbacks.frxEURUSD(tick(3));
        expect(engine.symbol).toBe('frxEURUSD');
        expect(notify.mock.calls.filter(([type]) => type === 'warn')).toHaveLength(1);
        expect(engine.market_switch.scan.enabled).toBe(false);
    });

    it('refuses a purchase whose rules ran on a market the bot has already left', async () => {
        const { engine, callbacks } = createEngine();
        await engine.watchTicks('R_10');
        engine.setScanAllMarkets(true);
        callbacks.R_10(tick(1)); // the rules read R_10
        expect(engine.isScanPurchaseStale()).toBe(false);

        callbacks.R_10(tick(2)); // hop to R_25 while the rules were still running
        await engine.symbol_task;
        expect(engine.isScanPurchaseStale()).toBe(true); // R_25 has not been read yet

        callbacks.R_25(tick(3)); // now the rules have seen R_25
        expect(engine.isScanPurchaseStale()).toBe(false);
    });

    it('never blocks purchases when scanning is off', async () => {
        const { engine } = createEngine();
        await engine.watchTicks('R_10');
        expect(engine.isScanPurchaseStale()).toBe(false);
    });

    it('stays on the market where it bought for the next trade cycle', async () => {
        const { engine, callbacks } = createEngine();
        await engine.watchTicks('R_10');
        engine.setScanAllMarkets(true);
        callbacks.R_10(tick(1));
        callbacks.R_10(tick(2));
        await engine.symbol_task;
        callbacks.R_25(tick(3)); // the rules buy here
        engine.sessionRuns = 1;
        engine.applyMarketSwitch();
        expect(engine.getActiveSymbol()).toBe('R_25');
        expect(engine.symbol).toBe('R_25');
    });
});
