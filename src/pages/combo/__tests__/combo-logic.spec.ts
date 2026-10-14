import { sanitizeSettings } from '../../auto-trades/engine-logic';
import { roundExposure, roundOutcome, worstCaseExposure } from '../combo-logic';

describe('roundOutcome', () => {
    it('is a loss only when every trade lost', () => {
        expect(roundOutcome([-1, -1, -1]).all_lost).toBe(true);
        expect(roundOutcome([-1, 0.9, -1]).all_lost).toBe(false);
        expect(roundOutcome([0.9, 0.9]).all_lost).toBe(false);
    });
    it('sums the net result and never calls an empty round a loss', () => {
        expect(roundOutcome([-1, 0.95, -1]).net).toBe(-1.05);
        expect(roundOutcome([]).all_lost).toBe(false);
    });
});

describe('exposure', () => {
    const s = sanitizeSettings({ stake: 1, multiplier: 2, max_steps: 3, max_stake: 100 });
    it('scales with the number of markets', () => {
        expect(roundExposure(2, 3)).toBe(6);
        expect(worstCaseExposure(s, 3)).toBe(21); // (1+2+4) * 3
    });
    it('respects the per-trade stake cap', () => {
        const capped = sanitizeSettings({ stake: 1, multiplier: 2, max_steps: 4, max_stake: 2 });
        expect(worstCaseExposure(capped, 2)).toBe(14); // (1+2+2+2) * 2
    });
});
