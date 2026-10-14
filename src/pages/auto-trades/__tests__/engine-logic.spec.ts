import {
    afterTrade,
    classify,
    contractFor,
    currentStreak,
    initialTracker,
    LIMITS,
    sanitizeSettings,
    stakeAfterLosses,
    stopReason,
} from '../engine-logic';

const base = sanitizeSettings({
    signal: 'even',
    mode: 'continuation',
    barrier: 4,
    streak: 3,
    stake: 1,
    multiplier: 2,
    max_steps: 4,
    take_profit: 10,
    stop_loss: 10,
    max_stake: 20,
});

describe('classify / currentStreak', () => {
    it('treats digit == barrier as neither over nor under', () => {
        expect(classify(4, 'over', 4)).toBe(false);
        expect(classify(4, 'under', 4)).toBe(false);
        expect(classify(5, 'over', 4)).toBe(true);
    });

    it('counts only the unbroken run at the newest end', () => {
        expect(currentStreak([1, 2, 4, 6, 8], 'even', 4)).toBe(4); // 2,4,6,8; the leading 1 breaks it
        expect(currentStreak([2, 4, 6, 7], 'even', 4)).toBe(0);
        expect(currentStreak([], 'even', 4)).toBe(0);
    });
});

describe('contractFor', () => {
    it('follows the streak in continuation mode and fades it in reversal mode', () => {
        expect(contractFor('even', 'continuation')).toBe('DIGITEVEN');
        expect(contractFor('even', 'reversal')).toBe('DIGITODD');
        expect(contractFor('over', 'reversal')).toBe('DIGITUNDER');
    });
});

describe('sanitizeSettings', () => {
    it('clamps hostile or garbage input into safe ranges', () => {
        const s = sanitizeSettings({
            stake: -5,
            barrier: 0,
            streak: 99,
            multiplier: 1000,
            max_steps: 500,
            max_stake: 1e9,
        });
        expect(s.stake).toBe(LIMITS.min_stake);
        expect(s.barrier).toBe(LIMITS.min_barrier);
        expect(s.streak).toBe(LIMITS.max_streak);
        expect(s.multiplier).toBe(LIMITS.max_multiplier);
        expect(s.max_steps).toBe(LIMITS.max_martingale_steps);
        expect(s.max_stake).toBe(LIMITS.max_stake);
    });

    it('survives NaN and never lets the cap sit below the first stake', () => {
        const s = sanitizeSettings({ stake: Number.NaN, max_stake: 0.01 });
        expect(Number.isFinite(s.stake)).toBe(true);
        expect(s.max_stake).toBeGreaterThanOrEqual(s.stake);
    });
});

describe('martingale staking', () => {
    it('multiplies per consecutive loss and resets on a win', () => {
        expect(stakeAfterLosses(base, 0)).toBe(1);
        expect(stakeAfterLosses(base, 1)).toBe(2);
        expect(stakeAfterLosses(base, 3)).toBe(8);
        const t = afterTrade(afterTrade(initialTracker(), false), true);
        expect(t.losses_in_a_row).toBe(0);
    });

    it('never returns a stake above the cap', () => {
        expect(stakeAfterLosses(base, 9)).toBe(20);
    });
});

describe('stopReason', () => {
    it('stops at take profit and stop loss', () => {
        expect(stopReason(base, 10, 0)).toBe('take_profit');
        expect(stopReason(base, -10, 0)).toBe('stop_loss');
        expect(stopReason(base, 3, 0)).toBeNull();
    });

    it('stops at max steps', () => {
        expect(stopReason(base, 0, 4)).toBe('max_steps');
    });

    it('stops instead of trading a smaller size when the next stake would break the cap', () => {
        // 1 * 2^5 = 32 > cap 20, but max_steps (4) is not reached on a looser config
        const loose = { ...base, max_steps: 10 };
        expect(stopReason(loose, 0, 5)).toBe('stake_cap');
        expect(stopReason(loose, 0, 4)).toBeNull(); // 16 <= 20
    });
});

describe('loss tracker and cooldown', () => {
    it('starts a cooldown after two losses in a row, then restarts the count', () => {
        let t = afterTrade(initialTracker(), false);
        expect(t.cooldown_left).toBe(0);
        t = afterTrade(t, false);
        expect(t.cooldown_left).toBe(LIMITS.cooldown_ticks);
        expect(t.losses_in_a_row).toBe(2); // martingale step is NOT reset by the cooldown
        expect(t.consecutive_losses).toBe(0);
    });

    it('a win clears the loss run but keeps a running cooldown', () => {
        const cooling = { losses_in_a_row: 2, consecutive_losses: 0, cooldown_left: 10 };
        const t = afterTrade(cooling, true);
        expect(t.losses_in_a_row).toBe(0);
        expect(t.cooldown_left).toBe(10);
    });
});
