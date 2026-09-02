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
    reference_digit: number; // 0-9 — the digit that triggers a check
    mode: TReversalMode;
    threshold_digit: number; // over/under barrier, ignored in evenodd mode
    streak_target: number; // once this many same-direction outcomes in a row build up, bet the reversal
    initial_stake: number;
    martingale_mult: number;
    max_martingale_steps: number;
    stop_loss: number;
    take_profit: number;
};

type TPerSymbolState = {
    run_direction: TDirection | null;
    run_length: number;
    martingale_step: number;
};

export type TRaceProgress = { direction: TDirection | null; count: number; target: number };

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
    const perSymbolRef = useRef<Map<string, TPerSymbolState>>(new Map());
    const activeSymbolRef = useRef<string | null>(null);
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
        perSymbolRef.current.forEach((st, sym) => {
            progress[sym] = { direction: st.run_direction, count: st.run_length, target: p.streak_target };
        });
        setState(prev => ({ ...prev, race_progress: progress, active_symbol: activeSymbolRef.current }));
    }, []);

    const freshSymbolState = (): TPerSymbolState => ({ run_direction: null, run_length: 0, martingale_step: 0 });

    const settleTrade = useCallback(
        (won: boolean) => {
            const p = paramsRef.current;
            const active_symbol = activeSymbolRef.current;
            if (!p || !active_symbol) return;

            const symbol_state = perSymbolRef.current.get(active_symbol) ?? freshSymbolState();
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
                watchedSymbolsRef.current.forEach(sym => perSymbolRef.current.set(sym, freshSymbolState()));
                activeSymbolRef.current = null;
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
                // Reset the run on this symbol too — we already bet the
                // reversal once; keep watching for the next fresh streak.
                symbol_state.run_direction = null;
                symbol_state.run_length = 0;
                perSymbolRef.current.set(active_symbol, symbol_state);
                modeRef.current = 'real';
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
                const symbol_state = perSymbolRef.current.get(active_symbol) ?? freshSymbolState();
                symbol_state.run_direction = null;
                symbol_state.run_length = 0;
                perSymbolRef.current.set(active_symbol, symbol_state);
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

            if (modeRef.current === 'real' && active_symbol === symbol && !pendingRef.current && !awaitingResolutionRef.current) {
                // Martingale recovery step already queued from a loss —
                // fire again on this same symbol without waiting for a
                // fresh streak (the reversal thesis still holds).
                placeRealTrade();
                return;
            }

            if (active_symbol && active_symbol !== symbol) return; // race already resolved onto another market

            // Virtual scanning: watch for the reference digit, then track
            // the run of same-direction outcomes right after it.
            const prevDigit = lastDigitRef.current.get(symbol);
            lastDigitRef.current.set(symbol, digit);
            if (prevDigit !== p.reference_digit) return;

            const direction = classify(digit, p.mode, p.threshold_digit);
            if (direction === null) return; // tied the threshold — ignored entirely

            const st = perSymbolRef.current.get(symbol) ?? freshSymbolState();
            if (direction === st.run_direction) {
                st.run_length += 1;
            } else {
                st.run_direction = direction;
                st.run_length = 1;
            }
            perSymbolRef.current.set(symbol, st);

            if (st.run_length >= p.streak_target) {
                activeSymbolRef.current = symbol;
                modeRef.current = 'real';
                reversalSideRef.current = opposite(direction);
                pushLog(
                    `[${symbol}] ${st.run_length}x ${direction.toUpperCase()} after ${p.reference_digit} — reversal expected.`,
                    'warn'
                );
                publishProgress();
                placeRealTrade();
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
            pendingRef.current = false;
            awaitingResolutionRef.current = false;
            reversalSideRef.current = null;

            const symbols = params.symbols;
            watchedSymbolsRef.current = symbols;
            perSymbolRef.current = new Map(symbols.map(sym => [sym, freshSymbolState()]));
            lastDigitRef.current = new Map();

            setState({
                is_armed: true,
                is_loading: true,
                total_pnl: 0,
                current_stake: params.initial_stake,
                logs: [],
                stop_reason: null,
                watching: symbols,
                active_symbol: null,
                race_progress: Object.fromEntries(
                    symbols.map(sym => [sym, { direction: null, count: 0, target: params.streak_target }])
                ),
            });

            pushLog(
                symbols.length > 1
                    ? `Watching ${symbols.length} markets for ${params.reference_digit} \u2192 ${params.streak_target}x streak…`
                    : `Watching ${symbols[0]} for ${params.reference_digit} \u2192 ${params.streak_target}x streak…`,
                'info'
            );

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
