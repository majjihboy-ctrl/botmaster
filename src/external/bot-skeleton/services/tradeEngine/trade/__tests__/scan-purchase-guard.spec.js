import PurchaseMixin from '../Purchase';

jest.mock('../../../api/api-base', () => ({ api_base: { api: { send: jest.fn() } } }));
jest.mock('../../utils/broadcast', () => ({
    contractStatus: jest.fn(),
    info: jest.fn(),
    log: jest.fn(),
    notify: jest.fn(),
}));
jest.mock('../../utils/helpers', () => ({
    doUntilDone: jest.fn(),
    getUUID: jest.fn(() => 'uuid'),
    recoverFromError: jest.fn(),
    tradeOptionToBuy: jest.fn(() => ({})),
}));
jest.mock('../../utils/run-mode', () => ({ isFastExecution: jest.fn(() => false) }));
jest.mock('../state/actions', () => ({ purchaseSuccessful: jest.fn() }));

const createEngine = ({ stale, virtual }) => {
    const Engine = PurchaseMixin(class {});
    const engine = new Engine();
    engine.store = { getState: () => ({ scope: 'BEFORE_PURCHASE' }), dispatch: jest.fn() };
    engine.isScanPurchaseStale = jest.fn(() => stale);
    engine.shouldTradeVirtually = jest.fn(() => virtual);
    engine.virtualPurchase = jest.fn(() => Promise.resolve('virtual'));
    return engine;
};

describe('purchase and Scan all markets', () => {
    it('ignores a purchase from rules that ran on a market the bot has left', async () => {
        const engine = createEngine({ stale: true, virtual: true });
        await expect(engine.purchase('DIGITOVER')).resolves.toBeUndefined();
        expect(engine.virtualPurchase).not.toHaveBeenCalled();
        expect(engine.shouldTradeVirtually).not.toHaveBeenCalled();
    });

    it('lets a fresh purchase through to the Virtual Hook as before', async () => {
        const engine = createEngine({ stale: false, virtual: true });
        await expect(engine.purchase('DIGITOVER')).resolves.toBe('virtual');
        expect(engine.virtualPurchase).toHaveBeenCalledWith('DIGITOVER');
    });
});
