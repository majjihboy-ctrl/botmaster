import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';

export type TSymbolOption = { symbol: string; display_name: string };

// Fallback used only until the live active_symbols list has loaded.
// NOTE: Volatility 15/30/90 (1s) are NOT included here — Deriv only offers
// those through MT5/cTrader, not through this WebSocket options API, so
// they never actually appear in a real active_symbols response and any
// live tick subscription for them will never receive data.
const FALLBACK_SYMBOLS: TSymbolOption[] = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index' },
    { symbol: 'R_25', display_name: 'Volatility 25 Index' },
    { symbol: 'R_50', display_name: 'Volatility 50 Index' },
    { symbol: 'R_75', display_name: 'Volatility 75 Index' },
    { symbol: 'R_100', display_name: 'Volatility 100 Index' },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index' },
    { symbol: 'JD10', display_name: 'Jump 10 Index' },
    { symbol: 'JD25', display_name: 'Jump 25 Index' },
    { symbol: 'JD50', display_name: 'Jump 50 Index' },
    { symbol: 'JD75', display_name: 'Jump 75 Index' },
    { symbol: 'JD100', display_name: 'Jump 100 Index' },
];

// Only these two submarkets: Volatility (Continuous) Indices and Jump
// Indices. Everything else — Crash/Boom, Step, Range Break, Drift Switch,
// Bear/Bull daily reset — is excluded per product scope.
const ALLOWED_SUBMARKETS = new Set(['random_index', 'jump_index']);

export const useSyntheticSymbols = (): TSymbolOption[] => {
    const [symbols, setSymbols] = useState<TSymbolOption[]>(FALLBACK_SYMBOLS);

    useEffect(() => {
        let attempts = 0;
        const tryLoad = () => {
            const list = api_base?.active_symbols;
            if (Array.isArray(list) && list.length) {
                const synthetic = list
                    .filter((s: any) => s.market === 'synthetic_index' && ALLOWED_SUBMARKETS.has(s.submarket))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name || s.symbol }));
                if (synthetic.length) {
                    setSymbols(synthetic);
                    return;
                }
            }
            attempts += 1;
            if (attempts < 10) setTimeout(tryLoad, 500);
        };
        tryLoad();
    }, []);

    return symbols;
};

export type TDigitStats = {
    digit_counts: number[]; // index 0-9, count of occurrences in the current window
    window_counts: { label: string; size: number; counts: number[] }[];
    ticks_since_last_seen: number[]; // index 0-9, ticks since each digit last appeared (-1 = not seen)
    most_idx: number;
    second_idx: number;
    least_idx: number;
    even_pct: number;
    odd_pct: number;
    over_pct: number;
    under_pct: number;
    equal_pct: number;
    streak_count: number;
    streak_direction: 'rise' | 'fall' | null;
    recent_digits: number[];
    recent_digits_100: number[];
    recent_quotes: number[];
    digits: number[];
    current_quote: number | null;
    quote_change_pct: number;
    rise_pct: number;
    fall_pct: number;
    is_loading: boolean;
    is_stale: boolean;
};

const EMPTY_STATS: TDigitStats = {
    digit_counts: new Array(10).fill(0),
    window_counts: [],
    ticks_since_last_seen: new Array(10).fill(-1),
    most_idx: 0,
    second_idx: 0,
    least_idx: 0,
    even_pct: 0,
    odd_pct: 0,
    over_pct: 0,
    under_pct: 0,
    equal_pct: 0,
    streak_count: 0,
    streak_direction: null,
    recent_digits: [],
    recent_quotes: [],
    recent_digits_100: [],
    digits: [],
    current_quote: null,
    quote_change_pct: 0,
    rise_pct: 0,
    fall_pct: 0,
    is_loading: true,
    is_stale: false,
};

const countDigits = (quotes: number[], pip_size: number): number[] => {
    const counts = new Array(10).fill(0);
    quotes.forEach(q => {
        const d = Number(getLastDigitForList(q, pip_size));
        if (d >= 0 && d <= 9) counts[d] += 1;
    });
    return counts;
};

// Fallback for when api_base.pip_sizes hasn't loaded yet for this symbol:
// infer decimal precision directly from a real quote string rather than
// assuming 2 (wrong for e.g. R_10/R_25, which use 3 decimals).
const inferPipSize = (raw_prices: (string | number)[]): number | null => {
    for (const p of raw_prices) {
        const s = String(p);
        const dot = s.indexOf('.');
        if (dot !== -1) return s.length - dot - 1;
    }
    return null;
};

const WINDOW_SIZES = [50, 200];

const computeStats = (quotes: number[], pip_size: number, over_under_digit: number): TDigitStats => {
    const digits = quotes.map(q => Number(getLastDigitForList(q, pip_size)));
    const digit_counts = new Array(10).fill(0);
    digits.forEach(d => {
        if (d >= 0 && d <= 9) digit_counts[d] += 1;
    });

    const ranked = digit_counts.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const most_idx = ranked[0]?.i ?? 0;
    const second_idx = ranked[1]?.i ?? 0;
    const least_idx = ranked[ranked.length - 1]?.i ?? 0;

    const total = digits.length || 1;
    const even_count = digits.filter(d => d % 2 === 0).length;
    const over_count = digits.filter(d => d > over_under_digit).length;
    const under_count = digits.filter(d => d < over_under_digit).length;

    // Streak: consecutive rises/falls based on raw quote direction
    let streak_count = 0;
    let streak_direction: 'rise' | 'fall' | null = null;
    let rise_count = 0;
    let fall_count = 0;
    for (let i = 1; i < quotes.length; i++) {
        const diff = quotes[i] - quotes[i - 1];
        if (diff > 0) rise_count += 1;
        else if (diff < 0) fall_count += 1;
    }
    for (let i = quotes.length - 1; i > 0; i--) {
        const diff = quotes[i] - quotes[i - 1];
        if (diff === 0) break;
        const dir = diff > 0 ? 'rise' : 'fall';
        if (streak_direction === null) {
            streak_direction = dir;
            streak_count = 1;
        } else if (dir === streak_direction) {
            streak_count += 1;
        } else {
            break;
        }
    }
    const move_total = rise_count + fall_count || 1;
    const first_quote = quotes[0];
    const last_quote = quotes[quotes.length - 1];
    const quote_change_pct = first_quote ? ((last_quote - first_quote) / first_quote) * 100 : 0;

    const window_counts = WINDOW_SIZES.filter(size => quotes.length >= size).map(size => ({
        label: `Last ${Math.min(size, quotes.length)}`,
        size,
        counts: countDigits(quotes.slice(-size), pip_size),
    }));
    window_counts.push({ label: `Last ${quotes.length}`, size: quotes.length, counts: digit_counts });

    const ticks_since_last_seen = new Array(10).fill(-1).map((_, d) => {
        for (let i = digits.length - 1; i >= 0; i--) {
            if (digits[i] === d) return digits.length - 1 - i;
        }
        return -1;
    });

    const even_pct = Number(((even_count / total) * 100).toFixed(1));
    const over_pct = Number(((over_count / total) * 100).toFixed(1));
    const under_pct = Number(((under_count / total) * 100).toFixed(1));

    return {
        digit_counts,
        window_counts,
        ticks_since_last_seen,
        most_idx,
        second_idx,
        least_idx,
        even_pct,
        odd_pct: Number((100 - even_pct).toFixed(1)),
        over_pct,
        under_pct,
        equal_pct: Number((100 - over_pct - under_pct).toFixed(1)),
        streak_count,
        streak_direction,
        recent_digits: digits.slice(-15),
        recent_digits_100: digits.slice(-100),
        recent_quotes: quotes.slice(-100),
        digits,
        current_quote: last_quote ?? null,
        quote_change_pct,
        rise_pct: Number(((rise_count / move_total) * 100).toFixed(1)),
        fall_pct: Number(((fall_count / move_total) * 100).toFixed(1)),
        is_loading: false,
        is_stale: false,
    };
};

export const useDigitStats = (symbol: string, tick_count: number, over_under_digit: number) => {
    const [stats, setStats] = useState<TDigitStats>(EMPTY_STATS);
    const quotesRef = useRef<number[]>([]);
    const pipSizeRef = useRef<number>(2);
    const subscriptionIdRef = useRef<string | null>(null);
    const overUnderDigitRef = useRef<number>(over_under_digit);
    const lastTickAtRef = useRef<number>(0);
    const lastEpochRef = useRef<number | null>(null);

    useEffect(() => {
        overUnderDigitRef.current = over_under_digit;
    }, [over_under_digit]);

    useEffect(() => {
        let is_cancelled = false;
        let message_subscription: { unsubscribe: () => void } | null = null;
        let watchdog: ReturnType<typeof setInterval> | null = null;
        let resubscribing = false;

        const subscribeToTicks = async (): Promise<boolean> => {
            if (resubscribing) return false; // avoid overlapping attempts from watchdog + retries
            resubscribing = true;
            try {
                // Clear out any subscription THIS hook previously held for this
                // symbol before asking for a fresh one.
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
                            // Deriv's forget_all only accepts a subscription
                            // TYPE ('ticks'), not a symbol filter — it will
                            // clear every tick subscription on this connection,
                            // not just this one. Only reach for it on the
                            // final attempt, after a plain short-delay retry
                            // (which resolves it if the stale subscription was
                            // just about to be cleaned up naturally) has
                            // already failed twice.
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
            setStats(prev => ({ ...prev, is_loading: true }));
            lastEpochRef.current = null;

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
                setStats(computeStats(prices, pip_size, overUnderDigitRef.current));

                // Symbol match is normalized (trim + uppercase) defensively —
                // if Deriv ever pushes a tick whose symbol string differs in
                // case/whitespace from what we requested, a strict `===`
                // comparison would silently drop every live tick for that
                // symbol while the initial history fetch (which doesn't
                // depend on this comparison) still succeeds. That exact
                // pattern — historical loads fine, live never updates — is
                // what a silent mismatch here would look like.
                const normalize = (s: string) => (s || '').trim().toUpperCase();
                const target_symbol = normalize(symbol);

                message_subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                    if (data?.msg_type === 'tick' && normalize(data?.tick?.symbol) === target_symbol) {
                        // Guards against the brief window (on resubscribe, when
                        // symbol/tick_count changes) where the old subscription's
                        // `forget` is still in flight and a new one is already
                        // live — Deriv then delivers the same tick twice, which
                        // otherwise shows up as every digit doubled in a row.
                        const epoch = Number(data.tick.epoch);
                        if (epoch && epoch === lastEpochRef.current) return;
                        lastEpochRef.current = epoch || null;

                        if (data.tick.id) subscriptionIdRef.current = data.tick.id;
                        lastTickAtRef.current = Date.now();
                        quotesRef.current = [...quotesRef.current, Number(data.tick.quote)].slice(-tick_count);
                        setStats(prev => ({
                            ...computeStats(quotesRef.current, pipSizeRef.current, overUnderDigitRef.current),
                            is_loading: false,
                            is_stale: false,
                        }));
                    }
                });

                await subscribeToTicks();
                setStats(prev => ({ ...prev, is_loading: false }));

                // Watchdog: volatility indices tick roughly every 1-2 seconds
                // (1s indices even faster). If nothing has arrived for 6s
                // after we believe we're subscribed, the feed has silently
                // stalled — force a clean resubscribe rather than sitting
                // frozen while still displaying "LIVE".
                watchdog = setInterval(() => {
                    if (is_cancelled) return;
                    const silent_for = Date.now() - lastTickAtRef.current;
                    if (silent_for > 6000) {
                        setStats(prev => ({ ...prev, is_stale: true }));
                        subscribeToTicks();
                    }
                }, 2000);
            } catch (e) {
                if (!is_cancelled) setStats(prev => ({ ...prev, is_loading: false }));
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
    }, [symbol, tick_count]);

    // Recompute derived stats (even/odd, over/under, most/least) without
    // re-subscribing when only the over/under threshold digit changes.
    useEffect(() => {
        if (quotesRef.current.length) {
            setStats(prev => ({ ...computeStats(quotesRef.current, pipSizeRef.current, over_under_digit), is_loading: prev.is_loading }));
        }
    }, [over_under_digit]);

    return stats;
};
