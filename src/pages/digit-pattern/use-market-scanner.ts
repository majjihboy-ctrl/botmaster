import { useEffect, useSyncExternalStore } from 'react';
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

/** Feeds a run of past digits through the exact same streak logic used for
 * live ticks, so the very last few digits leave the state exactly as if
 * they'd just arrived live. Called once during historical seeding. */
const applyDigitSequence = (st: TSymbolState, digits: number[], mode: TScanMode, threshold_digit: number) => {
    digits.forEach(digit => {
        const prev = st.last_digit;
        st.last_digit = digit;
        if (prev === null) return;
        const run = st.runs.get(prev);
        if (!run) return;
        const direction = classify(digit, mode, threshold_digit);
        if (direction === null) return;
        if (direction === run.direction) {
            run.count += 1;
        } else {
            run.direction = direction;
            run.count = 1;
        }
    });
};

// ---------------------------------------------------------------------------
// Module-level singleton. Lives for the lifetime of the page, independent of
// whether any component displaying it happens to be mounted right now - so
// switching tabs away from Digit Pattern and back doesn't reset the scan or
// re-fetch anything; it just re-subscribes to whatever's already running.
// ---------------------------------------------------------------------------
type TScannerSingleton = {
    entries: TScanEntry[];
    is_loading: boolean;
    connected_count: number;
    total_count: number;
    listeners: Set<() => void>;
    stateRef: Map<string, TSymbolState>;
    symbolMapRef: Map<string, string>;
    modeRef: TScanMode;
    thresholdRef: number;
    message_subscription: { unsubscribe: () => void } | null;
    subscription_ids: string[];
    current_key: string | null; // symbol set signature
    current_config_key: string | null; // symbol set + mode + threshold signature
    generation: number; // bumped on every (re)start so stale async work can detect it's obsolete
};

const singleton: TScannerSingleton = {
    entries: [],
    is_loading: true,
    connected_count: 0,
    total_count: 0,
    listeners: new Set(),
    stateRef: new Map(),
    symbolMapRef: new Map(),
    modeRef: 'evenodd',
    thresholdRef: 5,
    message_subscription: null,
    subscription_ids: [],
    current_key: null,
    current_config_key: null,
    generation: 0,
};

const notify = () => singleton.listeners.forEach(l => l());

const publish = () => {
    const out: TScanEntry[] = [];
    singleton.stateRef.forEach((st, symbol) => {
        st.runs.forEach((run, digit) => {
            if (run.direction && run.count > 0) {
                out.push({
                    symbol,
                    display_name: singleton.symbolMapRef.get(symbol) ?? symbol,
                    digit,
                    direction: run.direction,
                    count: run.count,
                });
            }
        });
    });
    out.sort((a, b) => b.count - a.count);
    singleton.entries = out;
    notify();
};

const HISTORY_COUNT = 120; // enough to reveal any streak already in progress without being a heavy request

const teardown = () => {
    singleton.message_subscription?.unsubscribe();
    singleton.message_subscription = null;
    singleton.subscription_ids.forEach(id => {
        api_base.api.send({ forget: id }).catch(() => {});
    });
    singleton.subscription_ids = [];
};

const ensureScannerRunning = (symbols: TSymbolOption[], mode: TScanMode, threshold_digit: number) => {
    const symbol_key = symbols
        .map(s => s.symbol)
        .sort()
        .join(',');
    const config_key = `${symbol_key}|${mode}|${threshold_digit}`;

    if (singleton.current_config_key === config_key) return; // nothing changed at all

    if (singleton.current_key === symbol_key) {
        // Same markets, just a different mode/threshold: don't tear down
        // subscriptions or re-fetch history, just reset the runs - a run
        // built under 'over/under 5' doesn't magically become an even/odd
        // run if you flip modes mid-stream. The two modes are different
        // questions about the same ticks.
        singleton.modeRef = mode;
        singleton.thresholdRef = threshold_digit;
        singleton.current_config_key = config_key;
        singleton.stateRef.forEach(st => {
            st.runs = new Map(Array.from({ length: 10 }, (_, d) => [d, { direction: null, count: 0 }]));
        });
        publish();
        return;
    }

    // Different set of markets entirely — full restart.
    teardown();
    singleton.generation += 1;
    const my_generation = singleton.generation;
    singleton.current_key = symbol_key;
    singleton.current_config_key = config_key;
    singleton.modeRef = mode;
    singleton.thresholdRef = threshold_digit;

    symbols.forEach(s => singleton.symbolMapRef.set(s.symbol, s.display_name));
    singleton.stateRef = new Map(symbols.map(s => [s.symbol, freshSymbolState()]));
    singleton.is_loading = true;
    singleton.connected_count = 0;
    singleton.total_count = symbols.length;
    publish();

    const normalize = (s: string) => (s || '').trim().toUpperCase();
    const watched_upper = new Map(symbols.map(s => [normalize(s.symbol), s.symbol]));

    singleton.message_subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
        if (singleton.generation !== my_generation) return; // stale listener from a torn-down scan
        if (data?.msg_type !== 'tick') return;
        const raw_symbol = data?.tick?.symbol;
        if (!raw_symbol) return;
        const symbol = watched_upper.get(normalize(raw_symbol));
        if (!symbol) return;

        const pip_size = api_base?.pip_sizes?.[symbol] ?? String(data.tick.quote).split('.')[1]?.length ?? 2;
        const digit = Number(getLastDigitForList(Number(data.tick.quote), pip_size));

        const st = singleton.stateRef.get(symbol);
        if (!st) return;

        const prev = st.last_digit;
        st.last_digit = digit;
        if (prev === null) return;

        const run = st.runs.get(prev);
        if (!run) return;

        const direction = classify(digit, singleton.modeRef, singleton.thresholdRef);
        if (direction === null) return;

        if (direction === run.direction) {
            run.count += 1;
        } else {
            run.direction = direction;
            run.count = 1;
        }
        publish();
    });

    (async () => {
        let connected = 0;
        await Promise.all(
            symbols.map(async s => {
                if (singleton.generation !== my_generation) return;
                try {
                    // Seed with recent history first, so a streak that's
                    // already 7 deep shows up immediately instead of taking
                    // the next 7+ live ticks to rebuild the same picture.
                    const hist = await api_base.api.send({
                        ticks_history: s.symbol,
                        count: HISTORY_COUNT,
                        end: 'latest',
                        style: 'ticks',
                    });
                    if (singleton.generation !== my_generation) return;
                    const prices: number[] = hist?.history?.prices ?? [];
                    const pip_size = hist?.pip_size ?? api_base?.pip_sizes?.[s.symbol] ?? 2;
                    const digits = prices.map(p => Number(getLastDigitForList(Number(p), pip_size)));
                    const st = singleton.stateRef.get(s.symbol);
                    if (st) applyDigitSequence(st, digits, singleton.modeRef, singleton.thresholdRef);

                    const res = await api_base.api.send({ ticks: s.symbol, subscribe: 1 });
                    if (singleton.generation !== my_generation) return;
                    if (res?.subscription?.id) singleton.subscription_ids.push(res.subscription.id);
                    connected += 1;
                    singleton.connected_count = connected;
                    publish();
                } catch {
                    // individual symbol failure (history or subscribe) — others keep scanning
                }
            })
        );
        if (singleton.generation === my_generation) {
            singleton.is_loading = false;
            publish();
        }
    })();
};

const getSnapshot = () => ({
    entries: singleton.entries,
    is_loading: singleton.is_loading,
    connected_count: singleton.connected_count,
    total_count: singleton.total_count,
});

let cached_snapshot = getSnapshot();
const subscribe = (onStoreChange: () => void) => {
    const listener = () => {
        cached_snapshot = getSnapshot();
        onStoreChange();
    };
    singleton.listeners.add(listener);
    return () => {
        singleton.listeners.delete(listener);
        // Deliberately no teardown here — the scan keeps running in the
        // background so switching tabs away and back never loses progress.
    };
};

/**
 * Subscribes to live ticks for every symbol given and incrementally tracks,
 * for every reference digit 0-9 on every market, the run of consecutive
 * same-direction outcomes right after that digit appears — exactly the
 * Signals streak mechanic, fanned out across every market at once.
 *
 * The underlying scan lives in a module-level singleton, not component
 * state: navigating away from the tab and back re-subscribes to the same
 * still-running scan instead of restarting it from scratch.
 */
export const useMarketScanner = (
    symbols: TSymbolOption[],
    mode: TScanMode,
    threshold_digit: number,
    disabled = false
) => {
    const symbols_key = symbols.map(s => s.symbol).join(',');

    useEffect(() => {
        if (disabled || symbols.length === 0) return;
        ensureScannerRunning(symbols, mode, threshold_digit);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbols_key, mode, threshold_digit, disabled]);

    const snapshot = useSyncExternalStore(subscribe, () => cached_snapshot);
    return { ...snapshot, total_count: symbols.length };
};
