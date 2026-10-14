/**
 * Pure decision logic for Auto Trades. No network, no React: everything that decides
 * WHEN to trade and HOW MUCH lives here so it can be unit-tested.
 */

export type TSignal = 'even' | 'odd' | 'over' | 'under';
export type TMode = 'continuation' | 'reversal';
export type TContract = 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER';

export const LIMITS = {
    min_stake: 0.35,
    max_stake: 1000,
    min_barrier: 1, // barrier 0 makes UNDER impossible
    max_barrier: 8, // barrier 9 makes OVER impossible
    min_streak: 2,
    max_streak: 10,
    max_martingale_steps: 10,
    max_multiplier: 5,
    cooldown_ticks: 30,
    losses_before_cooldown: 2,
};

export const roundMoney = (n: number) => Math.round(n * 100) / 100;

export const clamp = (n: number, min: number, max: number) =>
    Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;

/** What a single digit "says" under the chosen signal family. Digit == barrier says nothing. */
export const classify = (digit: number, signal: TSignal, barrier: number): boolean => {
    switch (signal) {
        case 'even':
            return digit % 2 === 0;
        case 'odd':
            return digit % 2 === 1;
        case 'over':
            return digit > barrier;
        case 'under':
            return digit < barrier;
    }
};

/** Length of the run of digits, ending at the newest one, that all satisfy the signal. */
export const currentStreak = (digits: number[], signal: TSignal, barrier: number): number => {
    let n = 0;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
        if (!classify(digits[i], signal, barrier)) break;
        n += 1;
    }
    return n;
};

export const OPPOSITE: Record<TSignal, TSignal> = { even: 'odd', odd: 'even', over: 'under', under: 'over' };

const CONTRACT_FOR: Record<TSignal, TContract> = {
    even: 'DIGITEVEN',
    odd: 'DIGITODD',
    over: 'DIGITOVER',
    under: 'DIGITUNDER',
};

/** Which contract to buy once a streak of `signal` has formed. */
export const contractFor = (signal: TSignal, mode: TMode): TContract =>
    CONTRACT_FOR[mode === 'continuation' ? signal : OPPOSITE[signal]];

export const needsBarrier = (contract: TContract) => contract === 'DIGITOVER' || contract === 'DIGITUNDER';

export type TSettings = {
    signal: TSignal;
    mode: TMode;
    barrier: number;
    streak: number;
    stake: number;
    multiplier: number;
    max_steps: number;
    take_profit: number;
    stop_loss: number;
    max_stake: number;
};

/** Clamp every user-supplied number into a safe range before the engine ever sees it. */
export const sanitizeSettings = (raw: Partial<TSettings>): TSettings => {
    const stake = roundMoney(clamp(Number(raw.stake), LIMITS.min_stake, LIMITS.max_stake));
    return {
        signal: (['even', 'odd', 'over', 'under'] as TSignal[]).includes(raw.signal as TSignal)
            ? (raw.signal as TSignal)
            : 'even',
        mode: raw.mode === 'reversal' ? 'reversal' : 'continuation',
        barrier: Math.round(clamp(Number(raw.barrier), LIMITS.min_barrier, LIMITS.max_barrier)),
        streak: Math.round(clamp(Number(raw.streak), LIMITS.min_streak, LIMITS.max_streak)),
        stake,
        multiplier: clamp(Number(raw.multiplier), 1, LIMITS.max_multiplier),
        max_steps: Math.round(clamp(Number(raw.max_steps), 1, LIMITS.max_martingale_steps)),
        take_profit: Math.max(0, Number(raw.take_profit) || 0),
        stop_loss: Math.max(0, Number(raw.stop_loss) || 0),
        // The cap can never sit below the first stake.
        max_stake: roundMoney(clamp(Number(raw.max_stake), stake, LIMITS.max_stake)),
    };
};

/** Stake after `losses_in_a_row` consecutive losses. Never exceeds the cap. */
export const stakeAfterLosses = (s: TSettings, losses_in_a_row: number): number =>
    roundMoney(Math.min(s.max_stake, s.stake * Math.pow(s.multiplier, losses_in_a_row)));

export type TStopReason = 'take_profit' | 'stop_loss' | 'max_steps' | 'stake_cap' | null;

/** Should the session stop now? Checked after every settled trade. */
export const stopReason = (s: TSettings, session_profit: number, losses_in_a_row: number): TStopReason => {
    if (s.take_profit > 0 && session_profit >= s.take_profit) return 'take_profit';
    if (s.stop_loss > 0 && session_profit <= -s.stop_loss) return 'stop_loss';
    if (losses_in_a_row >= s.max_steps) return 'max_steps';
    // The next martingale stake would exceed the cap: stop instead of silently trading a smaller size.
    if (losses_in_a_row > 0 && s.stake * Math.pow(s.multiplier, losses_in_a_row) > s.max_stake + 1e-9) {
        return 'stake_cap';
    }
    return null;
};

export type TLossTracker = { losses_in_a_row: number; consecutive_losses: number; cooldown_left: number };

export const initialTracker = (): TLossTracker => ({ losses_in_a_row: 0, consecutive_losses: 0, cooldown_left: 0 });

/** Update loss counters after a settled trade. Two losses in a row start a cooldown. */
export const afterTrade = (t: TLossTracker, won: boolean): TLossTracker => {
    if (won) return { losses_in_a_row: 0, consecutive_losses: 0, cooldown_left: t.cooldown_left };
    const consecutive = t.consecutive_losses + 1;
    const cooling = consecutive >= LIMITS.losses_before_cooldown;
    return {
        losses_in_a_row: t.losses_in_a_row + 1,
        consecutive_losses: cooling ? 0 : consecutive,
        cooldown_left: cooling ? LIMITS.cooldown_ticks : t.cooldown_left,
    };
};
