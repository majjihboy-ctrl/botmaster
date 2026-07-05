import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export type TSpeedTraderLogEntry = {
    id: number;
    time: string;
    text: string;
    kind: 'info' | 'win' | 'loss' | 'warn' | 'error';
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
    max_martingale_steps: number;
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

// Format the quote with the symbol's pip precision so trailing zeros
// survive (663.10 -> digit 0, NOT 1). String(663.10) drops the zero.
const extractLastDigit = (quote: number, pip_size: number) => Number(quote.toFixed(pip_size).slice(-1));

export const useSpeedTrader = (currency: string) => {
    const [state, setState] = useState<TSpeedTraderState>(EMPTY_STATE);

    const paramsRef = useRef<TSpeedTraderParams | null>(null);
    const currencyRef = useRef(currency);
    const totalPnlRef = useRef(0);
    const currentStakeRef = useRef(0);
    const isArmedRef = useRef(false);

    const sideRef = useRef<TSide>('even');
    const modeRef = useRef<TMode>('virtual');
    const virtualLossCountRef = useRef(0);
    const virtualLossTargetRef = useRef(randomTarget());
    const martingaleStepRef = useRef(0);
    const pendingRef = useRef(false); // buy sent, awaiting confirmation
    const awaitingResultRef = useRef(false); // buy confirmed, awaiting contract settlement
    const contractIdRef = useRef<string | null>(null); // track the contract we're waiting for
    const reqIdRef = useRef<number | null>(null);
    const reqIdCounterRef = useRef(0);
    const buyPriceRef = useRef(0);
    const payoutRef = useRef(0);

    const messageSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    const tickSubscriptionIdRef = useRef<string | null>(null);

    useEffect(() => {
        currencyRef.current = currency;
    }, [currency]);

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

        pushLog(`Trading ${side.toUpperCase()} — waiting for result…`, 'info');

        const resetToVirtual = () => {
            pendingRef.current = false;
            awaitingResultRef.current = false;
            modeRef.current = 'virtual';
            virtualLossCountRef.current = 0;
            virtualLossTargetRef.current = randomTarget();
        };

        // Step 1: proposal — this is the ONLY reliable source of the real
        // payout for this stake/contract/symbol combination. The direct
        // "shortcut buy" method used previously does not return a
        // trustworthy payout figure, which is why PnL was consistently
        // wrong regardless of stake.
        api_base.api
            .send({
                proposal: 1,
                req_id: rid,
                amount: stake,
                basis: 'stake',
                contract_type: side === 'even' ? 'DIGITEVEN' : 'DIGITODD',
                currency: currencyRef.current || 'USD',
                duration: 1,
                duration_unit: 't',
                underlying_symbol: p.symbol,
            })
            .then((prop_res: any) => {
                if (prop_res?.req_id !== undefined && prop_res.req_id !== rid) return; // stale response, ignore

                if (prop_res?.error) {
                    resetToVirtual();
                    pushLog('Trade rejected', 'error');
                    return;
                }
                const proposal = prop_res?.proposal;
                if (!proposal || !proposal.id) {
                    resetToVirtual();
                    pushLog(`Trade setup failed`, 'error');
                    return;
                }

                // Use provided payout or estimate if missing
                const real_payout = typeof proposal.payout === 'number' ? proposal.payout : stake * 1.95;
                const ask_price = typeof proposal.ask_price === 'number' ? proposal.ask_price : stake;

                // Step 2: buy at the exact price/id just quoted.
                api_base.api
                    .send({
                        buy: proposal.id,
                        price: ask_price,
                        req_id: rid,
                    })
                    .then((buy_res: any) => {
                        if (buy_res?.req_id !== undefined && buy_res.req_id !== rid) return;

                        if (buy_res?.error) {
                            resetToVirtual();
                            pushLog('Trade rejected', 'error');
                            return;
                        }
                        const buy = buy_res?.buy;
                        if (!buy || !buy.contract_id) {
                            resetToVirtual();
                            pushLog(`Buy failed - no contract`, 'error');
                            return;
                        }

                        buyPriceRef.current = typeof buy.buy_price === 'number' ? buy.buy_price : ask_price;
                        payoutRef.current = real_payout; // verified, not guessed
                        contractIdRef.current = buy.contract_id || null; // store contract ID to wait for settlement
                        pendingRef.current = false;
                        awaitingResultRef.current = true;
                    })
                    .catch(() => {
                        resetToVirtual();
                        pushLog('Trade failed', 'error');
                    });
            })
            .catch(() => {
                resetToVirtual();
                pushLog('Trade failed', 'error');
            });
    }, [pushLog]);

    const settleRealTradeFromResult = useCallback(
        (result: { won: boolean; payout: number }) => {
            const p = paramsRef.current;
            if (!p) return;

            const won = result.won;
            const pnl_change = won ? result.payout - buyPriceRef.current : -buyPriceRef.current;
            totalPnlRef.current += pnl_change;

            pushLog(
                `${won ? '🟢 WIN' : '🔴 LOSS'} | Payout $${result.payout.toFixed(2)} | PnL $${pnl_change.toFixed(2)} | Total $${totalPnlRef.current.toFixed(2)}`,
                won ? 'win' : 'loss'
            );

            awaitingResultRef.current = false;
            buyPriceRef.current = 0;
            payoutRef.current = 0;

            if (won) {
                modeRef.current = 'virtual';
                virtualLossCountRef.current = 0;
                virtualLossTargetRef.current = randomTarget();
                currentStakeRef.current = p.initial_stake;
                martingaleStepRef.current = 0;
            } else {
                let newStake = currentStakeRef.current * p.martingale_mult;
                
                if (martingaleStepRef.current >= p.max_martingale_steps) {
                    martingaleStepRef.current = 0;
                    currentStakeRef.current = p.initial_stake;
                } else {
                    martingaleStepRef.current += 1;
                    currentStakeRef.current = Number(newStake.toFixed(2));
                }
                
                modeRef.current = 'real';
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
        },
        [pushLog]
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
        (quote: number, pip_size: number) => {
            if (!isArmedRef.current) return;

            const digit = extractLastDigit(quote, pip_size);

            // Fallback: if awaiting result but contract settlement hasn't arrived yet,
            // settle based on digit comparison instead of waiting indefinitely
            if (awaitingResultRef.current) {
                const won = winsSide(digit, sideRef.current);
                settleRealTradeFromResult({
                    won: won,
                    payout: won ? payoutRef.current : 0
                });
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
        [handleVirtualTick, placeRealTrade, settleRealTradeFromResult]
    );

    const start = useCallback(
        async (params: TSpeedTraderParams) => {
            const finalParams = { ...params, max_martingale_steps: params.max_martingale_steps ?? 5 };
            paramsRef.current = finalParams;
            currentStakeRef.current = params.initial_stake;
            totalPnlRef.current = 0;
            sideRef.current = 'even';
            modeRef.current = 'virtual';
            virtualLossCountRef.current = 0;
            virtualLossTargetRef.current = randomTarget();
            martingaleStepRef.current = 0;
            pendingRef.current = false;
            awaitingResultRef.current = false;
            isArmedRef.current = true;

            setState({
                is_armed: true,
                is_loading: true,
                total_pnl: 0,
                current_stake: params.initial_stake,
                logs: [],
                stop_reason: null,
            });

            pushLog(`Scanning the market on ${params.symbol}…`, 'info');

            messageSubscriptionRef.current = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                if (data?.msg_type === 'buy') return; // handled via the .then() on the send() call itself
                
                // Wait for contract settlement result from Deriv
                if (data?.msg_type === 'contract' && awaitingResultRef.current && contractIdRef.current) {
                    if (data.contract?.contract_id === contractIdRef.current) {
                        const win = data.contract?.win === 1;
                        const payout = data.contract?.payout || payoutRef.current;
                        
                        settleRealTradeFromResult({
                            won: win,
                            payout: payout
                        });
                        contractIdRef.current = null;
                    }
                    return;
                }
                
                if (data?.msg_type === 'tick' && data?.tick?.symbol === params.symbol) {
                    if (data.tick.id) tickSubscriptionIdRef.current = data.tick.id;
                    handleTick(Number(data.tick.quote), Number(data.tick.pip_size ?? 2));
                }
            });

            let sub_res: any = null;
            try {
                sub_res = await api_base.api.send({ ticks: params.symbol, subscribe: 1 });
            } catch (e: any) {
                isArmedRef.current = false;
                pushLog(`Connection failed`, 'error');
                setState(prev => ({ ...prev, is_armed: false, is_loading: false }));
                return;
            }
            if (sub_res?.error) {
                isArmedRef.current = false;
                pushLog(`Connection failed`, 'error');
                setState(prev => ({ ...prev, is_armed: false, is_loading: false }));
                return;
            }
            if (sub_res?.subscription?.id) tickSubscriptionIdRef.current = sub_res.subscription.id;

            pushLog('Ready — scanning for trades…', 'info');
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
