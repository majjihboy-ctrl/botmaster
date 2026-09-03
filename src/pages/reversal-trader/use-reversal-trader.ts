import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';

export type TReversalMode = 'evenodd' | 'overunder';
export type TDirection = 'even' | 'odd' | 'over' | 'under';
export type TMode = 'virtual' | 'real';

export type TReversalTraderParams = {
    // Several symbols = race mode: every symbol is scanned at once for the
    // same reference-digit pattern; whichever hits the streak target first
    // takes over as the sole active market until its recovery streak
    // resolves in a win.
    symbols: string[];
    // A single digit (0-9), or 'all' to track every digit 0-9 in parallel on
    // every watched symbol simultaneously - whichever (symbol, digit) pair
    // hits the streak target first wins the race. This is what keeps signal
    // frequency high even at a longer streak_target: a longer streak is
    // rarer per tracker, but 'all' runs up to 10x more trackers per symbol
    // to compensate.
    reference_digit: number | 'all';
    mode: TReversalMode;
    threshold_digit: number; // over/under barrier, ignored in evenodd mode
    streak_target: number; // once this many same-direction outcomes in a row build up, bet the reversal
    initial_stake: number;
    martingale_mult: number;
    max_martingale_steps: number;
    stop_loss: number;
    take_profit: number;
    // A streak that's already built (e.g. handed over from Signals' "Trade
    // this") - skips the streak-building phase entirely and goes straight to
    // waiting for the reference digit to reappear, regardless of what
    // streak_target is set to. Only makes sense with a single watched symbol.
    preloaded_trigger?: { digit: number; direction: TDirection; count: number };
};

type TPerSymbolState = {
    run_direction: TDirection | null;
    run_length: number;
    martingale_step: number;
    is_recovering: boolean; // after a loss: skip streak-building, fire on the very next reappearance of the reference digit
    is_pending_trigger: boolean; // streak just completed: fire on the very next reappearance of the reference digit
};

export type TRaceProgress = { direction: TDirection | null; count: number; target: number; digit?: number };

export type TLogEntry = { id: number; time: string; text: string; kind: 'info' | 'warn' | 'win' | 'loss' | 'error' };

export type TReversalTraderState = {
    is_armed: boolean;
    is_loading: boolean;
    total_pnl: number;
    current_stake: number;
    logs: TLogEntry[];
    stop_reason: 'stop_loss' | 'take_profit' | null;
    watching: string[];
    active_symbol: string | null;
    race_progress: Record<string, TRaceProgress>;
    // Full 0-9 breakdown for the single watched symbol, only populated when
    // exactly one market is being watched — lets 'all digits' mode show
    // every digit's progress at a glance instead of only the best one.
    digit_heat: Record<number, TRaceProgress>;
};

const EMPTY_STATE: TReversalTraderState = {
    is_armed: false,
    is_loading: false,
    total_pnl: 0,
    current_stake: 0,
    logs: [],
    stop_reason: null,
    watching: [],
    active_symbol: null,
    race_progress: {},
    digit_heat: {},
};

const opposite = (dir: TDirection): TDirection => {
    if (dir === 'even') return 'odd';
    if (dir === 'odd') return 'even';
    if (dir === 'over') return 'under';
    return 'over';
};

const classify = (digit: number, mode: TReversalMode, threshold_digit: number): TDirection | null => {
    if (mode === 'evenodd') return digit % 2 === 0 ? 'even' : 'odd';
    if (digit > threshold_digit) return 'over';
    if (digit < threshold_digit) return 'under';
    return null; // exactly equal to threshold — ignored entirely, doesn't break or build the streak
};

const getContractType = (dir: TDirection): string => {
    const map: Record<TDirection, string> = { even: 'DIGITEVEN', odd: 'DIGITODD', over: 'DIGITOVER', under: 'DIGITUNDER' };
    return map[dir];
};

// Digit contracts settle purely by comparing the exit tick's last digit —
// exactly the same rule used here, so local resolution always matches
// what Deriv itself would settle. No network round trip needed.
const wins = (digit: number, dir: TDirection, threshold_digit: number): boolean => {
    if (dir === 'even') return digit % 2 === 0;
    if (dir === 'odd') return digit % 2 === 1;
    if (dir === 'over') return digit > threshold_digit;
    return digit < threshold_digit;
};

let log_id_seq = 0;

export const useReversalTrader = (currency: string) => {
    const [state, setState] = useState<TReversalTraderState>(EMPTY_STATE);

    const paramsRef = useRef<TReversalTraderParams | null>(null);
    const currencyRef = useRef(currency);
    const totalPnlRef = useRef(0);
    const currentStakeRef = useRef(0);
    const isArmedRef = useRef(false);
    const modeRef = useRef<TMode>('virtual');

    const watchedSymbolsRef = useRef<string[]>([]);
    // symbol -> digit (0-9) -> streak state. In fixed-digit mode only one
    // digit key ever exists per symbol; in 'all' mode all 10 exist and are
    // updated in parallel, since a tick's prevDigit is itself a valid
    // reference digit whichever value it happens to be.
    const perSymbolRef = useRef<Map<string, Map<number, TPerSymbolState>>>(new Map());
    const activeSymbolRef = useRef<string | null>(null);
    const activeDigitRef = useRef<number | null>(null); // which reference digit triggered/is being recovered
    const lastDigitRef = useRef<Map<string, number>>(new Map());

    const pendingRef = useRef(false); // proposal+buy network calls in flight
    const awaitingResolutionRef = useRef(false); // bought; next tick resolves it
    const buyPriceRef = useRef(0);
    const payoutRef = useRef(0);
    const reversalSideRef = useRef<TDirection | null>(null);

    const messageSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

    useEffect(() => {
        currencyRef.current = currency;
    }, [currency]);

    const pushLog = useCallback((text: string, kind: TLogEntry['kind'] = 'info') => {
        log_id_seq += 1;
        const entry: TLogEntry = { id: log_id_seq, time: new Date().toLocaleTimeString(), text, kind };
        setState(prev => ({ ...prev, logs: [...prev.logs.slice(-199), entry] }));
    }, []);

    const publishProgress = useCallback(() => {
        const p = paramsRef.current;
        if (!p) return;
        const progress: Record<string, TRaceProgress> = {};
        perSymbolRef.current.forEach((digit_map, sym) => {
            // If locked onto this symbol, always show the active digit's
            // progress specifically. Otherwise show whichever digit on this
            // symbol is currently closest to completing its streak.
            if (activeSymbolRef.current === sym && activeDigitRef.current !== null) {
                const st = digit_map.get(activeDigitRef.current);
                progress[sym] = {
                    direction: st?.run_direction ?? null,
                    count: st?.run_length ?? p.streak_target,
                    target: p.streak_target,
                    digit: activeDigitRef.current,
                };
                return;
            }
            let best_digit: number | null = null;
            let best_state: TPerSymbolState | null = null;
            digit_map.forEach((st, d) => {
                if (!best_state || st.run_length > best_state.run_length) {
                    best_state = st;
                    best_digit = d;
                }
            });
            progress[sym] = {
                direction: best_state?.run_direction ?? null,
                count: best_state?.run_length ?? 0,
                target: p.streak_target,
                digit: best_digit ?? undefined,
            };
        });
        setState(prev => ({ ...prev, race_progress: progress, active_symbol: activeSymbolRef.current }));

        // Full per-digit breakdown, only meaningful (and only computed) when
        // watching a single market — with several markets this would be a
        // 10xN grid, too much to usefully show compactly.
        if (watchedSymbolsRef.current.length === 1) {
            const sym = watchedSymbolsRef.current[0];
            const digit_map = perSymbolRef.current.get(sym);
            const heat: Record<number, TRaceProgress> = {};
            if (digit_map) {
                digit_map.forEach((st, d) => {
                    heat[d] = { direction: st.run_direction, count: st.run_length, target: p.streak_target, digit: d };
                });
            }
            setState(prev => ({ ...prev, digit_heat: heat }));
        }
    }, []);

    const freshSymbolState = (): TPerSymbolState => ({
        run_direction: null,
        run_length: 0,
        martingale_step: 0,
        is_recovering: false,
        is_pending_trigger: false,
    });

    const candidateDigits = (p: TReversalTraderParams): number[] =>
        p.reference_digit === 'all' ? Array.from({ length: 10 }, (_, d) => d) : [p.reference_digit];

    const getOrCreateDigitState = (symbol: string, digit: number): TPerSymbolState => {
        let digit_map = perSymbolRef.current.get(symbol);
        if (!digit_map) {
            digit_map = new Map();
            perSymbolRef.current.set(symbol, digit_map);
        }
        let st = digit_map.get(digit);
        if (!st) {
            st = freshSymbolState();
            digit_map.set(digit, st);
        }
        return st;
    };

    const settleTrade = useCallback(
        (won: boolean) => {
            const p = paramsRef.current;
            const active_symbol = activeSymbolRef.current;
            const active_digit = activeDigitRef.current;
            if (!p || !active_symbol || active_digit === null) return;

            const symbol_state = getOrCreateDigitState(active_symbol, active_digit);
            const pnl_change = won ? payoutRef.current - buyPriceRef.current : -buyPriceRef.current;
            totalPnlRef.current += pnl_change;

            pushLog(
                `[${active_symbol}] ${won ? '🟢 WIN' : '🔴 LOSS'} | Payout $${payoutRef.current.toFixed(2)} | PnL $${pnl_change.toFixed(2)} | Total $${totalPnlRef.current.toFixed(2)}`,
                won ? 'win' : 'loss'
            );

            buyPriceRef.current = 0;
            payoutRef.current = 0;

            if (won) {
                reversalSideRef.current = null;
                modeRef.current = 'virtual';
                currentStakeRef.current = p.initial_stake;
                watchedSymbolsRef.current.forEach(sym => {
                    perSymbolRef.current.set(sym, new Map(candidateDigits(p).map(d => [d, freshSymbolState()])));
                });
                activeSymbolRef.current = null;
                activeDigitRef.current = null;
                pushLog(
                    watchedSymbolsRef.current.length > 1
                        ? `Recovered. Resuming scan across ${watchedSymbolsRef.current.length} markets.`
                        : 'Recovered. Resuming scan.',
                    'info'
                );
            } else {
                if (symbol_state.martingale_step >= p.max_martingale_steps) {
                    symbol_state.martingale_step = 0;
                    currentStakeRef.current = p.initial_stake;
                } else {
                    symbol_state.martingale_step += 1;
                    currentStakeRef.current = Number((currentStakeRef.current * p.martingale_mult).toFixed(2));
                }
                // Recovery mode: no streak needed anymore. Stay locked on
                // this symbol AND this specific digit, keep betting the SAME
                // reversal side — fire again the very next time this
                // reference digit itself reappears, no matter what follows it.
                symbol_state.run_direction = null;
                symbol_state.run_length = 0;
                symbol_state.is_recovering = true;
                perSymbolRef.current.get(active_symbol)?.set(active_digit, symbol_state);
                modeRef.current = 'virtual';
                pushLog(`[${active_symbol}] Recovering — waiting for ${active_digit} to reappear (no streak needed).`, 'info');
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

    const placeRealTrade = useCallback(() => {
        const p = paramsRef.current;
        const active_symbol = activeSymbolRef.current;
        const side = reversalSideRef.current;
        if (!p || !active_symbol || !side) return;

        const stake = currentStakeRef.current;
        pendingRef.current = true;
        pushLog(`[${active_symbol}] Streak of ${p.streak_target} confirmed — betting reversal ${side.toUpperCase()}.`, 'warn');

        const extra = side === 'over' || side === 'under' ? { barrier: String(p.threshold_digit) } : {};

        api_base.api
            .send({
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: getContractType(side),
                ...extra,
                currency: currencyRef.current || 'USD',
                duration: 1,
                duration_unit: 't',
                underlying_symbol: active_symbol,
            })
            .then((proposal_res: any) => {
                if (proposal_res?.error) throw proposal_res.error;
                const proposal = proposal_res.proposal;
                return api_base.api.send({ buy: proposal.id, price: stake });
            })
            .then((buy_res: any) => {
                if (buy_res?.error) throw buy_res.error;
                buyPriceRef.current = Number(buy_res.buy.buy_price);
                payoutRef.current = Number(buy_res.buy.payout);
                pendingRef.current = false;
                awaitingResolutionRef.current = true;
            })
            .catch((err: any) => {
                pendingRef.current = false;
                awaitingResolutionRef.current = false;
                reversalSideRef.current = null;
                const msg = err?.message || err?.error?.message || 'Trade failed';
                pushLog(`[${active_symbol}] ${msg}`, 'error');
                modeRef.current = 'virtual';
                activeSymbolRef.current = null;
                const active_digit = activeDigitRef.current;
                activeDigitRef.current = null;
                if (active_digit !== null) {
                    const symbol_state = getOrCreateDigitState(active_symbol, active_digit);
                    symbol_state.run_direction = null;
                    symbol_state.run_length = 0;
                    symbol_state.is_recovering = false;
                    symbol_state.is_pending_trigger = false;
                    perSymbolRef.current.get(active_symbol)?.set(active_digit, symbol_state);
                }
                publishProgress();
            });
    }, [pushLog, publishProgress]);

    const handleTick = useCallback(
        (symbol: string, quote: number, pip_size: number) => {
            if (!isArmedRef.current) return;
            const p = paramsRef.current;
            if (!p) return;

            const digit = Number(getLastDigitForList(quote, pip_size));
            const active_symbol = activeSymbolRef.current;

            // A real trade is currently resolving — this tick IS the exit
            // tick for it (1-tick contracts settle on the very next tick).
            if (active_symbol === symbol && awaitingResolutionRef.current) {
                const side = reversalSideRef.current;
                awaitingResolutionRef.current = false;
                if (side) settleTrade(wins(digit, side, p.threshold_digit));
                return;
            }

            if (active_symbol === symbol && pendingRef.current) return; // buy in flight

            if (active_symbol && active_symbol !== symbol) return; // locked onto a different market mid-recovery

            const prevDigit = lastDigitRef.current.get(symbol);
            lastDigitRef.current.set(symbol, digit);

            // Recovery mode, or a streak that just completed: no new streak
            // needed. Just wait for THIS SPECIFIC reference digit to
            // reappear, then immediately bet the already-decided reversal
            // side. activeDigitRef pins down which of the (up to 10) digits
            // being tracked on this symbol is the one currently locked in.
            if (active_symbol === symbol && activeDigitRef.current !== null) {
                const rec_state = perSymbolRef.current.get(symbol)?.get(activeDigitRef.current);
                if (rec_state?.is_recovering || rec_state?.is_pending_trigger) {
                    if (digit === activeDigitRef.current) {
                        const was_recovering = rec_state.is_recovering;
                        rec_state.is_recovering = false;
                        rec_state.is_pending_trigger = false;
                        perSymbolRef.current.get(symbol)?.set(activeDigitRef.current, rec_state);
                        pushLog(
                            `[${symbol}] ${activeDigitRef.current} reappeared — firing ${was_recovering ? 'recovery' : 'streak-reversal'} trade.`,
                            'warn'
                        );
                        modeRef.current = 'real';
                        placeRealTrade();
                    }
                    return;
                }
            }

            // Fresh entry: prevDigit is itself the reference digit for
            // whichever streak it belongs to. In fixed mode only one digit
            // was ever pre-populated in this symbol's map, so anything else
            // is correctly ignored. In 'all' mode every digit 0-9 has its own
            // tracker, so every tick advances exactly one of them.
            if (prevDigit === undefined) return;
            if (p.reference_digit !== 'all' && prevDigit !== p.reference_digit) return;

            const digit_map = perSymbolRef.current.get(symbol);
            if (!digit_map || !digit_map.has(prevDigit)) return; // not a tracked digit for this symbol

            const direction = classify(digit, p.mode, p.threshold_digit);
            if (direction === null) return; // tied the threshold — ignored entirely

            const st = digit_map.get(prevDigit) ?? freshSymbolState();
            if (direction === st.run_direction) {
                st.run_length += 1;
            } else {
                st.run_direction = direction;
                st.run_length = 1;
            }
            digit_map.set(prevDigit, st);

            if (st.run_length >= p.streak_target) {
                activeSymbolRef.current = symbol;
                activeDigitRef.current = prevDigit;
                st.is_pending_trigger = true;
                reversalSideRef.current = opposite(direction);
                digit_map.set(prevDigit, st);
                pushLog(
                    `[${symbol}] ${st.run_length}x ${direction.toUpperCase()} after ${prevDigit} — waiting for ${prevDigit} to reappear before betting ${opposite(direction).toUpperCase()}.`,
                    'warn'
                );
                publishProgress();
            } else {
                publishProgress();
            }
        },
        [settleTrade, placeRealTrade, publishProgress, pushLog]
    );

    const stop = useCallback(
        (reason: TReversalTraderState['stop_reason'] = null) => {
            isArmedRef.current = false;
            modeRef.current = 'virtual';
            activeSymbolRef.current = null;
            activeDigitRef.current = null;
            pendingRef.current = false;
            awaitingResolutionRef.current = false;
            reversalSideRef.current = null;
            messageSubscriptionRef.current?.unsubscribe();
            messageSubscriptionRef.current = null;
            pushLog('Stopped.', 'info');
            setState(prev => ({ ...prev, is_armed: false, stop_reason: reason, active_symbol: null }));
        },
        [pushLog]
    );

    const start = useCallback(
        async (params: TReversalTraderParams) => {
            paramsRef.current = params;
            totalPnlRef.current = 0;
            currentStakeRef.current = params.initial_stake;
            isArmedRef.current = true;
            modeRef.current = 'virtual';
            activeSymbolRef.current = null;
            activeDigitRef.current = null;
            pendingRef.current = false;
            awaitingResolutionRef.current = false;
            reversalSideRef.current = null;

            const symbols = params.symbols;
            watchedSymbolsRef.current = symbols;
            const digits_to_track = candidateDigits(params);
            perSymbolRef.current = new Map(
                symbols.map(sym => [sym, new Map(digits_to_track.map(d => [d, freshSymbolState()]))])
            );
            lastDigitRef.current = new Map();

            let initial_active_symbol: string | null = null;
            let initial_race_progress: Record<string, TRaceProgress> = Object.fromEntries(
                symbols.map(sym => [sym, { direction: null, count: 0, target: params.streak_target }])
            );

            if (params.preloaded_trigger && symbols.length === 1) {
                const { digit, direction, count } = params.preloaded_trigger;
                const sym = symbols[0];
                const digit_map = perSymbolRef.current.get(sym);
                const st = digit_map?.get(digit) ?? freshSymbolState();
                st.run_direction = direction;
                st.run_length = count;
                st.is_pending_trigger = true;
                digit_map?.set(digit, st);

                activeSymbolRef.current = sym;
                activeDigitRef.current = digit;
                reversalSideRef.current = opposite(direction);
                initial_active_symbol = sym;
                initial_race_progress = { [sym]: { direction, count, target: params.streak_target, digit } };
            }

            setState({
                is_armed: true,
                is_loading: true,
                total_pnl: 0,
                current_stake: params.initial_stake,
                logs: [],
                stop_reason: null,
                watching: symbols,
                active_symbol: initial_active_symbol,
                race_progress: initial_race_progress,
                digit_heat: {},
            });

            if (params.preloaded_trigger) {
                const { digit, direction, count } = params.preloaded_trigger;
                pushLog(
                    `[${symbols[0]}] Streak of ${count}x ${direction.toUpperCase()} after ${digit} handed over from Signals — waiting for ${digit} to reappear before betting ${opposite(direction).toUpperCase()}.`,
                    'warn'
                );
            } else {
                pushLog(
                    params.reference_digit === 'all'
                        ? symbols.length > 1
                            ? `Watching ${symbols.length} markets across all 10 digits for a ${params.streak_target}x streak…`
                            : `Watching ${symbols[0]} across all 10 digits for a ${params.streak_target}x streak…`
                        : symbols.length > 1
                          ? `Watching ${symbols.length} markets for ${params.reference_digit} \u2192 ${params.streak_target}x streak…`
                          : `Watching ${symbols[0]} for ${params.reference_digit} \u2192 ${params.streak_target}x streak…`,
                    'info'
                );
            }

            messageSubscriptionRef.current?.unsubscribe();
            const normalize = (s: string) => (s || '').trim().toUpperCase();
            const watched_upper = new Set(symbols.map(normalize));

            messageSubscriptionRef.current = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                if (data?.msg_type !== 'tick') return;
                const sym = data?.tick?.symbol;
                if (!sym || !watched_upper.has(normalize(sym))) return;
                const quote = Number(data.tick.quote);
                const pip_size = api_base?.pip_sizes?.[sym] ?? String(data.tick.quote).split('.')[1]?.length ?? 2;
                handleTick(sym, quote, pip_size);
            });

            try {
                await Promise.all(
                    symbols.map(sym => api_base.api.send({ ticks: sym, subscribe: 1 }).catch(() => null))
                );
            } catch {
                // individual symbol failures are non-fatal — others keep scanning
            }

            setState(prev => ({ ...prev, is_loading: false }));
        },
        [handleTick, pushLog]
    );

    useEffect(
        () => () => {
            messageSubscriptionRef.current?.unsubscribe();
        },
        []
    );

    return { state, start, stop };
};
