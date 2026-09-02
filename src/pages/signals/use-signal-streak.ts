import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';

export type TSignalMode = 'evenodd' | 'overunder';
export type TSignalDirection = 'even' | 'odd' | 'over' | 'under';

type TStreakCore = {
    current_direction: TSignalDirection | null;
    current_streak: number;
    longest_a: number; // longest ever run of 'even' (evenodd mode) or 'over' (overunder mode)
    longest_b: number; // longest ever run of 'odd' (evenodd mode) or 'under' (overunder mode)
    total_triggers: number; // how many times the reference digit appeared with a follow-up tick observed
};

export type TSignalStreak = TStreakCore & {
    recent_outcomes: TSignalDirection[]; // most recent classified follow-ups, oldest first
    recent_digits: number[]; // last 20 raw digits, for context display
    is_loading: boolean;
    is_stale: boolean;
};

export type TDigitStreakRow = TStreakCore & { digit: number };

const EMPTY_CORE: TStreakCore = { current_direction: null, current_streak: 0, longest_a: 0, longest_b: 0, total_triggers: 0 };
const EMPTY_STREAK: TSignalStreak = { ...EMPTY_CORE, recent_outcomes: [], recent_digits: [], is_loading: true, is_stale: false };

// Walks the digit sequence once, only evaluating the tick immediately after
// each occurrence of reference_digit. A tick that ties the over/under
// threshold is skipped entirely — it neither counts as a trigger nor
// breaks the current streak.
const computeStreakCore = (
    digits: number[],
    reference_digit: number,
    mode: TSignalMode,
    threshold_digit: number
): TStreakCore & { outcomes: TSignalDirection[] } => {
    let run_direction: TSignalDirection | null = null;
    let run_length = 0;
    let longest_a = 0;
    let longest_b = 0;
    let total_triggers = 0;
    const outcomes: TSignalDirection[] = [];

    const closeRun = () => {
        if (run_direction === 'even' || run_direction === 'over') longest_a = Math.max(longest_a, run_length);
        else if (run_direction === 'odd' || run_direction === 'under') longest_b = Math.max(longest_b, run_length);
    };

    for (let i = 1; i < digits.length; i++) {
        if (digits[i - 1] !== reference_digit) continue;

        const d = digits[i];
        let direction: TSignalDirection | null;
        if (mode === 'evenodd') {
            direction = d % 2 === 0 ? 'even' : 'odd';
        } else if (d > threshold_digit) {
            direction = 'over';
        } else if (d < threshold_digit) {
            direction = 'under';
        } else {
            direction = null; // exactly equal to threshold — ignored entirely
        }

        if (direction === null) continue;

        total_triggers += 1;
        outcomes.push(direction);

        if (direction === run_direction) {
            run_length += 1;
        } else {
            closeRun();
            run_direction = direction;
            run_length = 1;
        }
    }
    closeRun();

    return { current_direction: run_direction, current_streak: run_length, longest_a, longest_b, total_triggers, outcomes };
};

const computeStreak = (
    digits: number[],
    reference_digit: number,
    mode: TSignalMode,
    threshold_digit: number
): Omit<TSignalStreak, 'is_loading' | 'is_stale'> => {
    const { outcomes, ...core } = computeStreakCore(digits, reference_digit, mode, threshold_digit);
    return { ...core, recent_outcomes: outcomes.slice(-30), recent_digits: digits.slice(-20) };
};

const computeAllStreaks = (digits: number[], mode: TSignalMode, threshold_digit: number): TDigitStreakRow[] =>
    Array.from({ length: 10 }, (_, d) => ({ digit: d, ...computeStreakCore(digits, d, mode, threshold_digit) }));

const inferPipSize = (raw_prices: (string | number)[]): number | null => {
    for (const p of raw_prices) {
        const s = String(p);
        const dot = s.indexOf('.');
        if (dot !== -1) return s.length - dot - 1;
    }
    return null;
};

type TTickDigitsState = { digits: number[]; is_loading: boolean; is_stale: boolean };
const EMPTY_TICK_STATE: TTickDigitsState = { digits: [], is_loading: true, is_stale: false };

// Single shared tick subscription (history fetch + live push + watchdog
// reconnect). Both the single-digit and all-digit streak hooks build on
// top of this, so switching view modes never opens a second subscription
// to the same symbol.
const useTickDigits = (symbol: string, tick_count: number, disabled: boolean): TTickDigitsState => {
    const [state, setState] = useState<TTickDigitsState>(EMPTY_TICK_STATE);
    const digitsRef = useRef<number[]>([]);
    const quotesRef = useRef<number[]>([]);
    const pipSizeRef = useRef<number>(2);
    const subscriptionIdRef = useRef<string | null>(null);
    const lastTickAtRef = useRef<number>(0);
    const lastEpochRef = useRef<number | null>(null);

    useEffect(() => {
        if (disabled) {
            setState(EMPTY_TICK_STATE);
            return;
        }

        let is_cancelled = false;
        let message_subscription: { unsubscribe: () => void } | null = null;
        let watchdog: ReturnType<typeof setInterval> | null = null;
        let resubscribing = false;

        const subscribeToTicks = async (): Promise<boolean> => {
            if (resubscribing) return false;
            resubscribing = true;
            try {
                if (subscriptionIdRef.current) {
                    await api_base.api.send({ forget: subscriptionIdRef.current }).catch(() => {});
                    subscriptionIdRef.current = null;
                }
                for (let attempt = 0; attempt < 3; attempt++) {
                    if (is_cancelled) return false;
                    try {
                        const sub_res = await api_base.api.send({ ticks: symbol, subscribe: 1 });
                        if (sub_res?.error) throw sub_res.error;
                        if (sub_res?.subscription?.id) subscriptionIdRef.current = sub_res.subscription.id;
                        lastTickAtRef.current = Date.now();
                        return true;
                    } catch (sub_error: any) {
                        const code = sub_error?.error?.code || sub_error?.code;
                        if (code === 'AlreadySubscribed') {
                            if (attempt === 2) {
                                await api_base.api.send({ forget_all: 'ticks' }).catch(() => {});
                            }
                            await new Promise(r => setTimeout(r, 400));
                            continue;
                        }
                        return false;
                    }
                }
                return false;
            } finally {
                resubscribing = false;
            }
        };

        const start = async () => {
            setState(prev => ({ ...prev, is_loading: true }));
            const pip_size_lookup = api_base?.pip_sizes?.[symbol];

            try {
                const history_res = await api_base.api.send({
                    ticks_history: symbol,
                    count: Math.min(tick_count, 5000),
                    end: 'latest',
                    style: 'ticks',
                });
                if (is_cancelled) return;

                const raw_prices: (string | number)[] = history_res?.history?.prices ?? [];
                const pip_size = pip_size_lookup ?? inferPipSize(raw_prices) ?? 2;
                pipSizeRef.current = pip_size;

                const prices: number[] = raw_prices.map(Number);
                quotesRef.current = prices;
                digitsRef.current = prices.map(q => Number(getLastDigitForList(q, pip_size)));
                setState({ digits: digitsRef.current, is_loading: false, is_stale: false });

                const normalize = (s: string) => (s || '').trim().toUpperCase();
                const target_symbol = normalize(symbol);

                message_subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                    if (data?.msg_type === 'tick' && normalize(data?.tick?.symbol) === target_symbol) {
                        const epoch = Number(data.tick.epoch);
                        if (epoch && epoch === lastEpochRef.current) return;
                        lastEpochRef.current = epoch || null;

                        if (data.tick.id) subscriptionIdRef.current = data.tick.id;
                        lastTickAtRef.current = Date.now();

                        const quote = Number(data.tick.quote);
                        quotesRef.current = [...quotesRef.current, quote].slice(-tick_count);
                        digitsRef.current = [...digitsRef.current, Number(getLastDigitForList(quote, pipSizeRef.current))].slice(
                            -tick_count
                        );

                        setState({ digits: digitsRef.current, is_loading: false, is_stale: false });
                    }
                });

                await subscribeToTicks();
                setState(prev => ({ ...prev, is_loading: false }));

                watchdog = setInterval(() => {
                    if (is_cancelled) return;
                    const silent_for = Date.now() - lastTickAtRef.current;
                    if (silent_for > 6000) {
                        setState(prev => ({ ...prev, is_stale: true }));
                        subscribeToTicks();
                    }
                }, 2000);
            } catch (e) {
                if (!is_cancelled) setState(prev => ({ ...prev, is_loading: false }));
            }
        };

        start();

        return () => {
            is_cancelled = true;
            message_subscription?.unsubscribe();
            if (watchdog) clearInterval(watchdog);
            if (subscriptionIdRef.current) {
                api_base.api.send({ forget: subscriptionIdRef.current }).catch(() => {});
                subscriptionIdRef.current = null;
            }
        };
    }, [symbol, tick_count, disabled]);

    return state;
};

export const useSignalStreak = (
    symbol: string,
    tick_count: number,
    reference_digit: number,
    mode: TSignalMode,
    threshold_digit: number,
    disabled = false
): TSignalStreak => {
    const { digits, is_loading, is_stale } = useTickDigits(symbol, tick_count, disabled);
    if (!digits.length) return { ...EMPTY_STREAK, is_loading, is_stale };
    return { ...computeStreak(digits, reference_digit, mode, threshold_digit), is_loading, is_stale };
};

export const useAllDigitStreaks = (
    symbol: string,
    tick_count: number,
    mode: TSignalMode,
    threshold_digit: number,
    disabled = false
): { rows: TDigitStreakRow[]; is_loading: boolean; is_stale: boolean } => {
    const { digits, is_loading, is_stale } = useTickDigits(symbol, tick_count, disabled);
    const rows = digits.length
        ? computeAllStreaks(digits, mode, threshold_digit)
        : Array.from({ length: 10 }, (_, d) => ({ digit: d, ...EMPTY_CORE }));
    return { rows, is_loading, is_stale };
};
