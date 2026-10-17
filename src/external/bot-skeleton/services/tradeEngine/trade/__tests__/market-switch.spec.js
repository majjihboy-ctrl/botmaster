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

const continuous = ['R_10', 'R_25', 'R_50'].map(value => ({
    value,
    submarket: 'random_index',
    group: 'Continuous Indices',
}));
const forex = { value: 'frxEURUSD', submarket: 'major_pairs', group: 'Major Pairs' };

const createEngine = ({ symbol = 'R_10' } = {}) => {
    const calls = [];
    const ticksService = {
        stopMonitor: jest.fn(async ({ symbol: s }) => calls.push(`stop:${s}`)),
        releaseSymbol: jest.fn(async s => calls.push(`release:${s}`)),
        monitor: jest.fn(async ({ symbol: s, callback }) => {
            calls.push(`monitor:${s}`);
            ticksService.last_callback = callback;
            return `key-${s}`;
        }),
        request: jest.fn(),
    };
    const Engine = TicksMixin(class {});
    const engine = new Engine();
    engine.$scope = { ticksService };
    engine.options = { symbol };
    engine.store = { dispatch: jest.fn() };
    engine.sessionRuns = 0;
    engine.market_switch = {
        forced_symbol: null,
        alternate: { enabled: false, every: 1 },
        current_symbol: null,
        last_rotation_runs: -1,
        warned_not_continuous: false,
    };
    return { engine, ticksService, calls };
};

describe('market switching', () => {
    beforeEach(() => {
        mockSymbols = [...continuous, forex];
    });

    describe('watchTicks', () => {
        it('moves the tick stream: stops and releases the old symbol, then monitors the new one', async () => {
            const { engine, calls } = createEngine();
            await engine.watchTicks('R_10');
            await engine.watchTicks('R_25');

            expect(calls).toEqual(['monitor:R_10', 'stop:R_10', 'release:R_10', 'monitor:R_25']);
            expect(engine.symbol).toBe('R_25');
        });

        it('points analysis at the new symbol immediately, before the stream work finishes', () => {
            const { engine } = createEngine();
            engine.watchTicks('R_10');
            engine.watchTicks('R_25');
            expect(engine.symbol).toBe('R_25');
        });

        it('runs rapid switches one after another so they never overlap', async () => {
            const { engine, calls } = createEngine();
            engine.watchTicks('R_10');
            engine.watchTicks('R_25');
            await engine.watchTicks('R_50');

            expect(calls).toEqual([
                'monitor:R_10',
                'stop:R_10',
                'release:R_10',
                'monitor:R_25',
                'stop:R_25',
                'release:R_25',
                'monitor:R_50',
            ]);
        });

        it('does nothing when asked for the symbol it is already on', async () => {
            const { engine, ticksService } = createEngine();
            await engine.watchTicks('R_10');
            await engine.watchTicks('R_10');
            expect(ticksService.monitor).toHaveBeenCalledTimes(1);
            expect(ticksService.releaseSymbol).not.toHaveBeenCalled();
        });

        it('ignores a tick that was already in flight for a market the bot has left', async () => {
            const { engine, ticksService } = createEngine();
            await engine.watchTicks('R_10');
            const old_callback = ticksService.last_callback;
            await engine.watchTicks('R_25');

            old_callback([{ epoch: 111 }]);
            expect(engine.store.dispatch).not.toHaveBeenCalled();

            ticksService.last_callback([{ epoch: 222 }]);
            expect(engine.store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: 222 }));
        });

        it('keeps working after a failed switch', async () => {
            const { engine, ticksService } = createEngine();
            ticksService.monitor.mockRejectedValueOnce(new Error('InvalidSymbol'));
            await expect(engine.watchTicks('BAD')).rejects.toThrow('InvalidSymbol');
            await expect(engine.watchTicks('R_25')).resolves.toBeUndefined();
            expect(engine.symbol).toBe('R_25');
        });
    });

    describe('Alternate markets', () => {
        it('rotates only every N completed runs, never before the first run', async () => {
            const { engine } = createEngine();
            await engine.watchTicks('R_10');
            engine.setAlternateMarkets(true, 2);

            const symbols_per_run = [];
            for (let runs = 0; runs <= 5; runs++) {
                engine.sessionRuns = runs;
                engine.applyMarketSwitch();
                symbols_per_run.push(engine.getActiveSymbol());
            }
            // run counts 0,1 -> R_10 | 2,3 -> R_25 | 4,5 -> R_50
            expect(symbols_per_run).toEqual(['R_10', 'R_10', 'R_25', 'R_25', 'R_50', 'R_50']);
        });

        it('wraps around to the first market after the last one', async () => {
            const { engine } = createEngine({ symbol: 'R_50' });
            await engine.watchTicks('R_50');
            engine.setAlternateMarkets(true, 1);
            engine.sessionRuns = 1;
            engine.applyMarketSwitch();
            expect(engine.getActiveSymbol()).toBe('R_10');
        });

        it('rotates once per run count even if called several times in a cycle', async () => {
            const { engine } = createEngine();
            await engine.watchTicks('R_10');
            engine.setAlternateMarkets(true, 1);
            engine.sessionRuns = 1;
            engine.applyMarketSwitch();
            engine.applyMarketSwitch();
            engine.applyMarketSwitch();
            expect(engine.getActiveSymbol()).toBe('R_25');
        });

        it('moves the tick stream to the market it rotates to', async () => {
            const { engine, ticksService } = createEngine();
            await engine.watchTicks('R_10');
            engine.setAlternateMarkets(true, 1);
            engine.sessionRuns = 1;
            engine.applyMarketSwitch();
            await engine.symbol_task;

            expect(engine.symbol).toBe('R_25');
            expect(ticksService.releaseSymbol).toHaveBeenCalledWith('R_10');
            expect(ticksService.monitor).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'R_25' }));
        });

        it('does not rotate when disabled', async () => {
            const { engine } = createEngine();
            await engine.watchTicks('R_10');
            engine.setAlternateMarkets(false, 1);
            engine.sessionRuns = 3;
            engine.applyMarketSwitch();
            expect(engine.getActiveSymbol()).toBe('R_10');
        });

        it('stays put and warns once when the current market is not a Continuous Index', async () => {
            const { engine } = createEngine({ symbol: 'frxEURUSD' });
            await engine.watchTicks('frxEURUSD');
            engine.setAlternateMarkets(true, 1);

            engine.sessionRuns = 1;
            engine.applyMarketSwitch();
            engine.sessionRuns = 2;
            engine.applyMarketSwitch();

            expect(engine.getActiveSymbol()).toBe('frxEURUSD');
            expect(notify).toHaveBeenCalledTimes(1);
            expect(notify).toHaveBeenCalledWith('warn', expect.any(String));
        });

        it('clamps a bad "every" value to 1', () => {
            const { engine } = createEngine();
            engine.setAlternateMarkets(true, 0);
            expect(engine.market_switch.alternate).toEqual({ enabled: true, every: 1 });
            engine.setAlternateMarkets(true, 'abc');
            expect(engine.market_switch.alternate.every).toBe(1);
        });
    });

    describe('Set active symbol', () => {
        it('forces the symbol and wins over Alternate markets', async () => {
            const { engine } = createEngine();
            await engine.watchTicks('R_10');
            engine.setAlternateMarkets(true, 1);
            engine.setForcedSymbol('R_50');
            engine.sessionRuns = 1;
            engine.applyMarketSwitch();
            expect(engine.getActiveSymbol()).toBe('R_50');
        });

        it('"disable" clears the forced symbol', async () => {
            const { engine } = createEngine();
            engine.setForcedSymbol('R_50');
            engine.setForcedSymbol('disable');
            expect(engine.market_switch.forced_symbol).toBeNull();
            engine.setForcedSymbol('R_25');
            engine.setForcedSymbol(null);
            expect(engine.market_switch.forced_symbol).toBeNull();
        });

        it('stays on the original market when nothing is configured', async () => {
            const { engine, ticksService } = createEngine();
            await engine.watchTicks('R_10');
            engine.sessionRuns = 7;
            engine.applyMarketSwitch();
            expect(engine.getActiveSymbol()).toBe('R_10');
            expect(ticksService.releaseSymbol).not.toHaveBeenCalled();
        });
    });

    describe('Analysis Logics helpers', () => {
        const withDigits = (engine, digits) => {
            engine.getLastDigitList = jest.fn().mockResolvedValue(digits);
        };

        it('last-digits condition is false until enough ticks exist', async () => {
            const { engine } = createEngine();
            withDigits(engine, [1, 2]);
            await expect(engine.getLastDigitsCondition({ n: 3, op: 'LESS', digit: 5 })).resolves.toBe(false);
            withDigits(engine, [1, 2, 3]);
            await expect(engine.getLastDigitsCondition({ n: 3, op: 'LESS', digit: 5 })).resolves.toBe(true);
            await expect(engine.getLastDigitsCondition({ n: 3, op: 'GREATER', digit: 1 })).resolves.toBe(false);
        });

        it('digit frequency returns the most and least common digit', async () => {
            const { engine } = createEngine();
            withDigits(engine, [7, 7, 7, 2, 2, 1, 0, 3, 4, 5, 6, 8, 9]);
            await expect(engine.getDigitFrequency({ rank: 'MOST', n: 100 })).resolves.toBe(7);
            await expect(engine.getDigitFrequency({ rank: 'LEAST', n: 100 })).resolves.toEqual(expect.any(Number));
        });

        it('even/odd and over/under percentages only look at the last N ticks', async () => {
            const { engine } = createEngine();
            withDigits(engine, [1, 1, 1, 1, 2, 4, 6, 8]);
            await expect(engine.getEvenOddPercent({ type: 'EVEN', n: 4 })).resolves.toBe(100);
            await expect(engine.getEvenOddPercent({ type: 'ODD', n: 8 })).resolves.toBe(50);
            await expect(engine.getOverUnderPercent({ threshold: 4, type: 'OVER', n: 4 })).resolves.toBe(50);
        });

        it('match/diff percent and empty lists do not divide by zero', async () => {
            const { engine } = createEngine();
            withDigits(engine, [5, 5, 1, 2]);
            await expect(engine.getMatchDiffPercent({ type: 'MATCH', val: 5, n: 4 })).resolves.toBe(50);
            withDigits(engine, []);
            await expect(engine.getMatchDiffPercent({ type: 'MATCH', val: 5, n: 4 })).resolves.toBe(0);
        });

        it('rise/fall percent compares candle close to open', async () => {
            const { engine } = createEngine();
            engine.getOhlc = jest.fn().mockResolvedValue([
                { open: 1, close: 2 },
                { open: 2, close: 1 },
                { open: 1, close: 3 },
                { open: 3, close: 3 },
            ]);
            await expect(engine.getRiseFallPercent({ type: 'RISE', n: 4 })).resolves.toBe(50);
            await expect(engine.getRiseFallPercent({ type: 'FALL', n: 4 })).resolves.toBe(25);
        });
    });
});
