import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export type TSpeedTraderLogEntry = {
    id: number;
    time: string;
    text: string;
    kind: 'info' | 'win' | 'loss' | 'warn' | 'error';
};

export type TVirtualProgress = { count: number; target: number; awaiting_confirmation?: boolean };

export type TSpeedTraderState = {
    is_armed: boolean;
    is_loading: boolean;
    total_pnl: number;
    current_stake: number;
    logs: TSpeedTraderLogEntry[];
    stop_reason: 'stop_loss' | 'take_profit' | 'manual' | null;
    // Race-mode additions:
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
    max_martingale_steps: number;
    stop_loss: number;
    take_profit: number;
    virtual_loss_mode: TVirtualLossMode; // 'random' = 3-5 randomized (default), 'fixed' = always 5
    contract_type: TSide; // 'even', 'odd', 'over4', 'over5', 'rise', 'fall'
    // When true, hitting the loss target doesn't fire the trade immediately.
    // Instead we wait for one real winning tick (the streak actually breaking)
    // before entering, e.g. odd odd odd odd -> wait -> even (confirms) -> trade even.
    require_confirmation: boolean;
    // 'wait' (default, safest): after buying, ignore ticks until Deriv confirms
    // the real settlement - guaranteed accurate, but the bot can't act on ticks
    // that arrive while waiting on that network round-trip.
    // 'calculate': compute the outcome instantly from the deciding tick itself
    // (same digit/direction math already used for virtual counting) so the bot
    // never stalls between trades. Real settlement still runs in the background
    // and silently corrects total P&L if it ever disagrees with the instant
    // calculation, so the balance shown is never allowed to drift from reality.
    result_mode: TResultMode;
};

type TSide = 'even' | 'odd' | 'over4' | 'under5' | 'rise' | 'fall';
export type { TSide };
type TMode = 'virtual' | 'real';
type TVirtualLossMode = 'random' | 'fixed';
type TResultMode = 'wait' | 'calculate';
export type { TResultMode };

type TPerSymbolState = {
    side: TSide;
    virtual_loss_count: number;
    virtual_loss_target: number;
    martingale_step: number;
    awaiting_confirmation: boolean; // true once loss target is hit; waits for a real winning tick before trading
};

const VIRTUAL_LOSS_MIN = 3;
const VIRTUAL_LOSS_MAX = 5;
const FIXED_VIRTUAL_LOSS_TARGET = 5;

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

const getLossTarget = (mode: TVirtualLossMode) => (mode === 'fixed' ? FIXED_VIRTUAL_LOSS_TARGET : randomTarget());

const getContractType = (side: TSide): string => {
    const typeMap: Record<TSide, string> = {
        even: 'DIGITEVEN',
        odd: 'DIGITODD',
        over4: 'DIGITOVER',
        under5: 'DIGITUNDER',
        rise: 'RISE',
        fall: 'FALL',
    };
    return typeMap[side];
};

const getContractParams = (side: TSide) => {
    if (side === 'over4') return { barrier: '4' };
    if (side === 'under5') return { barrier: '5' };
    return {};
};

const winsSide = (digit: number, side: TSide, prevDigit?: number) => {
    switch (side) {
        case 'even':
            return digit % 2 === 0;
        case 'odd':
            return digit % 2 === 1;
        case 'over4':
            return digit > 4;
        case 'under5':
            return digit < 5;
        case 'rise':
            return prevDigit !== undefined && digit > prevDigit;
        case 'fall':
            return prevDigit !== undefined && digit < prevDigit;
        default:
            return false;
    }
};

// Format the quote with the symbol's pip precision so trailing zeros
// survive (663.10 -> digit 0, NOT 1). String(663.10) drops the zero.
const extractLastDigit = (quote: number, pip_size: number) => Number(quote.toFixed(pip_size).slice(-1));

const freshSymbolState = (mode: TVirtualLossMode, side: TSide): TPerSymbolState => ({
    side,
    virtual_loss_count: 0,
    virtual_loss_target: getLossTarget(mode),
    martingale_step: 0,
    awaiting_confirmation: false,
});

export const useSpeedTrader = (currency: string) => {
    const [state, setState] = useState<TSpeedTraderState>(EMPTY_STATE);

    const paramsRef = useRef<TSpeedTraderParams | null>(null);
    const currencyRef = useRef(currency);
    const totalPnlRef = useRef(0);
    const currentStakeRef = useRef(0);
    const isArmedRef = useRef(false);
    const modeRef = useRef<TMode>('virtual');

    // Race-mode state.
    const watchedSymbolsRef = useRef<string[]>([]);
    const perSymbolRef = useRef<Map<string, TPerSymbolState>>(new Map());
    const activeSymbolRef = useRef<string | null>(null);
    const lastDigitRef = useRef<Map<string, number>>(new Map()); // track last digit per symbol for rise/fall

    const pendingRef = useRef(false); // buy sent, awaiting confirmation
    const awaitingResultRef = useRef(false); // buy confirmed, awaiting contract settlement
    const contractIdRef = useRef<string | null>(null); // track the contract we're waiting for
    const buyPriceRef = useRef(0);
    const payoutRef = useRef(0);
    const entryDigitRef = useRef<number | undefined>(undefined); // digit at the moment of entry, for Rise/Fall calculation
    const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const resultModeRef = useRef<TResultMode>('wait');
    // Contracts settled instantly by calculation, keyed by contract_id, kept
    // around only until the real Deriv settlement arrives to confirm or
    // correct them. Lets trading continue immediately in 'calculate' mode
    // while still reconciling every trade against the true outcome.
    const pendingReconciliationRef = useRef<
        Map<string, { symbol: string; calculated_won: boolean; calculated_pnl_change: number }>
    >(new Map());

    const messageSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    const tickSubscriptionIdsRef = useRef<Map<string, string>>(new Map());
    const lastEpochBySymbolRef = useRef<Map<string, number>>(new Map());

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
            progress[sym] = {
                count: st.virtual_loss_count,
                target: st.virtual_loss_target,
                awaiting_confirmation: st.awaiting_confirmation,
            };
        });
        setState(prev => ({ ...prev, virtual_progress: progress, active_symbol: activeSymbolRef.current }));
    }, []);

    const settleRealTradeFromResult = useCallback(
        (result: { won: boolean; payout: number }, source: 'confirmed' | 'calculated' = 'confirmed') => {
            const p = paramsRef.current;
            const active_symbol = activeSymbolRef.current;
            if (!p || !active_symbol) return;
            if (!awaitingResultRef.current) return; // already settled — never double count

            const settling_contract_id = contractIdRef.current;
            const symbol_state = perSymbolRef.current.get(active_symbol) ?? freshSymbolState(p.virtual_loss_mode, p.contract_type);
            const won = result.won;
            const pnl_change = won ? result.payout - buyPriceRef.current : -buyPriceRef.current;
            totalPnlRef.current += pnl_change;

            const tag = source === 'calculated' ? ' (calculated, confirming…)' : '';
            pushLog(
                `[${active_symbol}] ${won ? '🟢 WIN' : '🔴 LOSS'}${tag} | Payout $${result.payout.toFixed(2)} | PnL $${pnl_change.toFixed(2)} | Total $${totalPnlRef.current.toFixed(2)}`,
                won ? 'win' : 'loss'
            );

            // In calculate mode we move on immediately, but keep this contract
            // tracked so the real Deriv settlement (arriving separately, in the
            // background) can still confirm or correct it once it lands.
            if (source === 'calculated' && settling_contract_id) {
                pendingReconciliationRef.current.set(settling_contract_id, {
                    symbol: active_symbol,
                    calculated_won: won,
                    calculated_pnl_change: pnl_change,
                });
            }

            awaitingResultRef.current = false;
            contractIdRef.current = null;
            if (pollTimerRef.current) {
                clearTimeout(pollTimerRef.current);
                pollTimerRef.current = null;
            }
            buyPriceRef.current = 0;
            payoutRef.current = 0;

            if (won) {
                // Recovery streak resolved. Reset every watched market fresh
                // and resume scanning across the whole set.
                modeRef.current = 'virtual';
                currentStakeRef.current = p.initial_stake;
                watchedSymbolsRef.current.forEach(sym => perSymbolRef.current.set(sym, freshSymbolState(p.virtual_loss_mode, p.contract_type)));
                activeSymbolRef.current = null;
                pushLog(
                    watchedSymbolsRef.current.length > 1
                        ? `Recovered. Resuming scan across ${watchedSymbolsRef.current.length} markets.`
                        : 'Recovered. Resuming scan.',
                    'info'
                );
            } else {
                const newStake = currentStakeRef.current * p.martingale_mult;
                if (symbol_state.martingale_step >= p.max_martingale_steps) {
                    symbol_state.martingale_step = 0;
                    currentStakeRef.current = p.initial_stake;
                } else {
                    symbol_state.martingale_step += 1;
                    currentStakeRef.current = Number(newStake.toFixed(2));
                }
                perSymbolRef.current.set(active_symbol, symbol_state);
                modeRef.current = 'real';
                // active_symbol stays locked in — martingale continues on
                // this same market until it wins, stop-loss, or take-profit.
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

    // Shared by both the push subscription and the poller below — the ONLY
    // two things allowed to settle a real trade. Both ask Deriv directly;
    // neither guesses from the tick stream.
    const handleContractUpdate = useCallback(
        (poc: any) => {
            if (!poc || !poc.is_sold) return false;
            const poc_contract_id = String(poc.contract_id ?? '');

            // Path 1: this is the trade we're actively blocked on (wait mode,
            // or calculate mode where the real result beat the next tick in).
            if (contractIdRef.current && poc_contract_id === String(contractIdRef.current)) {
                const won = poc.status === 'won' || Number(poc.profit) > 0;
                const payout = typeof poc.payout === 'number' ? poc.payout : payoutRef.current;
                settleRealTradeFromResult({ won, payout }, 'confirmed');

                if (poc.subscription?.id) {
                    api_base.api.send({ forget: poc.subscription.id }).catch(() => {});
                }
                return true;
            }

            // Path 2: this trade was already settled instantly by calculation
            // and the bot has moved on. Reconcile: if the real outcome agrees,
            // nothing to do. If it disagrees, correct total P&L so the balance
            // shown never drifts from what Deriv actually settled.
            const pending = pendingReconciliationRef.current.get(poc_contract_id);
            if (pending) {
                pendingReconciliationRef.current.delete(poc_contract_id);
                const real_won = poc.status === 'won' || Number(poc.profit) > 0;
                const real_pnl_change = Number(poc.profit) || 0; // Deriv's own net P&L for this contract

                if (real_won === pending.calculated_won) {
                    pushLog(`[${pending.symbol}] Confirmed - calculated result matched the real outcome.`, 'info');
                } else {
                    const correction = real_pnl_change - pending.calculated_pnl_change;
                    totalPnlRef.current += correction;
                    pushLog(
                        `[${pending.symbol}] ⚠️ Correction: calculated ${pending.calculated_won ? 'WIN' : 'LOSS'} but real result was ${real_won ? 'WIN' : 'LOSS'}. Adjusted total by $${correction.toFixed(2)} -> $${totalPnlRef.current.toFixed(2)}.`,
                        'warn'
                    );
                    setState(prev => ({ ...prev, total_pnl: totalPnlRef.current }));
                }

                if (poc.subscription?.id) {
                    api_base.api.send({ forget: poc.subscription.id }).catch(() => {});
                }
                return true;
            }

            return false;
        },
        [settleRealTradeFromResult, pushLog]
    );

    // Safety net for when the push subscription is dropped or delayed.
    // Actively asks Deriv for the contract's real status — never infers
    // the outcome from our own tick reading.
    const pollContractStatus = useCallback(
        (contract_id: string, attempt = 0) => {
            if (attempt > 20) return; // ~30s ceiling; the subscription should have caught it well before this
            pollTimerRef.current = setTimeout(() => {
                if (!awaitingResultRef.current || contractIdRef.current !== contract_id) return; // already settled elsewhere
                api_base.api
                    .send({ proposal_open_contract: 1, contract_id })
                    .then((res: any) => {
                        const poc = res?.proposal_open_contract;
                        const settled = handleContractUpdate(poc);
                        if (!settled && awaitingResultRef.current && contractIdRef.current === contract_id) {
                            pollContractStatus(contract_id, attempt + 1);
                        }
                    })
                    .catch(() => {
                        if (awaitingResultRef.current && contractIdRef.current === contract_id) {
                            pollContractStatus(contract_id, attempt + 1);
                        }
                    });
            }, 1500);
        },
        [handleContractUpdate]
    );

    const placeRealTrade = useCallback(() => {
        const p = paramsRef.current;
        const active_symbol = activeSymbolRef.current;
        if (!p || !active_symbol) return;

        const symbol_state = perSymbolRef.current.get(active_symbol) ?? freshSymbolState(p.virtual_loss_mode, p.contract_type);
        const side = symbol_state.side;
        const stake = currentStakeRef.current;
        pendingRef.current = true;

        pushLog(`[${active_symbol}] Trading ${side.toUpperCase()} — waiting for result…`, 'info');

        const resetToVirtual = () => {
            pendingRef.current = false;
            awaitingResultRef.current = false;
            modeRef.current = 'virtual';
            perSymbolRef.current.set(active_symbol, freshSymbolState(p.virtual_loss_mode, p.contract_type));
            activeSymbolRef.current = null;
            currentStakeRef.current = p.initial_stake;
            publishProgress();
        };

        // Step 1: proposal — this is the ONLY reliable source of the real
        // payout for this stake/contract/symbol combination. The direct
        // "shortcut buy" method used previously does not return a
        // trustworthy payout figure, which is why PnL was consistently
        // wrong regardless of stake.
        //
        // IMPORTANT: we do NOT set our own req_id here. The underlying
        // Deriv API library (DerivAPIBasic) matches responses to pending
        // requests purely by req_id, using its own internal auto-incrementing
        // counter for any request that doesn't explicitly specify one. Other
        // parts of this app share the same connection and rely on that same
        // auto-increment. If we supply our own separately-counted req_id, it
        // can collide with the library's counter and our response gets
        // mixed up with an unrelated message (e.g. a balance update). The
        // promise returned by .send() already resolves to the exact
        // response for that call — no manual correlation needed.
        api_base.api
            .send({
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: getContractType(side),
                ...getContractParams(side),
                currency: currencyRef.current || 'USD',
                duration: 1,
                duration_unit: 't',
                underlying_symbol: active_symbol,
            })
            .then((prop_res: any) => {
                if (prop_res?.error) {
                    resetToVirtual();
                    const err = prop_res.error;
                    pushLog(`[${active_symbol}] Proposal rejected: [${err.code || '?'}] ${err.message || 'unknown'}`, 'error');
                    return;
                }
                const proposal = prop_res?.proposal;
                if (!proposal || !proposal.id) {
                    resetToVirtual();
                    const keys = prop_res ? Object.keys(prop_res).join(',') : 'null response';
                    pushLog(`[${active_symbol}] Trade setup failed - unexpected response [${keys}]`, 'error');
                    return;
                }

                // Use provided payout or estimate if missing
                const real_payout = typeof proposal.payout === 'number' ? proposal.payout : stake * 1.95;
                const ask_price = typeof proposal.ask_price === 'number' ? proposal.ask_price : stake;

                // Step 2: buy at the exact price/id just quoted. Again, no
                // manual req_id — same reasoning as above.
                api_base.api
                    .send({
                        buy: proposal.id,
                        price: ask_price,
                    })
                    .then((buy_res: any) => {
                        if (buy_res?.error) {
                            resetToVirtual();
                            const err = buy_res.error;
                            pushLog(`[${active_symbol}] Trade rejected: [${err.code || '?'}] ${err.message || 'unknown'}`, 'error');
                            return;
                        }
                        const buy = buy_res?.buy;
                        // If the buy object exists at all, money has been spent —
                        // we must track this trade no matter what, never drop it.
                        if (!buy) {
                            resetToVirtual();
                            const keys = buy_res ? Object.keys(buy_res).join(',') : 'null response';
                            pushLog(`[${active_symbol}] Buy failed - unexpected response [${keys}]`, 'error');
                            return;
                        }

                        buyPriceRef.current = typeof buy.buy_price === 'number' ? buy.buy_price : ask_price;
                        payoutRef.current = real_payout; // verified, not guessed
                        contractIdRef.current = buy.contract_id ?? null;
                        entryDigitRef.current = lastDigitRef.current.get(active_symbol);
                        pendingRef.current = false;
                        awaitingResultRef.current = true;

                        if (buy.contract_id) {
                            // Actively subscribe to this contract so Deriv pushes us
                            // the real settlement (is_sold=1) instead of us guessing
                            // the outcome from the tick stream ourselves.
                            api_base.api
                                .send({
                                    proposal_open_contract: 1,
                                    contract_id: buy.contract_id,
                                    subscribe: 1,
                                })
                                .catch(() => {
                                    // Subscription failed to establish — the poller
                                    // below is the safety net, not tick-guessing.
                                });

                            // Safety net: in case the push subscription is dropped
                            // or delayed, actively poll Deriv for this contract's
                            // real status. This still asks Deriv directly — it
                            // never infers the result from our own tick reading.
                            pollContractStatus(buy.contract_id);
                        }
                    })
                    .catch((e: any) => {
                        resetToVirtual();
                        pushLog(`[${active_symbol}] Trade failed: ${e?.message || e?.error?.message || 'network error'}`, 'error');
                    });
            })
            .catch((e: any) => {
                resetToVirtual();
                pushLog(`[${active_symbol}] Trade failed: ${e?.message || e?.error?.message || 'network error'}`, 'error');
            });
    }, [pushLog, pollContractStatus, publishProgress]);

    const handleVirtualTick = useCallback(
        (symbol: string, digit: number) => {
            const st = perSymbolRef.current.get(symbol);
            const p = paramsRef.current;
            if (!st || !p) return;

            const prevDigit = lastDigitRef.current.get(symbol);
            lastDigitRef.current.set(symbol, digit);

            const won = winsSide(digit, st.side, prevDigit);

            // Already past the loss target and waiting for the streak to
            // actually break before entering. Keep watching until a real
            // winning tick shows up — losses in the meantime just extend
            // the streak we log, they don't reset anything.
            if (st.awaiting_confirmation) {
                if (won) {
                    activeSymbolRef.current = symbol;
                    modeRef.current = 'real';
                    st.awaiting_confirmation = false;
                    pushLog(`[${symbol}] Confirmed — streak broke, trading ${st.side.toUpperCase()} now.`, 'warn');
                    publishProgress();
                    placeRealTrade();
                } else {
                    st.virtual_loss_count += 1;
                    publishProgress();
                }
                return;
            }

            if (won) {
                if (st.virtual_loss_count !== 0) {
                    st.virtual_loss_count = 0;
                    publishProgress();
                }
                return;
            }
            st.virtual_loss_count += 1;

            if (st.virtual_loss_count >= st.virtual_loss_target) {
                if (p.require_confirmation) {
                    // Don't trade yet — wait for the next tick that actually
                    // wins before entering.
                    st.awaiting_confirmation = true;
                    pushLog(`[${symbol}] Hit ${st.virtual_loss_count} virtual losses — waiting for confirmation tick.`, 'warn');
                    publishProgress();
                } else {
                    // This market wins the race — lock it in and go real.
                    activeSymbolRef.current = symbol;
                    modeRef.current = 'real';
                    pushLog(`[${symbol}] Hit ${st.virtual_loss_count} virtual losses — going real.`, 'warn');
                    publishProgress();
                    placeRealTrade();
                }
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
                // Locked onto one market's real-trade cycle — every other
                // watched market's ticks are ignored until this resolves.
                if (symbol !== active_symbol) return;

                // 'wait' mode (default, safest): do nothing here; the
                // proposal_open_contract subscription (or the poller above) is
                // the only thing allowed to settle a real trade. Ticks that
                // arrive during this wait are simply not acted on.
                //
                // 'calculate' mode: this contract is duration=1 tick, so the
                // very next tick after entry is the deciding one. Compute the
                // outcome from it immediately using the same digit/direction
                // math already trusted for virtual counting, so the bot never
                // stalls waiting on the network. The real settlement still
                // arrives separately in the background and silently corrects
                // total P&L if it ever disagrees (see handleContractUpdate).
                if (awaitingResultRef.current) {
                    if (resultModeRef.current === 'calculate') {
                        const symbol_state = perSymbolRef.current.get(active_symbol);
                        if (symbol_state) {
                            const won = winsSide(digit, symbol_state.side, entryDigitRef.current);
                            settleRealTradeFromResult({ won, payout: payoutRef.current }, 'calculated');
                        }
                    }
                    return;
                }
                if (pendingRef.current) return; // mid-flight on the buy confirmation

                if (modeRef.current === 'real') {
                    placeRealTrade();
                }
                return;
            }

            // Scanning mode: every watched symbol counts virtual losses independently.
            handleVirtualTick(symbol, digit);
        },
        [handleVirtualTick, placeRealTrade, settleRealTradeFromResult]
    );

    const cleanupSubscriptions = useCallback(() => {
        messageSubscriptionRef.current?.unsubscribe();
        messageSubscriptionRef.current = null;
        tickSubscriptionIdsRef.current.forEach(id => {
            api_base.api.send({ forget: id }).catch(() => {});
        });
        tickSubscriptionIdsRef.current.clear();
        if (pollTimerRef.current) {
            clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }, []);

    const start = useCallback(
        async (params: TSpeedTraderParams) => {
            // Clean up any existing subscriptions from a previous run first.
            cleanupSubscriptions();

            const symbols = Array.from(new Set(params.symbols)).filter(Boolean);
            if (!symbols.length) return;

            const finalParams = { ...params, max_martingale_steps: params.max_martingale_steps ?? 5 };
            paramsRef.current = finalParams;
            currentStakeRef.current = params.initial_stake;
            totalPnlRef.current = 0;
            modeRef.current = 'virtual';
            pendingRef.current = false;
            awaitingResultRef.current = false;
            resultModeRef.current = finalParams.result_mode ?? 'wait';
            pendingReconciliationRef.current.clear();
            isArmedRef.current = true;

            watchedSymbolsRef.current = symbols;
            perSymbolRef.current = new Map(symbols.map(sym => [sym, freshSymbolState(finalParams.virtual_loss_mode, finalParams.contract_type)]));
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
                    symbols.map(sym => [sym, { count: 0, target: perSymbolRef.current.get(sym)!.virtual_loss_target }])
                ),
            });

            pushLog(
                symbols.length > 1 ? `Scanning ${symbols.length} markets…` : `Scanning the market on ${symbols[0]}…`,
                'info'
            );

            messageSubscriptionRef.current = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                if (data?.msg_type === 'buy') return; // handled via the .then() on the send() call itself

                // Real Deriv settlement: proposal_open_contract pushes updates
                // for the subscribed contract; is_sold=1 means it has settled.
                if (data?.msg_type === 'proposal_open_contract') {
                    handleContractUpdate(data.proposal_open_contract);
                    return;
                }

                if (data?.msg_type === 'tick' && data?.tick?.symbol && watchedSymbolsRef.current.includes(data.tick.symbol)) {
                    const sym = data.tick.symbol;
                    const epoch = Number(data.tick.epoch);
                    if (epoch && lastEpochBySymbolRef.current.get(sym) === epoch) return; // duplicate delivery, don't double-count toward a fire condition
                    if (epoch) lastEpochBySymbolRef.current.set(sym, epoch);
                    if (data.tick.id) tickSubscriptionIdsRef.current.set(sym, data.tick.id);
                    handleTick(sym, Number(data.tick.quote), Number(data.tick.pip_size ?? 2));
                }
            });

            // Subscribe to every watched symbol. One rejected/duplicate
            // subscription (e.g. AlreadySubscribed from a running bot)
            // shouldn't take down the whole race — ticks for that symbol
            // still arrive on the shared onMessage stream in that case.
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
                failed.forEach(f => pushLog(`[${f.sym}] Connection failed`, 'error'));
                // Drop failed symbols from the watch list rather than aborting
                // the whole run — the remaining markets still race normally.
                watchedSymbolsRef.current = watchedSymbolsRef.current.filter(sym => !failed.some(f => f.sym === sym));
                failed.forEach(f => perSymbolRef.current.delete(f.sym));
                setState(prev => ({ ...prev, watching: watchedSymbolsRef.current }));
            }

            if (!watchedSymbolsRef.current.length) {
                isArmedRef.current = false;
                pushLog('All connections failed. Stopped.', 'error');
                setState(prev => ({ ...prev, is_armed: false, is_loading: false }));
                return;
            }

            pushLog(
                watchedSymbolsRef.current.length > 1
                    ? `Ready — scanning ${watchedSymbolsRef.current.length} markets for the first to hit its loss target…`
                    : 'Ready — scanning for trades…',
                'info'
            );
            setState(prev => ({ ...prev, is_loading: false }));
        },
        [handleTick, pushLog, cleanupSubscriptions, handleContractUpdate]
    );

    const stop = useCallback(() => {
        isArmedRef.current = false;
        pendingRef.current = false;
        awaitingResultRef.current = false;
        cleanupSubscriptions();
        if (pendingReconciliationRef.current.size > 0) {
            pushLog(
                `${pendingReconciliationRef.current.size} calculated result(s) could not be confirmed against the real outcome before stopping.`,
                'warn'
            );
            pendingReconciliationRef.current.clear();
        }
        pushLog('Stopped manually.', 'info');
        setState(prev => ({ ...prev, is_armed: false, stop_reason: 'manual' }));
    }, [pushLog, cleanupSubscriptions]);

    useEffect(() => {
        return () => {
            isArmedRef.current = false;
            cleanupSubscriptions();
        };
    }, [cleanupSubscriptions]);

    return { state, start, stop };
};
