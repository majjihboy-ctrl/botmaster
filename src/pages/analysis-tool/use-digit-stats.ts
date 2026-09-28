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
        // Without this, leaving the tab within the first 5s left the retry timer
        // running and it called setSymbols on an unmounted component.
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const tryLoad = () => {
            if (cancelled) return;
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
            if (attempts < 10) timer = setTimeout(tryLoad, 500);
        };
        tryLoad();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
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
    second_least_idx: number;
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
    current_quote_text: string; // full price at the symbol's real decimal precision, e.g. "6073.569"
    current_digit: number | null;
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
    second_least_idx: 0,
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
    current_quote_text: '',
    current_digit: null,
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
// Known decimal places for Deriv synthetic indices.
// Authoritative for display — API sometimes sends pip AMOUNT (0.01) which we must not
// feed into toFixed() or the price collapses to 0–1 decimals.
const KNOWN_PIP_DECIMALS: Record<string, number> = {
    R_10: 3,
    R_25: 3,
    R_50: 2,
    R_75: 2,
    R_100: 2,
    '1HZ10V': 2,
    '1HZ25V': 2,
    '1HZ50V': 2,
    '1HZ75V': 2,
    '1HZ100V': 2,
    JD10: 2,
    JD25: 2,
    JD50: 2,
    JD75: 2,
    JD100: 2,
};

/**
 * Normalize a value that might be either:
 *  - decimal-place count (2, 3)  OR
 *  - pip amount (0.01, 0.001, 0.1)
 * into a decimal-place count suitable for Number.toFixed().
 */
const normalizePipDecimals = (value: unknown): number | null => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    // Integer 1–8 → already a decimal-place count
    if (Number.isInteger(n) && n >= 1 && n <= 8) return n;
    // Fractional → pip amount (0.01 → 2, 0.001 → 3, 0.1 → 1)
    if (n > 0 && n < 1) {
        try {
            const exp = Math.abs(Number(n.toExponential().substring(3)));
            if (Number.isFinite(exp) && exp >= 0 && exp <= 8) return exp;
        } catch {
            // fall through
        }
    }
    // 0 is useless for display
    return null;
};

/**
 * Infer decimal places from price samples.
 * Take the MAX across samples — JSON numbers drop trailing zeros.
 */
const inferPipSize = (raw_prices: (string | number)[]): number | null => {
    let max_decimals = 0;
    let found = false;
    for (const p of raw_prices) {
        const s = String(p);
        const dot = s.indexOf('.');
        if (dot !== -1) {
            found = true;
            max_decimals = Math.max(max_decimals, s.length - dot - 1);
        }
    }
    return found ? max_decimals : null;
};

/**
 * Resolve decimal places for a symbol.
 * Priority: known synthetics → api map → active_symbols → history field → infer → 2
 */
const resolvePipSize = (
    symbol: string,
    raw_prices: (string | number)[] = [],
    history_pip?: unknown
): number => {
    // 1) Hardcoded table first for volatilities — never show 1 decimal on R_100 etc.
    if (KNOWN_PIP_DECIMALS[symbol] != null) return KNOWN_PIP_DECIMALS[symbol];

    // 2) api_base.pip_sizes (processor already converts pip→decimals, but normalize anyway)
    const from_map = normalizePipDecimals(api_base?.pip_sizes?.[symbol]);
    if (from_map != null) return from_map;

    // 3) active_symbols list
    const list = api_base?.active_symbols;
    if (Array.isArray(list)) {
        const row = list.find((s: any) => s.symbol === symbol || s.underlying_symbol === symbol);
        const from_row = normalizePipDecimals(row?.pip_size ?? row?.pip);
        if (from_row != null) return from_row;
    }

    // 4) ticks_history.pip_size (may be count OR pip amount)
    const from_hist = normalizePipDecimals(history_pip);
    if (from_hist != null) return from_hist;

    // 5) Infer from samples
    const inferred = inferPipSize(raw_prices);
    if (inferred != null && inferred >= 1) return inferred;

    return 2;
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
    const second_least_idx = ranked[ranked.length - 2]?.i ?? 0;

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
        second_least_idx,
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
        // toFixed(pip_size) keeps trailing zeros (6073.500, not 6073.5) so the last
        // digit shown is the same digit the distribution counts.
        current_quote_text: last_quote !== undefined ? last_quote.toFixed(pip_size) : '',
        current_digit: digits.length ? digits[digits.length - 1] : null,
        quote_change_pct,
        rise_pct: Number(((rise_count / move_total) * 100).toFixed(1)),
        fall_pct: Number(((fall_count / move_total) * 100).toFixed(1)),
        is_loading: false,
        is_stale: false,
    };
};

/**
 * Wait until api_base.api is usable.
 * Resolves as soon as the API object exists — CONNECTING (0) or OPEN (1) is fine;
 * the caller retries on send failure. Keeps initial load fast.
 */
const waitForApi = async (isCancelled: () => boolean, maxMs = 6000): Promise<boolean> => {
    const start = Date.now();
    // Fast path: already ready
    const api0 = api_base?.api;
    if (api0 && typeof api0.send === 'function') {
        const rs = api0.connection?.readyState;
        if (rs === undefined || rs === 0 || rs === 1) return true;
    }
    while (!isCancelled() && Date.now() - start < maxMs) {
        const api = api_base?.api;
        if (api && typeof api.send === 'function') {
            const rs = api.connection?.readyState;
            // OPEN or CONNECTING (or no connection object yet) — proceed
            if (rs === undefined || rs === 0 || rs === 1) return true;
        }
        await new Promise(r => setTimeout(r, 80));
    }
    return !!(api_base?.api && typeof api_base.api.send === 'function');
};

export const useDigitStats = (symbol: string, tick_count: number, over_under_digit: number) => {
    const [stats, setStats] = useState<TDigitStats>(EMPTY_STATS);
    const quotesRef = useRef<number[]>([]);
    const pipSizeRef = useRef<number>(2);
    const subscriptionIdRef = useRef<string | null>(null);
    const overUnderDigitRef = useRef<number>(over_under_digit);
    const lastTickAtRef = useRef<number>(0);
    const lastEpochRef = useRef<number | null>(null);
    // Generation counter so stale async recoveries from a previous effect
    // cannot overwrite a newer subscription after symbol/tick_count change.
    const generationRef = useRef(0);

    useEffect(() => {
        overUnderDigitRef.current = over_under_digit;
    }, [over_under_digit]);

    useEffect(() => {
        let is_cancelled = false;
        let message_subscription: { unsubscribe: () => void } | null = null;
        let watchdog: ReturnType<typeof setInterval> | null = null;
        let resubscribing = false;
        const generation = ++generationRef.current;

        const isActive = () => !is_cancelled && generationRef.current === generation;

        const forgetCurrent = async () => {
            if (subscriptionIdRef.current && api_base?.api) {
                try {
                    await api_base.api.send({ forget: subscriptionIdRef.current });
                } catch {
                    // ignore
                }
                subscriptionIdRef.current = null;
            }
        };

        const attachMessageListener = () => {
            message_subscription?.unsubscribe();
            message_subscription = null;
            if (!api_base?.api?.onMessage) return;

            const normalize = (s: string) => (s || '').trim().toUpperCase();
            const target_symbol = normalize(symbol);

            message_subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                if (!isActive()) return;
                if (data?.msg_type === 'tick' && normalize(data?.tick?.symbol) === target_symbol) {
                    // Guards against the brief window (on resubscribe, when
                    // symbol/tick_count changes) where the old subscription's
                    // `forget` is still in flight and a new one is already
                    // live — Deriv then delivers the same tick twice.
                    const epoch = Number(data.tick.epoch);
                    if (epoch && epoch === lastEpochRef.current) return;
                    lastEpochRef.current = epoch || null;

                    if (data.tick.id) subscriptionIdRef.current = data.tick.id;
                    lastTickAtRef.current = Date.now();
                    // tick.pip_size is often a pip AMOUNT (0.01), not decimal count — normalize
                    const tick_pip = normalizePipDecimals(data.tick?.pip_size);
                    if (tick_pip != null) {
                        pipSizeRef.current = tick_pip;
                    } else if (KNOWN_PIP_DECIMALS[symbol] != null) {
                        pipSizeRef.current = KNOWN_PIP_DECIMALS[symbol];
                    }
                    quotesRef.current = [...quotesRef.current, Number(data.tick.quote)].slice(-tick_count);
                    setStats(prev => ({
                        ...computeStats(quotesRef.current, pipSizeRef.current, overUnderDigitRef.current),
                        is_loading: false,
                        is_stale: false,
                    }));
                }
            });
        };

        const subscribeToTicks = async (): Promise<boolean> => {
            if (resubscribing || !isActive()) return false;
            resubscribing = true;
            try {
                if (!(await waitForApi(() => !isActive()))) return false;

                await forgetCurrent();

                for (let attempt = 0; attempt < 4; attempt++) {
                    if (!isActive()) return false;
                    try {
                        const sub_res = await api_base.api.send({ ticks: symbol, subscribe: 1 });
                        if (sub_res?.error) throw sub_res.error;
                        if (sub_res?.subscription?.id) subscriptionIdRef.current = sub_res.subscription.id;
                        lastTickAtRef.current = Date.now();
                        return true;
                    } catch (sub_error: any) {
                        const code = sub_error?.error?.code || sub_error?.code;
                        if (code === 'AlreadySubscribed') {
                            // forget_all('ticks') clears every tick sub on this
                            // connection — only use it as last resort.
                            if (attempt >= 2) {
                                await api_base.api.send({ forget_all: 'ticks' }).catch(() => {});
                            }
                            await new Promise(r => setTimeout(r, 200 + attempt * 150));
                            continue;
                        }
                        // RateLimit / disconnected — back off and retry
                        await new Promise(r => setTimeout(r, 300 + attempt * 250));
                    }
                }
                return false;
            } finally {
                resubscribing = false;
            }
        };

        const loadHistory = async (): Promise<boolean> => {
            if (!isActive()) return false;
            if (!(await waitForApi(() => !isActive()))) return false;

            try {
                const history_res = await api_base.api.send({
                    ticks_history: symbol,
                    count: Math.min(tick_count, 5000),
                    end: 'latest',
                    style: 'ticks',
                });
                if (!isActive()) return false;

                const raw_prices: (string | number)[] = history_res?.history?.prices ?? [];
                if (!raw_prices.length) return false;

                // Resolve decimals robustly (known table / api / history pip amount|count)
                const pip_size = resolvePipSize(symbol, raw_prices, history_res?.pip_size);
                pipSizeRef.current = pip_size;

                const prices: number[] = raw_prices.map(Number);
                quotesRef.current = prices;
                setStats({
                    ...computeStats(prices, pip_size, overUnderDigitRef.current),
                    is_loading: false,
                    is_stale: false,
                });
                lastTickAtRef.current = Date.now();
                return true;
            } catch {
                return false;
            }
        };

        /**
         * Full recovery: re-attach message listener, optionally refresh history
         * if the buffer is empty/stale, and re-subscribe to live ticks.
         * Safe to call repeatedly from the watchdog.
         */
        const fullRecover = async (refreshHistory: boolean) => {
            if (!isActive() || resubscribing) return;
            setStats(prev => ({ ...prev, is_stale: true }));

            attachMessageListener();

            if (refreshHistory || quotesRef.current.length < 10) {
                await loadHistory();
            }

            const ok = await subscribeToTicks();
            if (ok && isActive()) {
                setStats(prev => ({ ...prev, is_loading: false, is_stale: false }));
            }
        };

        const start = async () => {
            setStats(prev => ({ ...prev, is_loading: true, is_stale: false }));
            lastEpochRef.current = null;
            quotesRef.current = [];

            // Hard cap: never leave the UI on CONNECTING forever
            const loadingCap = setTimeout(() => {
                if (isActive()) {
                    setStats(prev => ({ ...prev, is_loading: false, is_stale: true }));
                }
            }, 8000);

            try {
                // Brief wait for the shared Deriv socket (fast path if already open).
                const ready = await waitForApi(() => !isActive(), 4000);
                if (!isActive()) return;

                if (!ready) {
                    // Socket still not ready — mark stale and let the watchdog retry.
                    setStats(prev => ({ ...prev, is_loading: false, is_stale: true }));
                } else {
                    attachMessageListener();
                    // History first so the UI fills quickly; subscribe can follow.
                    const gotHistory = await loadHistory();
                    if (!isActive()) return;
                    // Don't block UI on subscribe — fire and let watchdog recover if needed
                    subscribeToTicks().then(ok => {
                        if (ok && isActive()) {
                            setStats(prev => ({ ...prev, is_loading: false, is_stale: false }));
                        }
                    });
                    // Clear loading as soon as history is in (or even if not — watchdog retries)
                    if (isActive()) {
                        setStats(prev => ({
                            ...prev,
                            is_loading: false,
                            is_stale: !gotHistory,
                        }));
                    }
                }
            } finally {
                clearTimeout(loadingCap);
            }

            // Watchdog runs forever while this effect is alive.
            // - 6s silence  → soft resubscribe (ticks only)
            // - 15s silence → full recovery (history + listener + ticks)
            // - Also re-checks socket readyState so a dead connection is recovered
            //   even if lastTickAt was recently updated before the drop.
            watchdog = setInterval(() => {
                if (!isActive()) return;
                const silent_for = Date.now() - lastTickAtRef.current;
                const rs = api_base?.api?.connection?.readyState;
                const socket_dead = rs !== undefined && rs !== 1;

                if (socket_dead || silent_for > 15000) {
                    fullRecover(true);
                } else if (silent_for > 6000) {
                    setStats(prev => ({ ...prev, is_stale: true }));
                    // Soft path: just re-subscribe ticks + re-attach listener
                    attachMessageListener();
                    subscribeToTicks();
                }
            }, 2500);
        };

        start();

        // When the browser tab becomes visible again, force a recovery —
        // mobile browsers often suspend WebSockets in the background.
        const onVisibility = () => {
            if (document.visibilityState === 'visible' && isActive()) {
                const silent_for = Date.now() - lastTickAtRef.current;
                if (silent_for > 4000) fullRecover(true);
            }
        };
        const onOnline = () => {
            if (isActive()) fullRecover(true);
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('online', onOnline);

        return () => {
            is_cancelled = true;
            message_subscription?.unsubscribe();
            if (watchdog) clearInterval(watchdog);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('online', onOnline);
            forgetCurrent();
        };
    }, [symbol, tick_count]);

    // Recompute derived stats (even/odd, over/under, most/least) without
    // re-subscribing when only the over/under threshold digit changes.
    useEffect(() => {
        if (quotesRef.current.length) {
            setStats(prev => ({
                ...computeStats(quotesRef.current, pipSizeRef.current, over_under_digit),
                is_loading: prev.is_loading,
                is_stale: prev.is_stale,
            }));
        }
    }, [over_under_digit]);

    return stats;
};
