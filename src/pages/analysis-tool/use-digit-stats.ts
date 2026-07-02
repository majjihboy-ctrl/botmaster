import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';

export type TSymbolOption = { symbol: string; display_name: string };

// Fallback used only until the live active_symbols list has loaded.
const FALLBACK_SYMBOLS: TSymbolOption[] = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index' },
    { symbol: 'R_25', display_name: 'Volatility 25 Index' },
    { symbol: 'R_50', display_name: 'Volatility 50 Index' },
    { symbol: 'R_75', display_name: 'Volatility 75 Index' },
    { symbol: 'R_100', display_name: 'Volatility 100 Index' },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ15V', display_name: 'Volatility 15 (1s) Index' },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ30V', display_name: 'Volatility 30 (1s) Index' },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ90V', display_name: 'Volatility 90 (1s) Index' },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index' },
    { symbol: 'RDBEAR', display_name: 'Bear Market Index' },
    { symbol: 'RDBULL', display_name: 'Bull Market Index' },
];

// These must always be present in the dropdown, even if the live
// active_symbols response is missing them for any reason.
const MUST_INCLUDE: TSymbolOption[] = [
    { symbol: '1HZ15V', display_name: 'Volatility 15 (1s) Index' },
    { symbol: '1HZ30V', display_name: 'Volatility 30 (1s) Index' },
    { symbol: '1HZ90V', display_name: 'Volatility 90 (1s) Index' },
];

const withMustInclude = (list: TSymbolOption[]): TSymbolOption[] => {
    const present = new Set(list.map(s => s.symbol));
    const missing = MUST_INCLUDE.filter(s => !present.has(s.symbol));
    return [...list, ...missing];
};

export const useSyntheticSymbols = (): TSymbolOption[] => {
    const [symbols, setSymbols] = useState<TSymbolOption[]>(withMustInclude(FALLBACK_SYMBOLS));

    useEffect(() => {
        let attempts = 0;
        const tryLoad = () => {
            const list = api_base?.active_symbols;
            if (Array.isArray(list) && list.length) {
                const synthetic = list
                    .filter((s: any) => s.market === 'synthetic_index')
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name || s.symbol }));
                if (synthetic.length) {
                    setSymbols(withMustInclude(synthetic));
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
};

const countDigits = (quotes: number[], pip_size: number): number[] => {
    const counts = new Array(10).fill(0);
    quotes.forEach(q => {
        const d = Number(getLastDigitForList(q, pip_size));
        if (d >= 0 && d <= 9) counts[d] += 1;
    });
    return counts;
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
    const equal_count = total - over_count - under_count;

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

    const window_counts = WINDOW_SIZES.filter(size => quotes.length >= 10).map(size => ({
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

    return {
        digit_counts,
        window_counts,
        ticks_since_last_seen,
        most_idx,
        second_idx,
        least_idx,
        even_pct: Number(((even_count / total) * 100).toFixed(1)),
        odd_pct: Number((((total - even_count) / total) * 100).toFixed(1)),
        over_pct: Number(((over_count / total) * 100).toFixed(1)),
        under_pct: Number(((under_count / total) * 100).toFixed(1)),
        equal_pct: Number(((equal_count / total) * 100).toFixed(1)),
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
    };
};

export const useDigitStats = (symbol: string, tick_count: number, over_under_digit: number) => {
    const [stats, setStats] = useState<TDigitStats>(EMPTY_STATS);
    const quotesRef = useRef<number[]>([]);
    const pipSizeRef = useRef<number>(2);
    const subscriptionIdRef = useRef<string | null>(null);
    const overUnderDigitRef = useRef<number>(over_under_digit);

    useEffect(() => {
        overUnderDigitRef.current = over_under_digit;
    }, [over_under_digit]);

    useEffect(() => {
        let is_cancelled = false;
        let message_subscription: { unsubscribe: () => void } | null = null;

        const start = async () => {
            setStats(prev => ({ ...prev, is_loading: true }));

            const pip_size = api_base?.pip_sizes?.[symbol] ?? 2;
            pipSizeRef.current = pip_size;

            try {
                const history_res = await api_base.api.send({
                    ticks_history: symbol,
                    count: Math.min(tick_count, 5000),
                    end: 'latest',
                    style: 'ticks',
                });
                if (is_cancelled) return;

                const prices: number[] = history_res?.history?.prices?.map(Number) ?? [];
                quotesRef.current = prices;
                setStats(computeStats(prices, pip_size, overUnderDigitRef.current));

                message_subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === symbol) {
                        if (data.tick.id) subscriptionIdRef.current = data.tick.id;
                        quotesRef.current = [...quotesRef.current, Number(data.tick.quote)].slice(-tick_count);
                        setStats(computeStats(quotesRef.current, pipSizeRef.current, overUnderDigitRef.current));
                    }
                });

                await api_base.api.send({ ticks: symbol, subscribe: 1 });
            } catch (e) {
                if (!is_cancelled) setStats(prev => ({ ...prev, is_loading: false }));
            }
        };

        start();

        return () => {
            is_cancelled = true;
            message_subscription?.unsubscribe();
            if (subscriptionIdRef.current) {
                api_base.api.send({ forget: subscriptionIdRef.current }).catch(() => {});
                subscriptionIdRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, tick_count]);

    // Recompute derived stats (even/odd, over/under, most/least) without
    // re-subscribing when only the over/under threshold digit changes.
    useEffect(() => {
        if (quotesRef.current.length) {
            setStats(computeStats(quotesRef.current, pipSizeRef.current, over_under_digit));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [over_under_digit]);

    return stats;
};
