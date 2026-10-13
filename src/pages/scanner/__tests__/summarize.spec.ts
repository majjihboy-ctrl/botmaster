import { summarize, TBuffer } from '../use-digit-scanner';

jest.mock('@/external/bot-skeleton', () => ({ api_base: {} }));
jest.mock('@/external/bot-skeleton/services/tradeEngine/utils/helpers', () => ({
    getLastDigitForList: (quote: number) => String(quote).slice(-1),
}));
jest.mock('@/pages/analysis-tool/use-digit-stats', () => ({}));

const buf = (digits: number[]): TBuffer => ({ digits, quote: '123.45', pip_size: 2, loaded: true });

describe('summarize', () => {
    it('counts digits, percentages and even/odd split over the whole sample', () => {
        const scan = summarize('R_10', 'Volatility 10', buf([0, 2, 2, 3, 5, 5, 5, 8]), 1000);
        expect(scan.sample_size).toBe(8);
        expect(scan.counts).toEqual([1, 0, 2, 1, 0, 3, 0, 0, 1, 0]);
        expect(scan.pcts[5]).toBeCloseTo(37.5);
        expect(scan.even_pct).toBeCloseTo(50); // 0,2,2,8 are even
        expect(scan.odd_pct).toBeCloseTo(50);
        expect(scan.most_idx).toBe(5);
    });

    it('only looks at the newest N digits when the window is smaller than the history', () => {
        const scan = summarize('R_10', 'Volatility 10', buf([9, 9, 9, 9, 1, 2, 3, 4]), 4);
        expect(scan.sample_size).toBe(4);
        expect(scan.counts[9]).toBe(0);
        expect(scan.counts.slice(1, 5)).toEqual([1, 1, 1, 1]);
    });

    it('reports an empty sample without dividing by zero', () => {
        const scan = summarize('R_10', 'Volatility 10', buf([]), 100);
        expect(scan.sample_size).toBe(0);
        expect(scan.even_pct).toBe(0);
        expect(scan.odd_pct).toBe(0);
        expect(scan.pcts.every(p => p === 0)).toBe(true);
    });

    it('caps the recent-digit strip and keeps newest last', () => {
        const digits = Array.from({ length: 30 }, (_, i) => i % 10);
        const scan = summarize('R_10', 'Volatility 10', buf(digits), 1000);
        expect(scan.last_digits).toHaveLength(12);
        expect(scan.last_digits[11]).toBe(29 % 10);
    });
});
