import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';

export const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

export type TDigitStats = {
    digit_counts: number[]; // index 0-9, count of occurrences in the current window
    most_idx: number;
    second_idx: number;
    least_idx: number;
    even_pct: number;
    odd_pct: number;
    over_pct: number;
    under_pct: number;
    streak_count: number;
    streak_direction: 'rise' | 'fall' | null;
    recent_digits: number[];
    is_loading: boolean;
};

const EMPTY_STATS: TDigitStats = {
    digit_counts: new Array(10).fill(0),
    most_idx: 0,
    second_idx: 0,
    least_idx: 0,
    even_pct: 0,
    odd_pct: 0,
    over_pct: 0,
    under_pct: 0,
    streak_count: 0,
    streak_direction: null,
    recent_digits: [],
    is_loading: true,
};

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

    // Streak: consecutive rises/falls based on raw quote direction
    let streak_count = 0;
    let streak_direction: 'rise' | 'fall' | null = null;
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

    return {
        digit_counts,
        most_idx,
        second_idx,
        least_idx,
        even_pct: Math.round((even_count / total) * 100),
        odd_pct: Math.round(((total - even_count) / total) * 100),
        over_pct: Math.round((over_count / total) * 100),
        under_pct: Math.round(((total - over_count) / total) * 100),
        streak_count,
        streak_direction,
        recent_digits: digits.slice(-15),
        is_loading: false,
    };
};

export const useDigitStats = (symbol: string, tick_count: number, over_under_digit: number) => {
    const [stats, setStats] = useState<TDigitStats>(EMPTY_STATS);
    const quotesRef = useRef<number[]>([]);
    const pipSizeRef = useRef<number>(2);
    const subscriptionIdRef = useRef<string | null>(null);

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
                setStats(computeStats(prices, pip_size, over_under_digit));

                message_subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === symbol) {
                        if (data.tick.id) subscriptionIdRef.current = data.tick.id;
                        quotesRef.current = [...quotesRef.current, Number(data.tick.quote)].slice(-tick_count);
                        setStats(computeStats(quotesRef.current, pipSizeRef.current, over_under_digit));
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
