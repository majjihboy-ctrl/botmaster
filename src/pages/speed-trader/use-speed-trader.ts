import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';

export type TSpeedTraderLogEntry = {
    id: number;
    time: string;
    text: string;
    kind: 'win' | 'loss' | 'info' | 'warn' | 'error';
};

export type TSpeedTraderState = {
    is_armed: boolean;
    is_loading: boolean;
    total_pnl: number;
    current_stake: number;
    logs: TSpeedTraderLogEntry[];
    stop_reason: 'stop_loss' | 'take_profit' | 'manual' | null;
};

export type TSpeedTraderParams = {
    symbol: string;
    initial_stake: number;
    martingale_mult: number;
    stop_loss: number;
    take_profit: number;
};

type TSide = 'even' | 'odd';
type TMode = 'virtual' | 'real';

const VIRTUAL_LOSS_MIN = 3;
const VIRTUAL_LOSS_MAX = 5;

const EMPTY_STATE: TSpeedTraderState = {
    is_armed: false,
    is_loading: false,
    total_pnl: 0,
    current_stake: 0,
    logs: [],
    stop_reason: null,
};

let log_id_counter = 0;
const randomTarget = () => Math.floor(Math.random() * (VIRTUAL_LOSS_MAX - VIRTUAL_LOSS_MIN + 1)) + VIRTUAL_LOSS_MIN;
const winsSide = (digit: number, side: TSide) => (side === 'even' ? digit % 2 === 0 : digit % 2 === 1);

export const useSpeedTrader = (currency: string) => {
    const [state, setState] = useState<TSpeedTraderState>(EMPTY_STATE);

    const paramsRef = useRef<TSpeedTraderParams | null>(null);
    const currencyRef = useRef(currency);
    currencyRef.current = currency;

    const totalPnlRef = useRef(0);
    const currentStakeRef = useRef(0);
    const isArmedRef = useRef(false);

    // Internal state machine — deliberately never surfaced in any visible
    // log line or UI text.
    const sideRef = useRef<TSide>('even');
    const modeRef = useRef<TMode>('virtual');
    const virtualLossCountRef = useRef(0);
    const virtualLossTargetRef = useRef(randomTarget());
    const pendingRef = useRef(false); // buy sent, awaiting confirmation
    const awaitingResultRef = useRef(false); // buy confirmed, awaiting settling tick
    const reqIdRef = useRef<number | null>(null);
    const reqIdCounterRef = useRef(0);
    const buyPriceRef = useRef(0);
    const payoutRef = useRef(0);
    const payoutWarnedRef = useRef(false);

    const messageSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    const tickSubscriptionIdRef = useRef<string | null>(null);

    const pushLog = useCallback((text: string, kind: TSpeedTraderLogEntry['kind'] = 'info') => {
        log_id_counter += 1;
        const entry: TSpeedTraderLogEntry = { id: log_id_counter, time: new Date().toLocaleTimeString(), text, kind };
        setState(prev => ({ ...prev, logs: [...prev.logs.slice(-199), entry] }));
    }, []);

    const placeRealTrade = useCallback(() => {
        const p = paramsRef.current;
        if (!p) return;
        const side = sideRef.current;
        const stake = currentStakeRef.current;
        const rid = ++reqIdCounterRef.current;
        pendingRef.current = true;
        reqIdRef.current = rid;

        pushLog(`Trade placed — stake $${stake.toFixed(2)}`, 'info');

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
                    underlying_symbol: p.symbol,
                },
            })
            .then((res: any) => {
                if (res?.req_id !== undefined && res.req_id !== rid) return; // stale response, ignore
                if (res?.error) {
                    // Fix carried over from the earlier Speed Trader fix: a
                    // rejected order must not be treated as an outstanding
                    // contract. Reset back to a clean, non-pending state so
                    // the next tick simply retries rather than settling a
                    // trade that never happened.
                    pendingRef.current = false;
                    awaitingResultRef.current = false;
                    pushLog(`Order rejected: ${res.error.message || res.error.code}`, 'error');
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
                    pushLog('Buy confirmation did not include a payout figure — using a conservative estimate for this trade only.', 'warn');
                }
                payoutRef.current = payout ?? stake * 1.9;
                pendingRef.current = false;
                awaitingResultRef.current = true;
            })
            .catch((e: any) => {
                pendingRef.current = false;
                pushLog(`Buy request failed: ${e?.message || e}`, 'error');
            });
    }, [pushLog]);

    const settleRealTrade = useCallback(
        (digit: number) => {
            const p = paramsRef.current;
            if (!p) return;
            const won = winsSide(digit, sideRef.current);
            const pnl_change = won ? payoutRef.current - buyPriceRef.current : -buyPriceRef.current;
            totalPnlRef.current += pnl_change;

            pushLog(`${won ? 'WIN' : 'LOSS'} | $${pnl_change.toFixed(2)} | Total PnL $${totalPnlRef.current.toFixed(2)}`, won ? 'win' : 'loss');

            awaitingResultRef.current = false;
            buyPriceRef.current = 0;
            payoutRef.current = 0;

            if (won) {
                modeRef.current = 'virtual';
                virtualLossCountRef.current = 0;
                virtualLossTargetRef.current = randomTarget();
                currentStakeRef.current = p.initial_stake;
            } else {
                sideRef.current = sideRef.current === 'even' ? 'odd' : 'even';
                modeRef.current = 'real';
                currentStakeRef.current = Number((currentStakeRef.current * p.martingale_mult).toFixed(2));
            }

            setState(prev => ({ ...prev, total_pnl: totalPnlRef.current, current_stake: currentStakeRef.current }));

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

            if (modeRef.current === 'real' && isArmedRef.current) {
                placeRealTrade();
            }
        },
        [placeRealTrade, pushLog]
    );

    const handleVirtualTick = useCallback((digit: number) => {
        const won = winsSide(digit, sideRef.current);
        if (won) {
            virtualLossCountRef.current = 0;
            return false;
        }
        virtualLossCountRef.current += 1;
        return virtualLossCountRef.current >= virtualLossTargetRef.current;
    }, []);

    const handleTick = useCallback(
        (quote: number) => {
            if (!isArmedRef.current) return;
            const digit = Number(String(quote).slice(-1));

            if (awaitingResultRef.current) {
                settleRealTrade(digit);
                return;
            }
            if (pendingRef.current) return; // mid-flight on the buy confirmation, do nothing this tick

            if (modeRef.current === 'real') {
                placeRealTrade();
                return;
            }
            const should_go_real = handleVirtualTick(digit);
            if (should_go_real) {
                modeRef.current = 'real';
                placeRealTrade();
            }
        },
        [handleVirtualTick, placeRealTrade, settleRealTrade]
    );

    const start = useCallback(
        async (params: TSpeedTraderParams) => {
            paramsRef.current = params;
            currentStakeRef.current = params.initial_stake;
            totalPnlRef.current = 0;
            sideRef.current = 'even';
            modeRef.current = 'virtual';
            virtualLossCountRef.current = 0;
            virtualLossTargetRef.current = randomTarget();
            pendingRef.current = false;
            awaitingResultRef.current = false;
            payoutWarnedRef.current = false;
            isArmedRef.current = true;

            setState({
                is_armed: true,
                is_loading: true,
                total_pnl: 0,
                current_stake: params.initial_stake,
                logs: [],
                stop_reason: null,
            });

            pushLog(`Connecting to ${params.symbol}…`, 'info');

            messageSubscriptionRef.current = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                if (data?.msg_type === 'buy') return; // handled via the .then() on the send() call itself
                if (data?.msg_type === 'tick' && data?.tick?.symbol === params.symbol) {
                    if (data.tick.id) tickSubscriptionIdRef.current = data.tick.id;
                    handleTick(Number(data.tick.quote));
                }
            });

            const sub_res = await api_base.api.send({ ticks: params.symbol, subscribe: 1 });
            if (sub_res?.error) {
                pushLog(`Failed to subscribe to ${params.symbol}: ${sub_res.error.message}`, 'error');
                isArmedRef.current = false;
                setState(prev => ({ ...prev, is_armed: false, is_loading: false }));
                return;
            }
            if (sub_res?.subscription?.id) tickSubscriptionIdRef.current = sub_res.subscription.id;

            pushLog('Armed and monitoring.', 'info');
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
        return () => {
            isArmedRef.current = false;
            messageSubscriptionRef.current?.unsubscribe();
            if (tickSubscriptionIdRef.current) {
                api_base.api.send({ forget: tickSubscriptionIdRef.current }).catch(() => {});
                tickSubscriptionIdRef.current = null;
            }
        };
    }, []);

    return { state, start, stop };
};
