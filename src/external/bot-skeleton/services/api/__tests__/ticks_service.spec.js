import TicksService from '../ticks_service';
import { api_base } from '../api-base';

jest.mock('../api-base', () => ({
    api_base: {
        api: {
            forget: jest.fn().mockResolvedValue({}),
            onMessage: () => ({ subscribe: jest.fn(() => ({})) }),
        },
        pushSubscription: jest.fn(),
        toggleRunButton: jest.fn(),
    },
}));
jest.mock('../../tradeEngine/utils/helpers', () => ({
    doUntilDone: jest.fn(fn => Promise.resolve(fn())),
    getUUID: jest.fn(() => 'uuid'),
}));
jest.mock('../../../utils/observer', () => ({ observer: { emit: jest.fn() } }));

describe('TicksService.releaseSymbol', () => {
    it('forgets the tick and candle streams of the symbol and clears its cached data', async () => {
        const service = new TicksService();
        service.subscriptions = service.subscriptions
            .setIn(['tick', 'R_10'], 'tick-id')
            .setIn(['ohlc', 'R_10', 60], 'ohlc-id');
        service.ticks = service.ticks.set('R_10', [1, 2, 3]);
        service.candles = service.candles.setIn(['R_10', 60], [{ open: 1 }]);
        service.tickListeners = service.tickListeners.setIn(['R_10', 'k'], () => {});
        service.ticks_history_promise = { promise: Promise.resolve(), stringified_options: '{}' };

        await service.releaseSymbol('R_10');

        expect(api_base.api.forget).toHaveBeenCalledWith('tick-id');
        expect(api_base.api.forget).toHaveBeenCalledWith('ohlc-id');
        expect(service.ticks.has('R_10')).toBe(false);
        expect(service.candles.has('R_10')).toBe(false);
        expect(service.tickListeners.has('R_10')).toBe(false);
        expect(service.subscriptions.hasIn(['tick', 'R_10'])).toBe(false);
        expect(service.ticks_history_promise).toBeNull();
    });

    it('leaves other symbols untouched', async () => {
        const service = new TicksService();
        service.ticks = service.ticks.set('R_10', [1]).set('R_25', [2]);
        service.subscriptions = service.subscriptions.setIn(['tick', 'R_25'], 'keep-me');

        await service.releaseSymbol('R_10');

        expect(service.ticks.has('R_25')).toBe(true);
        expect(service.subscriptions.getIn(['tick', 'R_25'])).toBe('keep-me');
    });

    it('does not throw when the symbol was never subscribed', async () => {
        const service = new TicksService();
        await expect(service.releaseSymbol('NOPE')).resolves.toBeUndefined();
        await expect(service.releaseSymbol(undefined)).resolves.toBeUndefined();
    });

    it('still releases locally if forgetting the stream fails', async () => {
        const service = new TicksService();
        service.ticks = service.ticks.set('R_10', [1]);
        service.subscriptions = service.subscriptions.setIn(['tick', 'R_10'], 'tick-id');
        api_base.api.forget.mockRejectedValueOnce(new Error('network'));

        await expect(service.releaseSymbol('R_10')).resolves.toBeUndefined();
        expect(service.ticks.has('R_10')).toBe(false);
    });
});
