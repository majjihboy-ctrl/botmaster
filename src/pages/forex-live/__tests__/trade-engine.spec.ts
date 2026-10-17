import {
    buildBuyRequest,
    buildSellRequest,
    errorText,
    FALLBACK_MULTIPLIERS,
    formatMoney,
    mergePosition,
    pickToClose,
    readMultipliers,
    summarize,
    toPosition,
    validateTrade,
    type Position,
    type TradeInput,
} from '../trade-engine';

const base: TradeInput = { side: 'BUY', symbol: 'frxEURUSD', stake: 10, multiplier: 100, currency: 'USD' };

const pos = (over: Partial<Position>): Position => ({
    id: 1,
    symbol: 'frxEURUSD',
    side: 'BUY',
    stake: 10,
    multiplier: 100,
    profit: 0,
    entry: null,
    spot: null,
    stopLoss: null,
    takeProfit: null,
    openedAt: 1,
    currency: 'USD',
    closed: false,
    result: null,
    canClose: true,
    ...over,
});

describe('buildBuyRequest', () => {
    it('opens a BUY as MULTUP with no expiry and the stake as the price', () => {
        const r = buildBuyRequest(base);
        expect(r).toEqual({
            buy: 1,
            price: 10,
            parameters: { contract_type: 'MULTUP', underlying_symbol: 'frxEURUSD', currency: 'USD', amount: 10, multiplier: 100 },
        });
        // a multiplier has no fixed time: nothing about duration or expiry may be sent
        expect(JSON.stringify(r)).not.toMatch(/duration|expiry/);
    });

    it('opens a SELL as MULTDOWN', () => {
        expect(buildBuyRequest({ ...base, side: 'SELL' }).parameters.contract_type).toBe('MULTDOWN');
    });

    it('adds stop loss and take profit only when given', () => {
        expect(buildBuyRequest(base).parameters.limit_order).toBeUndefined();
        expect(buildBuyRequest({ ...base, stopLoss: 4, takeProfit: 12.5 }).parameters.limit_order).toEqual({ stop_loss: 4, take_profit: 12.5 });
        expect(buildBuyRequest({ ...base, stopLoss: null, takeProfit: 5 }).parameters.limit_order).toEqual({ take_profit: 5 });
    });

    it('rounds money to cents', () => {
        const r = buildBuyRequest({ ...base, stake: 10.456 });
        expect(r.price).toBe(10.46);
        expect(r.parameters.amount).toBe(10.46);
    });
});

describe('validateTrade', () => {
    it('accepts a normal trade', () => expect(validateTrade(base)).toBeNull());
    it.each([
        [{ symbol: '' }, /market/i],
        [{ currency: '' }, /account/i],
        [{ stake: 0 }, /stake/i],
        [{ stake: NaN }, /stake/i],
        [{ multiplier: 0 }, /multiplier/i],
        [{ stopLoss: 0 }, /stop loss/i],
        [{ takeProfit: -3 }, /take profit/i],
        [{ stopLoss: 10 }, /less than the stake/i],
    ])('refuses %j', (over, text) => {
        expect(validateTrade({ ...base, ...over } as TradeInput)).toMatch(text as RegExp);
    });
});

describe('buildSellRequest', () => {
    it('closes at the market price', () => expect(buildSellRequest(77)).toEqual({ sell: 77, price: 0 }));
});

describe('toPosition', () => {
    const raw = {
        contract_id: 123,
        contract_type: 'MULTDOWN',
        underlying_symbol: 'frxGBPUSD',
        buy_price: '5.00',
        profit: '1.25',
        multiplier: 200,
        entry_spot: '1.3000',
        current_spot: '1.2990',
        purchase_time: 1700000000,
        is_sold: 0,
        is_valid_to_sell: 1,
        currency: 'USD',
        limit_order: { stop_loss: { order_amount: -2 }, take_profit: { order_amount: 6 } },
    };

    it('reads an open multiplier', () => {
        expect(toPosition(raw)).toMatchObject({
            id: 123,
            symbol: 'frxGBPUSD',
            side: 'SELL',
            stake: 5,
            profit: 1.25,
            multiplier: 200,
            entry: 1.3,
            spot: 1.299,
            stopLoss: -2,
            takeProfit: 6,
            closed: false,
            canClose: true,
        });
    });

    it('ignores anything that is not a multiplier (bot trades)', () => {
        expect(toPosition({ ...raw, contract_type: 'DIGITOVER' })).toBeNull();
        expect(toPosition(null)).toBeNull();
        expect(toPosition({ contract_type: 'MULTUP' })).toBeNull();
    });

    it('marks a sold trade as closed with its result', () => {
        const p = toPosition({ ...raw, is_sold: 1, profit: -2, status: 'sold' })!;
        expect(p.closed).toBe(true);
        expect(p.result).toBe(-2);
        expect(p.canClose).toBe(false);
    });

    it('accepts the older field names', () => {
        expect(toPosition({ contract_id: 5, contract_type: 'MULTUP', underlying: 'frxEURUSD', buy_price: 1, entry_tick: 1.1 })).toMatchObject({
            symbol: 'frxEURUSD',
            side: 'BUY',
            entry: 1.1,
        });
    });
});

describe('mergePosition', () => {
    it('keeps numbers a later message does not carry', () => {
        const merged = mergePosition(pos({ entry: 1.1, profit: 2 }), pos({ entry: null, profit: null }));
        expect(merged.entry).toBe(1.1);
        expect(merged.profit).toBe(2);
    });
    it('takes the newest values', () => {
        expect(mergePosition(pos({ profit: 1 }), pos({ profit: 3 })).profit).toBe(3);
    });
});

describe('summarize and pickToClose', () => {
    const list = [
        pos({ id: 1, side: 'BUY', profit: 2 }),
        pos({ id: 2, side: 'BUY', profit: -1 }),
        pos({ id: 3, side: 'SELL', profit: 0.5, symbol: 'frxGBPUSD' }),
        pos({ id: 4, side: 'SELL', profit: -3 }),
        pos({ id: 5, closed: true, profit: 9 }),
    ];

    it('adds up only open trades', () => {
        expect(summarize(list)).toEqual({ open: 4, buys: 2, sells: 2, stake: 40, profit: -1.5, winning: 2, losing: 2 });
    });

    it('picks what each close button means', () => {
        const ids = (f: Parameters<typeof pickToClose>[1], s?: string) => pickToClose(list, f, s).map(p => p.id);
        expect(ids('all')).toEqual([1, 2, 3, 4]);
        expect(ids('buy')).toEqual([1, 2]);
        expect(ids('sell')).toEqual([3, 4]);
        expect(ids('winning')).toEqual([1, 3]);
        expect(ids('losing')).toEqual([2, 4]);
        expect(ids('all', 'frxGBPUSD')).toEqual([3]);
    });

    it('never tries to close a trade Deriv says cannot be closed', () => {
        expect(pickToClose([pos({ id: 1, canClose: false })], 'all')).toEqual([]);
    });
});

describe('readMultipliers', () => {
    it('reads the multiplier range from contracts_for', () => {
        const answer = {
            contracts_for: {
                available: [
                    { contract_category: 'callput', contract_type: 'CALL' },
                    { contract_category: 'multiplier', contract_type: 'MULTUP', multiplier_range: [100, 30, 50] },
                    { contract_category: 'multiplier', contract_type: 'MULTDOWN', multiplier_range: [30, 50, 100, 200] },
                ],
            },
        };
        expect(readMultipliers(answer)).toEqual([30, 50, 100, 200]);
    });
    it('falls back to a usable list', () => {
        expect(readMultipliers(null)).toEqual(FALLBACK_MULTIPLIERS);
        expect(readMultipliers({ contracts_for: { available: [] } })).toEqual(FALLBACK_MULTIPLIERS);
    });
});

describe('errorText and formatMoney', () => {
    it('finds a readable message in any shape', () => {
        expect(errorText({ error: { message: 'Insufficient balance.' } })).toBe('Insufficient balance.');
        expect(errorText(new Error('boom'))).toBe('boom');
        expect(errorText('plain')).toBe('plain');
        expect(errorText(undefined)).toMatch(/try again/i);
    });
    it('formats profit and loss with a sign', () => {
        expect(formatMoney(1.5)).toBe('+1.50');
        expect(formatMoney(-2)).toBe('-2.00');
        expect(formatMoney(0)).toBe('0.00');
        expect(formatMoney(null)).toBe('—');
        expect(formatMoney(3, 'USD')).toBe('+3.00 USD');
    });
});
