import { applyMiddleware, createStore } from 'redux';
import { thunk } from 'redux-thunk';
import VirtualHookMixin from '../VirtualHook';
import { start } from '../state/actions';
import rootReducer from '../state/reducers';

const mockNotify = jest.fn();
jest.mock('../../utils/broadcast', () => ({ notify: (...args) => mockNotify(...args) }));
jest.mock('../../utils/helpers', () => ({ getLastDigit: tick => Number(String(tick).slice(-1)) }));
jest.mock('@deriv-com/translations', () => ({
    localize: (text, values = {}) =>
        text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (values[key] !== undefined ? values[key] : m)),
}));

// A minimal engine: the real mixin on top of the few members it relies on.
const createEngine = (tradeOptions = {}) => {
    const Engine = VirtualHookMixin(class {});
    const engine = new Engine();
    let listener;
    const ticksService = {
        monitor: jest.fn(async ({ callback }) => {
            listener = callback;
            return 'tick-key';
        }),
        stopMonitor: jest.fn(),
    };
    engine.$scope = { ticksService };
    // The engine's real store, already in BEFORE_PURCHASE like a bot that is about to buy.
    engine.store = createStore(rootReducer, applyMiddleware(thunk));
    engine.store.dispatch(start());
    engine.symbol = 'R_100';
    engine.data = {
        contract: {},
        proposals: [{ contract_type: 'DIGITUNDER', purchase_reference: 'ref', payout: 1.95 }],
    };
    engine.getPurchaseReference = () => 'ref';
    engine.getPipSize = () => 2;
    engine.getLastTick = jest.fn().mockResolvedValue({ epoch: 100, quote: 100.11 });
    engine.setContractFlags = jest.fn(contract => {
        engine.isSold = Boolean(contract.is_sold);
    });
    engine.updateTotals = jest.fn();
    engine.afterPromise = jest.fn();
    engine.tradeOptions = {
        amount: 1,
        currency: 'USD',
        duration: 1,
        duration_unit: 't',
        prediction: 5,
        ...tradeOptions,
    };
    const tick = (epoch, quote) => ({ epoch, quote });
    const emit = ticks => listener(ticks);
    return { engine, ticksService, tick, emit };
};

const scope = engine => engine.store.getState().scope;

describe('Virtual Hook: virtual trades', () => {
    beforeEach(() => mockNotify.mockClear());

    it('is off by default, so purchases are real', () => {
        const { engine } = createEngine();
        expect(engine.shouldTradeVirtually()).toBe(false);
        engine.configureVirtualHook({ virtualLosses: 2, realWins: 3 });
        expect(engine.shouldTradeVirtually()).toBe(false);
    });

    it('starts in virtual mode once enabled', () => {
        const { engine } = createEngine();
        engine.enableVirtualHook(true);
        expect(engine.shouldTradeVirtually()).toBe(true);
    });

    it('settles a digit contract from the live ticks, without touching real totals', async () => {
        const { engine, ticksService, tick, emit } = createEngine();
        engine.enableVirtualHook(true);
        await engine.virtualPurchase('DIGITUNDER');

        expect(engine.contractId).toBe('virtual-1');
        expect(engine.isSold).toBe(false);
        expect(scope(engine)).toBe('DURING_PURCHASE');

        emit([tick(99, 100.01), tick(100, 100.11)]); // nothing newer than the purchase tick yet
        expect(engine.data.contract.is_virtual_hook).toBeUndefined();

        emit([tick(100, 100.11), tick(101, 100.23)]); // exit digit 3 < 5 -> UNDER 5 wins
        const contract = engine.data.contract;
        expect(contract).toMatchObject({
            contract_id: 'virtual-1',
            status: 'won',
            is_sold: 1,
            is_virtual_hook: true,
            buy_price: 1,
            sell_price: 1.95,
            profit: 0.95,
            exit_tick: '100.23',
            barrier: '5',
            transaction_ids: { buy: 'virtual-1', sell: 'virtual-1' },
        });
        expect(engine.contractId).toBe('');
        expect(engine.updateTotals).not.toHaveBeenCalled();
        expect(engine.afterPromise).toHaveBeenCalledTimes(1);
        expect(scope(engine)).toBe('STOP'); // releases the bot's wait for the contract to finish
        expect(ticksService.stopMonitor).toHaveBeenCalledWith({ symbol: 'R_100', key: 'tick-key' });
    });

    it('records a loss and gives it a negative result for the bot logic', async () => {
        const { engine, tick, emit } = createEngine();
        engine.enableVirtualHook(true);
        await engine.virtualPurchase('DIGITUNDER');
        emit([tick(101, 100.27)]); // digit 7 is not under 5
        expect(engine.data.contract).toMatchObject({ status: 'lost', sell_price: 0, profit: -1 });
    });

    it('waits for the full tick duration: entry = first tick after purchase, exit = last', async () => {
        const { engine, tick, emit } = createEngine({ duration: 3 });
        engine.enableVirtualHook(true);
        await engine.virtualPurchase('DIGITUNDER');
        emit([tick(101, 100.21), tick(102, 100.22)]);
        expect(engine.data.contract.is_virtual_hook).toBeUndefined();
        emit([tick(101, 100.21), tick(102, 100.22), tick(103, 100.24)]);
        expect(engine.data.contract).toMatchObject({ entry_tick: '100.21', exit_tick: '100.24', status: 'won' });
    });

    it.each([
        ['DIGITOVER', 5, 7, true],
        ['DIGITOVER', 5, 5, false],
        ['DIGITMATCH', 5, 5, true],
        ['DIGITDIFF', 5, 5, false],
        ['DIGITEVEN', 0, 4, true],
        ['DIGITODD', 0, 4, false],
    ])('%s with barrier %s and exit digit %s -> win = %s', async (contract_type, prediction, digit, expected) => {
        const { engine, tick, emit } = createEngine({ prediction });
        engine.enableVirtualHook(true);
        await engine.virtualPurchase(contract_type);
        emit([tick(101, Number(`100.2${digit}`))]);
        expect(engine.data.contract.status).toBe(expected ? 'won' : 'lost');
    });

    it('settles rise/fall by comparing exit with entry', async () => {
        const { engine, tick, emit } = createEngine({ duration: 2, prediction: undefined });
        engine.enableVirtualHook(true);
        await engine.virtualPurchase('PUT');
        emit([tick(101, 100.5), tick(102, 100.4)]);
        expect(engine.data.contract.status).toBe('won');
    });

    it('stops with a clear error instead of trading real money for unsupported setups', async () => {
        const unsupported = createEngine();
        unsupported.engine.enableVirtualHook(true);
        await expect(unsupported.engine.virtualPurchase('MULTUP')).rejects.toMatchObject({ name: 'VirtualHookError' });

        const seconds = createEngine({ duration_unit: 's', duration: 30 });
        seconds.engine.enableVirtualHook(true);
        await expect(seconds.engine.virtualPurchase('DIGITUNDER')).rejects.toThrow(/duration in ticks/);

        const noBarrier = createEngine({ prediction: undefined });
        noBarrier.engine.enableVirtualHook(true);
        await expect(noBarrier.engine.virtualPurchase('DIGITUNDER')).rejects.toThrow(/prediction/);
    });
});

describe('Virtual Hook: switching between virtual and real', () => {
    const virtualResult = (engine, won) =>
        engine.recordVirtualHookResult({ is_virtual_hook: true, status: won ? 'won' : 'lost', profit: won ? 1 : -1 });
    const realResult = (engine, won) =>
        engine.recordVirtualHookResult({ status: won ? 'won' : 'lost', profit: won ? 1 : -1 });

    it('goes real after the configured number of virtual losses IN A ROW', () => {
        const { engine } = createEngine();
        engine.configureVirtualHook({ virtualLosses: 2, realWins: 1 });
        engine.enableVirtualHook(true);

        virtualResult(engine, false);
        expect(engine.shouldTradeVirtually()).toBe(true);
        virtualResult(engine, true); // a virtual win breaks the streak
        virtualResult(engine, false);
        expect(engine.shouldTradeVirtually()).toBe(true);
        virtualResult(engine, false);
        expect(engine.shouldTradeVirtually()).toBe(false); // now REAL
    });

    it('goes back to virtual after the configured number of real wins; real losses do not count', () => {
        const { engine } = createEngine();
        engine.configureVirtualHook({ virtualLosses: 1, realWins: 2 });
        engine.enableVirtualHook(true);
        virtualResult(engine, false); // -> real
        expect(engine.shouldTradeVirtually()).toBe(false);

        realResult(engine, false);
        realResult(engine, true);
        expect(engine.shouldTradeVirtually()).toBe(false);
        realResult(engine, true);
        expect(engine.shouldTradeVirtually()).toBe(true); // back to virtual, with a fresh streak
        virtualResult(engine, true);
        expect(engine.shouldTradeVirtually()).toBe(true);
    });

    it('ignores results while disabled, and a real result that lands during virtual mode', () => {
        const { engine } = createEngine();
        virtualResult(engine, false);
        engine.enableVirtualHook(true);
        realResult(engine, true); // e.g. a trade bought before the hook was switched on
        expect(engine.vh.realWins).toBe(0);
        expect(engine.shouldTradeVirtually()).toBe(true);
    });

    it('can be configured and enabled every tick without losing progress', () => {
        const { engine } = createEngine();
        engine.configureVirtualHook({ virtualLosses: 3, realWins: 1 });
        engine.enableVirtualHook(true);
        virtualResult(engine, false);
        virtualResult(engine, false);
        engine.configureVirtualHook({ virtualLosses: 3, realWins: 1 });
        engine.enableVirtualHook(true);
        virtualResult(engine, false);
        expect(engine.shouldTradeVirtually()).toBe(false);
    });

    it('disabling drops an unfinished virtual trade and returns to real trades', async () => {
        const { engine, ticksService } = createEngine();
        engine.enableVirtualHook(true);
        await engine.virtualPurchase('DIGITUNDER');
        engine.enableVirtualHook(false);
        expect(engine.shouldTradeVirtually()).toBe(false);
        expect(engine.contractId).toBe('');
        expect(ticksService.stopMonitor).toHaveBeenCalled();
    });

    it('clamps nonsense settings to at least 1', () => {
        const { engine } = createEngine();
        engine.configureVirtualHook({ virtualLosses: 0, realWins: -4 });
        expect(engine.vh.virtualLosses).toBe(1);
        expect(engine.vh.realWinsNeeded).toBe(2);
        engine.configureVirtualHook({ virtualLosses: 'abc', realWins: 3.9 });
        expect(engine.vh.virtualLosses).toBe(1);
        expect(engine.vh.realWinsNeeded).toBe(3);
    });
});
