import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export type TSpeedTraderLogEntry = {
    id: number;
    time: string;
    text: string;
    kind: 'info' | 'win' | 'loss' | 'warn' | 'error';
};

export type TVirtualProgress = { count: number; target: number };

export type TSpeedTraderState = {
    is_armed: boolean;
    is_loading: boolean;
    total_pnl: number;
    current_stake: number;
    logs: TSpeedTraderLogEntry[];
    stop_reason: 'stop_loss' | 'take_profit' | 'manual' | null;
    // Multi-market additions:
    watching: string[]; // every symbol currently subscribed/scanned
    active_symbol: string | null; // the market currently mid real-trade cycle, or null while scanning
    virtual_progress: Record<string, TVirtualProgress>; // per-symbol loss-count race state
};

export type TSpeedTraderParams = {
    // One entry = classic single-market mode. Several entries = race mode:
    // every symbol is scanned virtually at once, and whichever hits its
    // loss target first takes over as the sole active market until its
    // real-trade recovery streak resolves in a win.
    symbols: string[];
    initial_stake: number;
    martingale_mult: number;
    stop_loss: number;
    take_profit: number;
};

type TSide = 'even' | 'odd';

type TPerSymbolState = {
    side: TSide;
    loss_count: number;
    loss_target: number;
};

const VIRTUAL_LOSS_MIN = 3;
const VIRTUAL_LOSS_MAX = 5;

const EMPTY_STATE: TSpeedTraderState = {
    is_armed: false,
    is_loading: false,
    total_pnl: 0,
    current_stake: 0,
    logs: [],
    stop_reason: null,
    watching: [],
    active_symbol: null,
    virtual_progress: {},
};

let log_id_counter = 0;

const randomTarget = () => Math.floor(Math.random() * (VIRTUAL_LOSS_MAX - VIRTUAL_LOSS_MIN + 1)) + VIRTUAL_LOSS_MIN;

const winsSide = (digit: number, side: TSide) => (side === 'even' ? digit % 2 === 0 : digit % 2 === 1);

// Format the quote with the symbol's pip precision so trailing zeros
// survive (663.10 -> digit 0, NOT 1). String(663.10) drops the zero.
const extractLastDigit = (quote: number, pip_size: number) => Number(quote.toFixed(pip_size).slice(-1));

const freshSymbolState = (): TPerSymbolState => ({ side: 'even', loss_count: 0, loss_target: randomTarget() });

export const useSpeedTrader = (currency: string) => {
    const [state, setState] = useState<TSpeedTraderState>(EMPTY_STATE);

    const paramsRef = useRef<TSpeedTraderParams | null>(null);
    const currencyRef = useRef(currency);
    const totalPnlRef = useRef(0);
    const currentStakeRef = useRef(0);
    const isArmedRef = useRef(false);

    // Multi-market race state.
    const watchedSymbolsRef = useRef<string[]>([]);
    const perSymbolRef = useRef<Map<string, TPerSymbolState>>(new Map());
    const activeSymbolRef = useRef<string | null>(null);

    const pendingRef = useRef(false); // buy sent, awaiting confirmation
    const awaitingResultRef = useRef(false); // buy confirmed, awaiting settling tick
    const reqIdCounterRef = useRef(0);
    const buyPriceRef = useRef(0);
    const payoutRef = useRef(0);
    const payoutWarnedRef = useRef(false);

    const messageSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    const tickSubscriptionIdsRef = useRef<Map<string, string>>(new Map());

    useEffect(() => {
        currencyRef.current = currency;
    }, [currency]);

    const pushLog = useCallback((text: string, kind: TSpeedTraderLogEntry['kind'] = 'info') => {
        log_id_counter += 1;
        const entry: TSpeedTraderLogEntry = { id: log_id_counter, time: new Date().toLocaleTimeString(), text, kind };
        setState(prev => ({ ...prev, logs: [...prev.logs.slice(-199), entry] }));
    }, []);

    // Snapshot every watched symbol's current race progress into state for the UI.
    const publishProgress = useCallback(() => {
        const progress: Record<string, TVirtualProgress> = {};
        perSymbolRef.current.forEach((st, sym) => {
            progress[sym] = { count: st.loss_count, target: st.loss_target };
        });
        setState(prev => ({ ...prev, virtual_progress: progress, active_symbol: activeSymbolRef.current }));
    }, []);

    const placeRealTrade = useCallback(() => {
        const p = paramsRef.current;
        const active_symbol = activeSymbolRef.current;
        if (!p || !active_symbol) return;

        const symbol_state = perSymbolRef.current.get(active_symbol);
        const side: TSide = symbol_state?.side ?? 'even';
        const stake = currentStakeRef.current;
        const rid = ++reqIdCounterRef.current;
        pendingRef.current = true;

        pushLog(`[${active_symbol}] Trade placed — stake $${stake.toFixed(2)}`, 'info');

        api_base.api
            .send({
                buy: '1',
                price: stake,
                req_id: rid,
                parameters: {
                    amount: stake,
                    basis: 'stake',
                    contract_type: side === 'even' ? 'DIGITEVEN' : 'DIGITODD',
                    currency: currencyRef.current || 'USD',
                    duration: 1,
                    duration_unit: 't',
                    underlying_symbol: active_symbol,
                },
            })
            .then((res: any) => {
                if (res?.req_id !== undefined && res.req_id !== rid) return; // stale response, ignore

                if (res?.error) {
                    // A rejected order must not be treated as an outstanding
                    // contract. Drop this market back to virtual scanning
                    // with a fresh target and resume racing all markets.
                    pendingRef.current = false;
                    awaitingResultRef.current = false;
                    pushLog(`[${active_symbol}] Order rejected: ${res.error.message || res.error.code}`, 'error');
                    perSymbolRef.current.set(active_symbol, freshSymbolState());
                    activeSymbolRef.current = null;
                    currentStakeRef.current = p.initial_stake;
                    publishProgress();
                    return;
                }

                const buy = res?.buy;
                if (!buy) {
                    pendingRef.current = false;
                    pushLog('Buy confirmation had no data — treating as not placed.', 'warn');
                    return;
                }

                buyPriceRef.current = typeof buy.buy_price === 'number' ? buy.buy_price : stake;
                const payout = typeof buy.payout === 'number' ? buy.payout : null;
                if (payout === null && !payoutWarnedRef.current) {
                    payoutWarnedRef.current = true;
                    pushLog(
                        'Buy confirmation did not include a payout figure — using a conservative estimate for this trade only.',
                        'warn'
                    );
                }
                payoutRef.current = payout ?? stake * 1.9;
                pendingRef.current = false;
                awaitingResultRef.current = true;
            })
            .catch((e: any) => {
                pendingRef.current = false;
                awaitingResultRef.current = false;
                pushLog(`[${active_symbol}] Buy request failed: ${e?.message || e}`, 'error');
                perSymbolRef.current.set(active_symbol, freshSymbolState());
                activeSymbolRef.current = null;
                currentStakeRef.current = p.initial_stake;
                publishProgress();
            });
    }, [pushLog, publishProgress]);

    const settleRealTrade = useCallback(
        (digit: number) => {
            const p = paramsRef.current;
            const active_symbol = activeSymbolRef.current;
            if (!p || !active_symbol) return;

            const symbol_state = perSymbolRef.current.get(active_symbol) ?? freshSymbolState();
            const won = winsSide(digit, symbol_state.side);
            const pnl_change = won ? payoutRef.current - buyPriceRef.current : -buyPriceRef.current;
            totalPnlRef.current += pnl_change;

            pushLog(
                `[${active_symbol}] ${won ? 'WIN' : 'LOSS'} | $${pnl_change.toFixed(2)} | Total PnL $${totalPnlRef.current.toFixed(2)}`,
                won ? 'win' : 'loss'
            );

            awaitingResultRef.current = false;
            buyPriceRef.current = 0;
            payoutRef.current = 0;

            if (won) {
                currentStakeRef.current = p.initial_stake;
                watchedSymbolsRef.current.forEach(sym => perSymbolRef.current.set(sym, freshSymbolState()));
                activeSymbolRef.current = null;
                pushLog(
                    watchedSymbolsRef.current.length > 1
                        ? `Recovered. Resuming scan across ${watchedSymbolsRef.current.length} markets.`
                        : 'Recovered. Resuming scan.',
                    'info'
                );
            } else {
                symbol_state.side = symbol_state.side === 'even' ? 'odd' : 'even';
                perSymbolRef.current.set(active_symbol, symbol_state);
                currentStakeRef.current = Number((currentStakeRef.current * p.martingale_mult).toFixed(2));
            }

            setState(prev => ({
                ...prev,
                total_pnl: totalPnlRef.current,
                current_stake: currentStakeRef.current,
                active_symbol: activeSymbolRef.current,
            }));
            publishProgress();

            if (totalPnlRef.current <= -p.stop_loss) {
                isArmedRef.current = false;
                pushLog(`Stop loss hit at $${totalPnlRef.current.toFixed(2)}. Stopped.`, 'error');
                setState(prev => ({ ...prev, is_armed: false, stop_reason: 'stop_loss' }));
                return;
            }
            if (totalPnlRef.current >= p.take_profit) {
                isArmedRef.current = false;
                pushLog(`Take profit hit at $${totalPnlRef.current.toFixed(2)}. Stopped.`, 'error');
                setState(prev => ({ ...prev, is_armed: false, stop_reason: 'take_profit' }));
                return;
            }
        },
        [pushLog, publishProgress]
    );

    const handleVirtualTick = useCallback(
        (symbol: string, digit: number) => {
            const st = perSymbolRef.current.get(symbol);
            if (!st) return;

            const won = winsSide(digit, st.side);
            if (won) {
                if (st.loss_count !== 0) {
                    st.loss_count = 0;
                    publishProgress();
                }
                return;
            }
            st.loss_count += 1;

            if (st.loss_count >= st.loss_target) {
                activeSymbolRef.current = symbol;
                pushLog(`[${symbol}] Hit ${st.loss_count} virtual losses — going real.`, 'warn');
                publishProgress();
                placeRealTrade();
            } else {
                publishProgress();
            }
        },
        [publishProgress, pushLog, placeRealTrade]
    );

    const handleTick = useCallback(
        (symbol: string, quote: number, pip_size: number) => {
            if (!isArmedRef.current) return;

            const digit = extractLastDigit(quote, pip_size);
            const active_symbol = activeSymbolRef.current;

            if (active_symbol !== null) {
                if (symbol !== active_symbol) return;

                if (awaitingResultRef.current) {
                    settleRealTrade(digit);
                    return;
                }
                if (pendingRef.current) return;
                placeRealTrade();
                return;
            }

            handleVirtualTick(symbol, digit);
        },
        [handleVirtualTick, placeRealTrade, settleRealTrade]
    );

    const start = useCallback(
        async (params: TSpeedTraderParams) => {
            const symbols = Array.from(new Set(params.symbols)).filter(Boolean);
            if (!symbols.length) return;

            paramsRef.current = params;
            currentStakeRef.current = params.initial_stake;
            totalPnlRef.current = 0;
            pendingRef.current = false;
            awaitingResultRef.current = false;
            payoutWarnedRef.current = false;
            isArmedRef.current = true;

            watchedSymbolsRef.current = symbols;
            perSymbolRef.current = new Map(symbols.map(sym => [sym, freshSymbolState()]));
            activeSymbolRef.current = null;

            setState({
                is_armed: true,
                is_loading: true,
                total_pnl: 0,
                current_stake: params.initial_stake,
                logs: [],
                stop_reason: null,
                watching: symbols,
                active_symbol: null,
                virtual_progress: Object.fromEntries(
                    symbols.map(sym => [sym, { count: 0, target: perSymbolRef.current.get(sym)!.loss_target }])
                ),
            });

            pushLog(symbols.length > 1 ? `Connecting to ${symbols.length} markets…` : `Connecting to ${symbols[0]}…`, 'info');

            messageSubscriptionRef.current = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                if (data?.msg_type === 'buy') return;
                if (data?.msg_type === 'tick' && data?.tick?.symbol && watchedSymbolsRef.current.includes(data.tick.symbol)) {
                    if (data.tick.id) tickSubscriptionIdsRef.current.set(data.tick.symbol, data.tick.id);
                    handleTick(data.tick.symbol, Number(data.tick.quote), Number(data.tick.pip_size ?? 2));
                }
            });

            const results = await Promise.all(
                symbols.map(async sym => {
                    try {
                        const sub_res = await api_base.api.send({ ticks: sym, subscribe: 1 });
                        if (sub_res?.subscription?.id) tickSubscriptionIdsRef.current.set(sym, sub_res.subscription.id);
                        return { sym, ok: true, error: null as any };
                    } catch (e: any) {
                        if (e?.error?.code === 'AlreadySubscribed') return { sym, ok: true, error: null as any };
                        return { sym, ok: false, error: e };
                    }
                })
            );

            const failed = results.filter(r => !r.ok);
            if (failed.length) {
                failed.forEach(f => pushLog(`[${f.sym}] Tick subscription failed: ${f.error?.message || f.error}`, 'error'));
                watchedSymbolsRef.current = watchedSymbolsRef.current.filter(sym => !failed.some(f => f.sym === sym));
                failed.forEach(f => perSymbolRef.current.delete(f.sym));
                setState(prev => ({ ...prev, watching: watchedSymbolsRef.current }));
            }

            if (!watchedSymbolsRef.current.length) {
                isArmedRef.current = false;
                pushLog('All tick subscriptions failed. Stopped.', 'error');
                setState(prev => ({ ...prev, is_armed: false, is_loading: false }));
                return;
            }

            pushLog(
                watchedSymbolsRef.current.length > 1
                    ? `Armed. Scanning ${watchedSymbolsRef.current.length} markets for the first to hit its loss target.`
                    : 'Armed and monitoring.',
                'info'
            );
            setState(prev => ({ ...prev, is_loading: false }));
        },
        [handleTick, pushLog]
    );

    const stop = useCallback(() => {
        isArmedRef.current = false;
        pendingRef.current = false;
        awaitingResultRef.current = false;
        pushLog('Stopped manually.', 'info');
        setState(prev => ({ ...prev, is_armed: false, stop_reason: 'manual' }));
    }, [pushLog]);

    useEffect(() => {
        const tick_subscription_ids = tickSubscriptionIdsRef.current;
        return () => {
            isArmedRef.current = false;
            messageSubscriptionRef.current?.unsubscribe();
            tick_subscription_ids.forEach(id => {
                api_base.api.send({ forget: id }).catch(() => {});
            });
            tick_subscription_ids.clear();
        };
    }, []);

    return { state, start, stop };
};
