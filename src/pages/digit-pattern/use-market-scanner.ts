import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import { TSymbolOption } from '@/pages/analysis-tool/use-digit-stats';

export type TScanMode = 'evenodd' | 'overunder';
export type TScanDirection = 'even' | 'odd' | 'over' | 'under';

export type TScanEntry = {
    symbol: string;
    display_name: string;
    digit: number;
    direction: TScanDirection;
    count: number;
};

type TDigitRun = { direction: TScanDirection | null; count: number };
type TSymbolState = {
    last_digit: number | null;
    runs: Map<number, TDigitRun>; // per reference-digit run, 0-9
};

const classify = (digit: number, mode: TScanMode, threshold_digit: number): TScanDirection | null => {
    if (mode === 'evenodd') return digit % 2 === 0 ? 'even' : 'odd';
    if (digit > threshold_digit) return 'over';
    if (digit < threshold_digit) return 'under';
    return null; // exactly equal to threshold — ignored entirely
};

const freshSymbolState = (): TSymbolState => {
    const runs = new Map<number, TDigitRun>();
    for (let d = 0; d <= 9; d++) runs.set(d, { direction: null, count: 0 });
    return { last_digit: null, runs };
};

/**
 * Subscribes to live ticks for every symbol given and incrementally tracks,
 * for every reference digit 0-9 on every market, the run of consecutive
 * same-direction outcomes right after that digit appears — exactly the
 * Signals streak mechanic, just fanned out across every market at once
 * instead of one at a time, and updated per-tick (O(1)) rather than
 * recomputed from the full tick history on every update.
 */
export const useMarketScanner = (
    symbols: TSymbolOption[],
    mode: TScanMode,
    threshold_digit: number,
    disabled = false
) => {
    const [entries, setEntries] = useState<TScanEntry[]>([]);
    const [is_loading, setIsLoading] = useState(true);
    const [connected_count, setConnectedCount] = useState(0);

    const stateRef = useRef<Map<string, TSymbolState>>(new Map());
    const modeRef = useRef(mode);
    const thresholdRef = useRef(threshold_digit);
    const symbolMapRef = useRef<Map<string, string>>(new Map()); // symbol -> display_name

    useEffect(() => {
        modeRef.current = mode;
    }, [mode]);
    useEffect(() => {
        thresholdRef.current = threshold_digit;
    }, [threshold_digit]);

    const publish = () => {
        const out: TScanEntry[] = [];
        stateRef.current.forEach((st, symbol) => {
            st.runs.forEach((run, digit) => {
                if (run.direction && run.count > 0) {
                    out.push({
                        symbol,
                        display_name: symbolMapRef.current.get(symbol) ?? symbol,
                        digit,
                        direction: run.direction,
                        count: run.count,
                    });
                }
            });
        });
        out.sort((a, b) => b.count - a.count);
        setEntries(out);
    };

    useEffect(() => {
        if (disabled || symbols.length === 0) {
            setIsLoading(false);
            return;
        }

        let is_cancelled = false;
        let message_subscription: { unsubscribe: () => void } | null = null;
        const subscription_ids: string[] = [];
        let connected = 0;

        symbols.forEach(s => symbolMapRef.current.set(s.symbol, s.display_name));
        stateRef.current = new Map(symbols.map(s => [s.symbol, freshSymbolState()]));

        setIsLoading(true);
        setConnectedCount(0);

        const normalize = (s: string) => (s || '').trim().toUpperCase();
        const watched_upper = new Map(symbols.map(s => [normalize(s.symbol), s.symbol]));

        message_subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
            if (data?.msg_type !== 'tick') return;
            const raw_symbol = data?.tick?.symbol;
            if (!raw_symbol) return;
            const symbol = watched_upper.get(normalize(raw_symbol));
            if (!symbol) return;

            const pip_size = api_base?.pip_sizes?.[symbol] ?? String(data.tick.quote).split('.')[1]?.length ?? 2;
            const digit = Number(getLastDigitForList(Number(data.tick.quote), pip_size));

            const st = stateRef.current.get(symbol);
            if (!st) return;

            const prev = st.last_digit;
            st.last_digit = digit;
            if (prev === null) return;

            // Every digit 0-9 potentially just became a trigger (if `prev`
            // equals it) — but only `prev` itself did. Update just that run.
            const run = st.runs.get(prev);
            if (!run) return;

            const direction = classify(digit, modeRef.current, thresholdRef.current);
            if (direction === null) return; // tied the threshold — ignored, doesn't touch the run

            if (direction === run.direction) {
                run.count += 1;
            } else {
                run.direction = direction;
                run.count = 1;
            }
            publish();
        });

        (async () => {
            await Promise.all(
                symbols.map(async s => {
                    if (is_cancelled) return;
                    try {
                        const res = await api_base.api.send({ ticks: s.symbol, subscribe: 1 });
                        if (is_cancelled) return;
                        if (res?.subscription?.id) subscription_ids.push(res.subscription.id);
                        connected += 1;
                        setConnectedCount(connected);
                    } catch {
                        // individual symbol failure — others keep scanning
                    }
                })
            );
            if (!is_cancelled) setIsLoading(false);
        })();

        return () => {
            is_cancelled = true;
            message_subscription?.unsubscribe();
            subscription_ids.forEach(id => {
                api_base.api.send({ forget: id }).catch(() => {});
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbols.map(s => s.symbol).join(','), disabled]);

    // Re-classify direction rules (mode/threshold) don't retroactively
    // rewrite past runs — a run built under 'over/under 5' doesn't magically
    // become an even/odd run if you flip modes mid-stream. Switching mode
    // effectively starts fresh tracking, which is correct: the two modes
    // are different questions about the same ticks.
    useEffect(() => {
        stateRef.current.forEach(st => {
            st.runs = new Map(Array.from({ length: 10 }, (_, d) => [d, { direction: null, count: 0 }]));
        });
        publish();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, threshold_digit]);

    return { entries, is_loading, connected_count, total_count: symbols.length };
};
