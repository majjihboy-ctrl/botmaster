import OpenContractMixin from '../OpenContract';
import { DURING_PURCHASE, STOP } from '../state/constants';

const mockBroadcast = jest.fn();
const mockContractStatus = jest.fn();

jest.mock('@/components/shared', () => ({
    getRoundedNumber: (n, _currency) => Math.round(Number(n) * 100) / 100,
}));
jest.mock('../../../api/api-base', () => ({
    api_base: { account_info: { loginid: 'CR1' }, api: { onMessage: () => ({ subscribe: jest.fn() }) } },
}));
jest.mock('../../utils/broadcast', () => ({
    contract: (...args) => mockBroadcast(...args),
    contractStatus: (...args) => mockContractStatus(...args),
}));

const createEngine = ({ scope = DURING_PURCHASE } = {}) => {
    const Engine = OpenContractMixin(class {});
    const engine = new Engine();
    engine.store = { getState: () => ({ scope }), dispatch: jest.fn() };
    engine.fastContracts = new Set();
    engine.fastSettledIds = new Set();
    engine.is_fast_mode = false;
    engine.sell_in_progress = false;
    engine.contractId = 111;
    engine.data = { contract: { contract_id: 111, buy_price: 10, currency: 'USD', transaction_ids: { buy: 5 } } };
    engine.updateTotals = jest.fn();
    engine.recordVirtualHookResult = jest.fn();
    return engine;
};

describe('fast execution settle', () => {
    beforeEach(() => jest.clearAllMocks());

    it('settles the current contract from a sell transaction', () => {
        const engine = createEngine();
        const transaction = { contract_id: 111, amount: 19.5, transaction_id: 9 };

        expect(engine.shouldFastSettleTransaction(transaction)).toBe(true);
        engine.handleFastSellTransaction(transaction);

        expect(engine.data.contract).toMatchObject({
            sell_price: 19.5,
            profit: 9.5,
            status: 'won',
            is_sold: 1,
            transaction_ids: { buy: 5, sell: 9 },
        });
        expect(engine.contractId).toBe('');
        expect(engine.updateTotals).toHaveBeenCalledTimes(1);
        expect(engine.recordVirtualHookResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'won' })); // feeds the Virtual Hook
        expect(mockContractStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'contract.sold', data: 9 }));
        expect(engine.store.dispatch).toHaveBeenCalledTimes(1);
        expect(engine.fastSettledIds.has(111)).toBe(true);
    });

    it('records a loss when the sell amount is 0', () => {
        const engine = createEngine();
        engine.handleFastSellTransaction({ contract_id: 111, amount: 0, transaction_id: 9 });
        expect(engine.data.contract).toMatchObject({ profit: -10, status: 'lost' });
    });

    it('resolves a pending after-purchase wait', () => {
        const engine = createEngine();
        engine.afterPromise = jest.fn();
        engine.handleFastSellTransaction({ contract_id: 111, amount: 19.5, transaction_id: 9 });
        expect(engine.afterPromise).toHaveBeenCalled();
    });

    it.each([
        ['another contract', e => (e.contractId = 222)],
        ['already settled', e => e.fastSettledIds.add(111)],
        ['parallel Fast run mode', e => (e.is_fast_mode = true)],
        ['manual sell in flight', e => (e.sell_in_progress = true)],
        ['no buy price yet', e => (e.data.contract = { contract_id: 111 })],
        ['no contract update received yet', e => (e.data.contract = {})],
    ])('does not fast settle: %s', (_name, mutate) => {
        const engine = createEngine();
        mutate(engine);
        expect(engine.shouldFastSettleTransaction({ contract_id: 111, amount: 19.5 })).toBe(false);
    });

    it('does not fast settle outside DURING_PURCHASE', () => {
        const engine = createEngine({ scope: STOP });
        expect(engine.shouldFastSettleTransaction({ contract_id: 111, amount: 19.5 })).toBe(false);
    });

    it('reconciles the full contract details without re-counting totals', () => {
        const engine = createEngine();
        engine.handleFastSellTransaction({ contract_id: 111, amount: 19.5, transaction_id: 9 });
        engine.updateTotals.mockClear();
        mockBroadcast.mockClear();

        const full = { contract_id: 111, is_sold: 1, exit_tick: '1.23', sell_price: 19.5, buy_price: 10 };
        engine.reconcileFastSettled(full);

        expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ exit_tick: '1.23' }));
        expect(engine.data.contract.exit_tick).toBe('1.23');
        expect(engine.updateTotals).not.toHaveBeenCalled();
    });
});
