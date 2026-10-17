import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    buildBuyRequest,
    buildSellRequest,
    errorText,
    mergePosition,
    readMultipliers,
    FALLBACK_MULTIPLIERS,
    toPosition,
    validateTrade,
    type Position,
    type TradeInput,
} from './trade-engine';

/**
 * Talks to the same signed-in Deriv connection the bots and the Chart use (api_base), so it trades the
 * account that is active in the header. Nothing here waits for a previous trade: every click sends its own
 * request at once, which is what makes rapid, non-stop opening possible.
 */

export interface LogEntry {
    id: number;
    at: number;
    kind: 'ok' | 'err' | 'info';
    text: string;
}

const FLUSH_MS = 250;
const KEEP_CLOSED = 40;
const KEEP_LOG = 40;

// deriv-api's send() returns a promise, even though the shared type says void.
const api = (): any => api_base.api as any;

export function useForexLive(isAuthorized: boolean, loginid: string) {
    const [positions, setPositions] = useState<Position[]>([]);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [pending, setPending] = useState(0);

    const book = useRef<Map<number, Position>>(new Map());
    const dirty = useRef(false);
    const logId = useRef(0);
    const authorized = useRef(isAuthorized);
    authorized.current = isAuthorized;

    const note = useCallback((kind: LogEntry['kind'], text: string) => {
        setLog(prev => [{ id: ++logId.current, at: Date.now(), kind, text }, ...prev].slice(0, KEEP_LOG));
    }, []);

    const upsert = useCallback((p: Position) => {
        book.current.set(p.id, mergePosition(book.current.get(p.id), p));
        dirty.current = true;
    }, []);

    // Show updates in batches, so many live trades never make the page stutter.
    useEffect(() => {
        const t = window.setInterval(() => {
            if (!dirty.current) return;
            dirty.current = false;
            const all = [...book.current.values()];
            // forget the oldest closed trades
            const closed = all.filter(p => p.closed).sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
            closed.slice(KEEP_CLOSED).forEach(p => book.current.delete(p.id));
            setPositions([...book.current.values()].sort((a, b) => (b.openedAt ?? b.id) - (a.openedAt ?? a.id)));
        }, FLUSH_MS);
        return () => window.clearInterval(t);
    }, []);

    // A different account has different trades.
    useEffect(() => {
        book.current = new Map();
        dirty.current = true;
    }, [loginid]);

    // Live stream of every open trade on the account, plus the ones that were already open.
    useEffect(() => {
        if (!isAuthorized || !api_base.api) return;
        const sub = api().onMessage().subscribe(({ data }: { data: any }) => {
            if (data?.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
                const p = toPosition(data.proposal_open_contract);
                if (p) upsert(p);
            }
        });
        Promise.resolve(api().send({ portfolio: 1 }))
            .then((res: any) => {
                const rows: any[] = res?.portfolio?.contracts ?? [];
                rows.forEach(r => {
                    const p = toPosition(r);
                    if (p && !book.current.has(p.id)) upsert(p);
                });
            })
            .catch(() => {});
        return () => sub?.unsubscribe?.();
    }, [isAuthorized, loginid, upsert]);

    const openTrade = useCallback(
        async (input: TradeInput): Promise<boolean> => {
            const problem = validateTrade(input);
            if (problem) {
                note('err', problem);
                return false;
            }
            if (!authorized.current || !api_base.api) {
                note('err', 'Not connected to Deriv yet. Please wait a moment.');
                return false;
            }
            setPending(n => n + 1);
            try {
                const res = await api().send(buildBuyRequest(input));
                if (res?.error) throw res;
                const b = res?.buy;
                if (!b?.contract_id) throw new Error('Deriv did not confirm the trade.');
                upsert({
                    id: Number(b.contract_id),
                    symbol: input.symbol,
                    side: input.side,
                    stake: Number(b.buy_price ?? input.stake),
                    multiplier: input.multiplier,
                    profit: 0,
                    entry: null,
                    spot: null,
                    stopLoss: input.stopLoss ?? null,
                    takeProfit: input.takeProfit ?? null,
                    openedAt: Number(b.purchase_time ?? Math.floor(Date.now() / 1000)),
                    currency: input.currency,
                    closed: false,
                    result: null,
                    canClose: true,
                });
                note('ok', `${input.side} ${input.symbol.replace(/^frx/, '')} opened · stake ${input.stake} · x${input.multiplier}`);
                return true;
            } catch (e) {
                note('err', `${input.side} ${input.symbol.replace(/^frx/, '')} not opened: ${errorText(e)}`);
                return false;
            } finally {
                setPending(n => n - 1);
            }
        },
        [note, upsert]
    );

    const closeTrades = useCallback(
        async (list: Position[]): Promise<void> => {
            if (!list.length) {
                note('info', 'Nothing to close.');
                return;
            }
            if (!authorized.current || !api_base.api) {
                note('err', 'Not connected to Deriv yet. Please wait a moment.');
                return;
            }
            // all at once: closing many trades should not take many round trips one after another
            const results = await Promise.allSettled(
                list.map(async p => {
                    const res = await api().send(buildSellRequest(p.id));
                    if (res?.error) throw res;
                    const soldFor = Number(res?.sell?.sold_for);
                    if (Number.isFinite(soldFor)) {
                        upsert({ ...p, closed: true, canClose: false, result: Math.round((soldFor - p.stake) * 100) / 100, profit: Math.round((soldFor - p.stake) * 100) / 100 });
                    }
                    return p;
                })
            );
            const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
            const done = results.length - failed.length;
            if (done) note('ok', `Closed ${done} trade${done === 1 ? '' : 's'}.`);
            failed.forEach(f => note('err', `Could not close a trade: ${errorText(f.reason)}`));
        },
        [note, upsert]
    );

    return { positions, log, pending, openTrade, closeTrades, note };
}

/** Multipliers Deriv allows for a symbol. Always returns something usable. */
export function useMultipliers(symbol: string, isAuthorized: boolean): number[] {
    const [list, setList] = useState<number[]>(FALLBACK_MULTIPLIERS);
    useEffect(() => {
        if (!symbol || !isAuthorized || !api_base.api) return;
        let off = false;
        Promise.resolve(api().send({ contracts_for: symbol }))
            .then((res: any) => {
                if (!off) setList(readMultipliers(res));
            })
            .catch(() => {
                if (!off) setList(FALLBACK_MULTIPLIERS);
            });
        return () => {
            off = true;
        };
    }, [symbol, isAuthorized]);
    return list;
}
