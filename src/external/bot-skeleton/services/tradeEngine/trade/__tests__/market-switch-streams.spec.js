/**
 * Switching markets must not leak tick streams. Deriv allows only a limited number of open subscriptions on
 * one connection; every leaked stream moves a long-running bot closer to "SubscriptionLimitExceeded".
 */
import TicksService from '../../../api/ticks_service';
import TicksMixin from '../Ticks';

const mockOpenStreams = new Set();
let mockStreamCounter = 0;

jest.mock('../../../api/api-base', () => {
    const api = {
        send: jest.fn(async request => {
            if (request.ticks_history) {
                mockStreamCounter += 1;
                const id = `${request.ticks_history}-stream-${mockStreamCounter}`;
                mockOpenStreams.add(id);
                return { history: { times: [1, 2, 3], prices: [1.11, 1.12, 1.13] }, subscription: { id } };
            }
            return {};
        }),
        forget: jest.fn(async id => {
            mockOpenStreams.delete(id);
            return {};
        }),
        onMessage: () => ({ subscribe: jest.fn(() => ({})) }),
    };
    return { api_base: { api, pip_sizes: {}, pushSubscription: jest.fn(), toggleRunButton: jest.fn() } };
});
jest.mock('../../../api/api-helpers', () => ({ __esModule: true, default: { instance: {} } }));
jest.mock('../../utils/helpers', () => ({
    doUntilDone: jest.fn(fn => Promise.resolve(fn())),
    getUUID: jest.fn(() => `uuid-${Math.random()}`),
}));
jest.mock('../../utils/broadcast', () => ({ notify: jest.fn() }));
jest.mock('../../../../utils/observer', () => ({ observer: { emit: jest.fn() } }));
jest.mock('@deriv-com/translations', () => ({ localize: text => text }));

const createEngine = () => {
    const Engine = TicksMixin(class {});
    const engine = new Engine();
    engine.$scope = { ticksService: new TicksService() };
    engine.store = { dispatch: jest.fn() };
    engine.is_proposal_subscription_required = false;
    return engine;
};

describe('switching markets', () => {
    beforeEach(() => {
        mockOpenStreams.clear();
        mockStreamCounter = 0;
    });

    it('keeps exactly one tick stream open while rotating through markets', async () => {
        const engine = createEngine();
        const rotation = ['R_100', 'R_25', '1HZ100V', 'R_75', 'R_100', 'R_25', '1HZ100V', 'R_75', 'R_100'];

        for (const symbol of rotation) {
            await engine.watchTicks(symbol);
            expect(mockOpenStreams.size).toBe(1);
            expect([...mockOpenStreams][0]).toContain(symbol);
        }
    });

    it('stays at one stream after many rapid switches (the long-run case)', async () => {
        const engine = createEngine();
        const symbols = ['R_100', 'R_25', '1HZ100V', 'R_75'];
        for (let i = 0; i < 60; i += 1) {
            await engine.watchTicks(symbols[i % symbols.length]);
        }
        expect(mockOpenStreams.size).toBe(1);
    });
});
