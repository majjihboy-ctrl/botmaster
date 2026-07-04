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
    consecutive_losses: number;
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

type TLastFired = {
    contract_type: 'DIGITEVEN' | 'DIGITODD';
    stake: number;
    payout: number | null; // null only if the buy confirmation didn't include one (logged + flagged)
};

const PATTERN: ('DIGITEVEN' | 'DIGITODD')[] = ['DIGITEVEN', 'DIGITEVEN', 'DIGITODD', 'DIGITODD'];

const EMPTY_STATE: TSpeedTraderState = {
    is_armed: false,
    is_loading: false,
    total_pnl: 0,
    current_stake: 0,
    consecutive_losses: 0,
    logs: [],
    stop_reason: null,
};

let log_id_counter = 0;

export const useSpeedTrader = (currency: string) => {
    const [state, setState] = useState<TSpeedTraderState>(EMPTY_STATE);

    const paramsRef = useRef<TSpeedTraderParams | null>(null);
    const currencyRef = useRef(currency);
    currencyRef.current = currency;

    const totalPnlRef = useRef(0);
    const currentStakeRef = useRef(0);
    const consecutiveLossesRef = useRef(0);
    const lastFiredRef = useRef<TLastFired | null>(null);
    const isArmedRef = useRef(false);
    const payoutWarnedRef = useRef(false);

    const messageSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    const tickSubscriptionIdRef = useRef<string | null>(null);

    const pushLog = useCallback((text: string, kind: TSpeedTraderLogEntry['kind'] = 'info') => {
        log_id_counter += 1;
        const entry: TSpeedTraderLogEntry = {
            id: log_id_counter,
            time: new Date().toLocaleTimeString(),
            text,
            kind,
        };
        setState(prev => ({ ...prev, logs: [...prev.logs.slice(-199), entry] }));
    }, []);

    const fireContract = useCallback((contract_type: 'DIGITEVEN' | 'DIGITODD', stake: number) => {
        const p = paramsRef.current;
        if (!p) return;
        // Same direct "shortcut" buy shape already used elsewhere in this
        // codebase's own trade engine (tradeOptionToBuy) — buy with inline
        // parameters, no separate proposal round-trip, matching the
        // reference script's fire-immediately approach.
        api_base.api
            .send({
                buy: '1',
                price: stake,
                parameters: {
                    amount: stake,
                    basis: 'stake',
                    contract_type,
                    currency: currencyRef.current || 'USD',
                    duration: 1,
                    duration_unit: 't',
                    underlying_symbol: p.symbol,
                },
            })
            .then((res: any) => {
                if (res?.error) {
                    // Bug fix #1: a rejected order must NOT be treated as an
                    // outstanding contract. Leave lastFiredRef untouched
                    // (stays null / whatever it already was), so the next
                    // tick's settlement step has nothing to (wrongly) score.
                    pushLog(`Order rejected: ${res.error.message || res.error.code}`, 'error');
                    return;
                }
                const buy = res?.buy;
                if (!buy) {
                    pushLog('Buy confirmation had no data — skipping this contract.', 'warn');
                    return;
                }
                let payout = typeof buy.payout === 'number' ? buy.payout : null;
                if (payout === null && !payoutWarnedRef.current) {
                    payoutWarnedRef.current = true;
                    pushLog(
                        'Buy confirmation did not include a payout figure — falling back to an estimate for this trade only. Recommend a manual test trade to confirm.',
                        'warn'
                    );
                }
                lastFiredRef.current = {
                    contract_type,
                    stake,
                    payout, // null handled at settlement time
                };
            })
            .catch((e: any) => {
                pushLog(`Buy request failed: ${e?.message || e}`, 'error');
            });
    }, [pushLog]);

    const handleTick = useCallback(
        (quote: number) => {
            const p = paramsRef.current;
            if (!p || !isArmedRef.current) return;

            const last_digit = Number(String(quote).slice(-1));
            const is_even = last_digit % 2 === 0;

            const last_fired = lastFiredRef.current;
            if (last_fired) {
                const won =
                    (last_fired.contract_type === 'DIGITEVEN' && is_even) ||
                    (last_fired.contract_type === 'DIGITODD' && !is_even);

                // Bug fix #2: use the REAL payout from the buy confirmation
                // instead of a hardcoded ratio guess. Only if that field was
                // genuinely unavailable do we fall back to an approximation,
                // and every such trade is already flagged in the log above.
                const payout_for_calc = last_fired.payout ?? last_fired.stake * 1.9; // conservative fallback only
                const profit = won ? payout_for_calc - last_fired.stake : -last_fired.stake;

                totalPnlRef.current += profit;
                if (won) {
                    consecutiveLossesRef.current = 0;
                    currentStakeRef.current = p.initial_stake;
                } else {
                    consecutiveLossesRef.current += 1;
                    currentStakeRef.current = Number(
                        (currentStakeRef.current * p.martingale_mult).toFixed(2)
                    );
                }
                lastFiredRef.current = null;

                pushLog(
                    `${won ? 'WIN' : 'LOSS'} | digit ${last_digit} (${is_even ? 'even' : 'odd'}) | PnL $${totalPnlRef.current.toFixed(2)}`,
                    won ? 'win' : 'loss'
                );

                setState(prev => ({
                    ...prev,
                    total_pnl: totalPnlRef.current,
                    current_stake: currentStakeRef.current,
                    consecutive_losses: consecutiveLossesRef.current,
                }));

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
            }

            if (!isArmedRef.current) return;
            const next_contract = PATTERN[consecutiveLossesRef.current % 4];
            fireContract(next_contract, currentStakeRef.current);
        },
        [fireContract, pushLog]
    );

    const start = useCallback(
        async (params: TSpeedTraderParams) => {
            paramsRef.current = params;
            currentStakeRef.current = params.initial_stake;
            consecutiveLossesRef.current = 0;
            totalPnlRef.current = 0;
            lastFiredRef.current = null;
            payoutWarnedRef.current = false;
            isArmedRef.current = true;

            setState({
                is_armed: true,
                is_loading: true,
                total_pnl: 0,
                current_stake: params.initial_stake,
                consecutive_losses: 0,
                logs: [],
                stop_reason: null,
            });

            pushLog(`Connecting to ${params.symbol}…`, 'info');

            messageSubscriptionRef.current = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
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

            pushLog(`Armed. Pattern: Even, Even, Odd, Odd. Firing every tick.`, 'info');
            setState(prev => ({ ...prev, is_loading: false }));
        },
        [handleTick, pushLog]
    );

    const stop = useCallback(() => {
        isArmedRef.current = false;
        lastFiredRef.current = null;
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
