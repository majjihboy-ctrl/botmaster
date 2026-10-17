import { useEffect, useReducer, useRef } from 'react';
import type { DerivWS } from '@/pages/forex-trader/deriv-ws/deriv-ws';
import { getLastDigit, pipSizeFromPip } from './lib/digit-stats';

const HISTORY_TICK_COUNT = 1000;
export const RECENT_TICKS_SHOWN = 40;

export interface EpmTick {
    digit: number;
    quote: number;
    epoch: number;
}

export type EpmConnectionStatus = 'connecting' | 'analyzing' | 'error';

export interface EpmTickSnapshot {
    ticks: EpmTick[];
    status: EpmConnectionStatus;
    errorMessage: string | null;
    /** Decimal places for this symbol (e.g. 2 for most Volatility Indices),
     *  so a consumer can format a tick's quote correctly: quote.toFixed(pipSize). */
    pipSize: number;
}

export interface EpmTickStore {
    getSnapshot: () => EpmTickSnapshot;
    /** Registers a listener fired after every update; call it again to unsubscribe. */
    subscribe: (listener: () => void) => () => void;
}

/**
 * Live tick + digit-stats feed for one symbol, built on the same DerivWS
 * connection (@deriv/core's useDerivWS) that Dtrader already uses
 * successfully elsewhere in this app -- not a second, separately-opened
 * WebSocket. There's no "connect" step exposed to the caller: as soon as
 * `ws` is connected and a `symbol` is picked, this fetches history and
 * subscribes automatically, and cleans up its subscription on symbol
 * change / unmount.
 *
 * Unlike a normal hook, this does NOT put ticks in React state, so calling
 * it does not re-render the caller on every tick (a 1s index can tick
 * several times a second; the full Analysis Tool page -- picker row,
 * results table, bot list -- is far too much to re-render that often, which
 * is what made the live digit circles feel laggy/jerky). Instead it returns
 * a small store: components that need to redraw every tick (the digit
 * circles, the "N ticks buffered" line) subscribe to it directly with
 * useEpmTickSnapshot below, so only those small pieces re-render. The page
 * itself only needs occasional, derived facts (are we connected? have we
 * buffered enough ticks yet?), which useEpmTickStatus / useEpmHasBuffered
 * provide without subscribing to every tick.
 */
export function useEpmTickStore(ws: DerivWS | null, isConnected: boolean, symbol: string): EpmTickStore {
    const snapshotRef = useRef<EpmTickSnapshot>({ ticks: [], status: 'connecting', errorMessage: null, pipSize: 2 });
    const listenersRef = useRef<Set<() => void>>(new Set());
    const pipDecimalsRef = useRef<number>(2);

    const notify = () => listenersRef.current.forEach(listener => listener());
    const setSnapshot = (next: EpmTickSnapshot) => {
        snapshotRef.current = next;
        notify();
    };

    useEffect(() => {
        if (!ws || !isConnected || !symbol) return;
        let disposed = false;
        let unsubscribe: (() => void) | null = null;

        setSnapshot({ ticks: [], status: 'connecting', errorMessage: null, pipSize: snapshotRef.current.pipSize });

        async function run() {
            try {
                // Resolve the real pip size for this symbol first so the very
                // first batch of historical ticks gets correct last digits
                // (rather than guessing and re-deriving once the first live
                // tick arrives).
                const symbolsRes = await ws!.send<{ active_symbols?: Array<{ underlying_symbol: string; pip_size: number }> }>({
                    active_symbols: 'full',
                });
                if (disposed) return;
                const match = symbolsRes.active_symbols?.find(s => s.underlying_symbol === symbol);
                if (match) pipDecimalsRef.current = pipSizeFromPip(match.pip_size);
                setSnapshot({ ...snapshotRef.current, pipSize: pipDecimalsRef.current });

                const historyRes = await ws!.send<{ history?: { prices: number[]; times: number[] } }>({
                    ticks_history: symbol,
                    start: 1,
                    count: HISTORY_TICK_COUNT,
                    end: 'latest',
                    style: 'ticks',
                });
                if (disposed) return;

                const prices = historyRes.history?.prices ?? [];
                const times = historyRes.history?.times ?? [];
                const historyTicks: EpmTick[] = prices.map((quote, i) => ({
                    quote,
                    digit: getLastDigit(quote, pipDecimalsRef.current),
                    epoch: times[i] ?? 0,
                }));
                setSnapshot({ ...snapshotRef.current, ticks: historyTicks });

                const sub = await ws!.subscribe({ ticks: symbol }, data => {
                    if (disposed) return;
                    const tick = (data as { tick?: { quote: number; pip_size?: number; epoch: number } }).tick;
                    if (!tick) return;
                    if (tick.pip_size) pipDecimalsRef.current = pipSizeFromPip(tick.pip_size);
                    const digit = getLastDigit(tick.quote, pipDecimalsRef.current);
                    const prevTicks = snapshotRef.current.ticks;
                    const nextTicks = [...prevTicks, { quote: tick.quote, digit, epoch: tick.epoch }];
                    setSnapshot({
                        ticks: nextTicks.length > HISTORY_TICK_COUNT ? nextTicks.slice(-HISTORY_TICK_COUNT) : nextTicks,
                        status: 'analyzing',
                        errorMessage: null,
                        pipSize: pipDecimalsRef.current,
                    });
                });
                if (disposed) {
                    sub.unsubscribe();
                    return;
                }
                unsubscribe = sub.unsubscribe;
                setSnapshot({ ...snapshotRef.current, status: 'analyzing' });
            } catch (err) {
                if (!disposed) {
                    setSnapshot({
                        ...snapshotRef.current,
                        status: 'error',
                        errorMessage: err instanceof Error ? err.message : 'Connection error',
                    });
                }
            }
        }

        run();

        return () => {
            disposed = true;
            if (unsubscribe) unsubscribe();
            if (ws?.isConnected) ws.send({ forget_all: 'ticks' }).catch(() => {});
        };
    }, [ws, isConnected, symbol]);

    // Stable identity across re-renders: a subscriber's `useEffect(() => store.subscribe(...), [store])`
    // should only (re)run when it's really a different store, not on every render of whoever created it.
    const storeRef = useRef<EpmTickStore>();
    if (!storeRef.current) {
        storeRef.current = {
            getSnapshot: () => snapshotRef.current,
            subscribe: listener => {
                listenersRef.current.add(listener);
                return () => listenersRef.current.delete(listener);
            },
        };
    }
    return storeRef.current;
}

/** Re-renders the caller on every tick. Use only in small, isolated components
 *  (the digit circles, a "buffered" line) -- never in a large page. */
export function useEpmTickSnapshot(store: EpmTickStore): EpmTickSnapshot {
    const [, forceRender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => store.subscribe(forceRender), [store]);
    return store.getSnapshot();
}

/** Re-renders the caller only when connection status actually changes
 *  (connecting -> analyzing -> error), not on every tick. Safe to use in a large page. */
export function useEpmTickStatus(store: EpmTickStore): Pick<EpmTickSnapshot, 'status' | 'errorMessage'> {
    const [, forceRender] = useReducer((n: number) => n + 1, 0);
    const lastRef = useRef<{ status: EpmConnectionStatus; errorMessage: string | null } | null>(null);

    useEffect(() => {
        const sync = () => {
            const snap = store.getSnapshot();
            if (!lastRef.current || lastRef.current.status !== snap.status || lastRef.current.errorMessage !== snap.errorMessage) {
                lastRef.current = { status: snap.status, errorMessage: snap.errorMessage };
                forceRender();
            }
        };
        sync();
        return store.subscribe(sync);
    }, [store]);

    const snap = store.getSnapshot();
    return { status: snap.status, errorMessage: snap.errorMessage };
}

/** Re-renders the caller only when the buffered tick count crosses `threshold`
 *  (e.g. enough ticks to enable the Scan button), not on every tick. Safe to use in a large page. */
export function useEpmHasBuffered(store: EpmTickStore, threshold: number): boolean {
    const [, forceRender] = useReducer((n: number) => n + 1, 0);
    const lastRef = useRef(store.getSnapshot().ticks.length >= threshold);

    useEffect(() => {
        const check = () => {
            const now = store.getSnapshot().ticks.length >= threshold;
            if (now !== lastRef.current) {
                lastRef.current = now;
                forceRender();
            }
        };
        check();
        return store.subscribe(check);
    }, [store, threshold]);

    return lastRef.current;
}

/** One-shot historical fetch for the backtester -- reuses the same shared
 *  `ws` connection instead of opening a separate WebSocket. */
export async function fetchBacktestDigits(ws: DerivWS, symbol: string, count: number): Promise<number[]> {
    const symbolsRes = await ws.send<{ active_symbols?: Array<{ underlying_symbol: string; pip_size: number }> }>({
        active_symbols: 'full',
    });
    const match = symbolsRes.active_symbols?.find(s => s.underlying_symbol === symbol);
    const decimals = match ? pipSizeFromPip(match.pip_size) : 2;

    const historyRes = await ws.send<{ history?: { prices: number[] } }>({
        ticks_history: symbol,
        start: 1,
        count,
        end: 'latest',
        style: 'ticks',
    });
    const prices = historyRes.history?.prices ?? [];
    return prices.map(p => getLastDigit(p, decimals));
}
