import { useEffect, useSyncExternalStore } from 'react';
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

const freshSymbolState = (): TPerSymbolState => ({
    run_direction: null,
    run_length: 0,
    martingale_step: 0,
    is_recovering: false,
    is_pending_trigger: false,
});

const candidateDigits = (p: TReversalTraderParams): number[] =>
    p.reference_digit === 'all' ? Array.from({ length: 10 }, (_, d) => d) : [p.reference_digit];

// ---------------------------------------------------------------------------
// Module-level singleton. This is a real-money trading engine — it must keep
// running (armed trades, martingale state, live tick subscription) no matter
// what tab is on screen. Living outside any component means switching away
// from Digit Pattern and back never interrupts an in-flight trade.
// ---------------------------------------------------------------------------
const engine = {
    publicState: EMPTY_STATE,
    listeners: new Set<() => void>(),

    params: null as TReversalTraderParams | null,
    currency: 'USD',
    totalPnl: 0,
    currentStake: 0,
    isArmed: false,
    mode: 'virtual' as TMode,

    watchedSymbols: [] as string[],
    // symbol -> digit (0-9) -> streak state. In fixed-digit mode only one
    // digit key ever exists per symbol; in 'all' mode all 10 exist and are
    // updated in parallel, since a tick's prevDigit is itself a valid
    // reference digit whichever value it happens to be.
    perSymbol: new Map<string, Map<number, TPerSymbolState>>(),
    activeSymbol: null as string | null,
    activeDigit: null as number | null, // which reference digit triggered/is being recovered
    lastDigit: new Map<string, number>(),

    pending: false, // proposal+buy network calls in flight
    awaitingResolution: false, // bought; next tick resolves it
    buyPrice: 0,
    payout: 0,
    reversalSide: null as TDirection | null,

    messageSubscription: null as { unsubscribe: () => void } | null,
};

const notify = () => engine.listeners.forEach(l => l());

const setPublicState = (patch: Partial<TReversalTraderState>) => {
    engine.publicState = { ...engine.publicState, ...patch };
    notify();
};

const pushLog = (text: string, kind: TLogEntry['kind'] = 'info') => {
    log_id_seq += 1;
    const entry: TLogEntry = { id: log_id_seq, time: new Date().toLocaleTimeString(), text, kind };
    setPublicState({ logs: [...engine.publicState.logs.slice(-199), entry] });
};

const getOrCreateDigitState = (symbol: string, digit: number): TPerSymbolState => {
    let digit_map = engine.perSymbol.get(symbol);
    if (!digit_map) {
        digit_map = new Map();
        engine.perSymbol.set(symbol, digit_map);
    }
    let st = digit_map.get(digit);
    if (!st) {
        st = freshSymbolState();
        digit_map.set(digit, st);
    }
    return st;
};

const publishProgress = () => {
    const p = engine.params;
    if (!p) return;
    const progress: Record<string, TRaceProgress> = {};
    engine.perSymbol.forEach((digit_map, sym) => {
        // If locked onto this symbol, always show the active digit's
        // progress specifically. Otherwise show whichever digit on this
        // symbol is currently closest to completing its streak.
        if (engine.activeSymbol === sym && engine.activeDigit !== null) {
            const st = digit_map.get(engine.activeDigit);
            progress[sym] = {
                direction: st?.run_direction ?? null,
                count: st?.run_length ?? p.streak_target,
                target: p.streak_target,
                digit: engine.activeDigit,
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

    const patch: Partial<TReversalTraderState> = { race_progress: progress, active_symbol: engine.activeSymbol };

    // Full per-digit breakdown, only meaningful (and only computed) when
    // watching a single market — with several markets this would be a
    // 10xN grid, too much to usefully show compactly.
    if (engine.watchedSymbols.length === 1) {
        const sym = engine.watchedSymbols[0];
        const digit_map = engine.perSymbol.get(sym);
        const heat: Record<number, TRaceProgress> = {};
        if (digit_map) {
            digit_map.forEach((st, d) => {
                heat[d] = { direction: st.run_direction, count: st.run_length, target: p.streak_target, digit: d };
            });
        }
        patch.digit_heat = heat;
    }

    setPublicState(patch);
};

const settleTrade = (won: boolean) => {
    const p = engine.params;
    const active_symbol = engine.activeSymbol;
    const active_digit = engine.activeDigit;
    if (!p || !active_symbol || active_digit === null) return;

    const symbol_state = getOrCreateDigitState(active_symbol, active_digit);
    const pnl_change = won ? engine.payout - engine.buyPrice : -engine.buyPrice;
    engine.totalPnl += pnl_change;

    pushLog(
        `[${active_symbol}] ${won ? '🟢 WIN' : '🔴 LOSS'} | Payout $${engine.payout.toFixed(2)} | PnL $${pnl_change.toFixed(2)} | Total $${engine.totalPnl.toFixed(2)}`,
        won ? 'win' : 'loss'
    );

    engine.buyPrice = 0;
    engine.payout = 0;

    if (won) {
        engine.reversalSide = null;
        engine.mode = 'virtual';
        engine.currentStake = p.initial_stake;
        engine.watchedSymbols.forEach(sym => {
            engine.perSymbol.set(sym, new Map(candidateDigits(p).map(d => [d, freshSymbolState()])));
        });
        engine.activeSymbol = null;
        engine.activeDigit = null;
        pushLog(
            engine.watchedSymbols.length > 1
                ? `Recovered. Resuming scan across ${engine.watchedSymbols.length} markets.`
                : 'Recovered. Resuming scan.',
            'info'
        );
    } else {
        if (symbol_state.martingale_step >= p.max_martingale_steps) {
            symbol_state.martingale_step = 0;
            engine.currentStake = p.initial_stake;
        } else {
            symbol_state.martingale_step += 1;
            engine.currentStake = Number((engine.currentStake * p.martingale_mult).toFixed(2));
        }
        // Recovery mode: no streak needed anymore. Stay locked on this
        // symbol AND this specific digit, keep betting the SAME reversal
        // side — fire again the very next time this reference digit itself
        // reappears, no matter what follows it.
        symbol_state.run_direction = null;
        symbol_state.run_length = 0;
        symbol_state.is_recovering = true;
        engine.perSymbol.get(active_symbol)?.set(active_digit, symbol_state);
        engine.mode = 'virtual';
        pushLog(`[${active_symbol}] Recovering — waiting for ${active_digit} to reappear (no streak needed).`, 'info');
    }

    setPublicState({
        total_pnl: engine.totalPnl,
        current_stake: engine.currentStake,
        active_symbol: engine.activeSymbol,
    });
    publishProgress();

    if (engine.totalPnl <= -p.stop_loss) {
        engine.isArmed = false;
        pushLog(`Stop loss hit at $${engine.totalPnl.toFixed(2)}. Stopped.`, 'error');
        setPublicState({ is_armed: false, stop_reason: 'stop_loss' });
        return;
    }
    if (engine.totalPnl >= p.take_profit) {
        engine.isArmed = false;
        pushLog(`Take profit hit at $${engine.totalPnl.toFixed(2)}. Stopped.`, 'error');
        setPublicState({ is_armed: false, stop_reason: 'take_profit' });
        return;
    }
};

const placeRealTrade = () => {
    const p = engine.params;
    const active_symbol = engine.activeSymbol;
    const side = engine.reversalSide;
    if (!p || !active_symbol || !side) return;

    const stake = engine.currentStake;
    engine.pending = true;
    pushLog(`[${active_symbol}] Streak of ${p.streak_target} confirmed — betting reversal ${side.toUpperCase()}.`, 'warn');

    const extra = side === 'over' || side === 'under' ? { barrier: String(p.threshold_digit) } : {};

    api_base.api
        .send({
            proposal: 1,
            amount: stake,
            basis: 'stake',
            contract_type: getContractType(side),
            ...extra,
            currency: engine.currency || 'USD',
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
            engine.buyPrice = Number(buy_res.buy.buy_price);
            engine.payout = Number(buy_res.buy.payout);
            engine.pending = false;
            engine.awaitingResolution = true;
        })
        .catch((err: any) => {
            engine.pending = false;
            engine.awaitingResolution = false;
            engine.reversalSide = null;
            const msg = err?.message || err?.error?.message || 'Trade failed';
            pushLog(`[${active_symbol}] ${msg}`, 'error');
            engine.mode = 'virtual';
            engine.activeSymbol = null;
            const active_digit = engine.activeDigit;
            engine.activeDigit = null;
            if (active_digit !== null) {
                const symbol_state = getOrCreateDigitState(active_symbol, active_digit);
                symbol_state.run_direction = null;
                symbol_state.run_length = 0;
                symbol_state.is_recovering = false;
                symbol_state.is_pending_trigger = false;
                engine.perSymbol.get(active_symbol)?.set(active_digit, symbol_state);
            }
            publishProgress();
        });
};

const handleTick = (symbol: string, quote: number, pip_size: number) => {
    if (!engine.isArmed) return;
    const p = engine.params;
    if (!p) return;

    const digit = Number(getLastDigitForList(quote, pip_size));
    const active_symbol = engine.activeSymbol;

    // A real trade is currently resolving — this tick IS the exit tick for
    // it (1-tick contracts settle on the very next tick).
    if (active_symbol === symbol && engine.awaitingResolution) {
        const side = engine.reversalSide;
        engine.awaitingResolution = false;
        if (side) settleTrade(wins(digit, side, p.threshold_digit));
        return;
    }

    if (active_symbol === symbol && engine.pending) return; // buy in flight

    if (active_symbol && active_symbol !== symbol) return; // locked onto a different market mid-recovery

    const prevDigit = engine.lastDigit.get(symbol);
    engine.lastDigit.set(symbol, digit);

    // Recovery mode, or a streak that just completed: no new streak needed.
    // Just wait for THIS SPECIFIC reference digit to reappear, then
    // immediately bet the already-decided reversal side. activeDigit pins
    // down which of the (up to 10) digits being tracked on this symbol is
    // the one currently locked in.
    if (active_symbol === symbol && engine.activeDigit !== null) {
        const rec_state = engine.perSymbol.get(symbol)?.get(engine.activeDigit);
        if (rec_state?.is_recovering || rec_state?.is_pending_trigger) {
            if (digit === engine.activeDigit) {
                const was_recovering = rec_state.is_recovering;
                rec_state.is_recovering = false;
                rec_state.is_pending_trigger = false;
                engine.perSymbol.get(symbol)?.set(engine.activeDigit, rec_state);
                pushLog(
                    `[${symbol}] ${engine.activeDigit} reappeared — firing ${was_recovering ? 'recovery' : 'streak-reversal'} trade.`,
                    'warn'
                );
                engine.mode = 'real';
                placeRealTrade();
            }
            return;
        }
    }

    // Fresh entry: prevDigit is itself the reference digit for whichever
    // streak it belongs to. In fixed mode only one digit was ever
    // pre-populated in this symbol's map, so anything else is correctly
    // ignored. In 'all' mode every digit 0-9 has its own tracker, so every
    // tick advances exactly one of them.
    if (prevDigit === undefined) return;
    if (p.reference_digit !== 'all' && prevDigit !== p.reference_digit) return;

    const digit_map = engine.perSymbol.get(symbol);
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
        engine.activeSymbol = symbol;
        engine.activeDigit = prevDigit;
        st.is_pending_trigger = true;
        engine.reversalSide = opposite(direction);
        digit_map.set(prevDigit, st);
        pushLog(
            `[${symbol}] ${st.run_length}x ${direction.toUpperCase()} after ${prevDigit} — waiting for ${prevDigit} to reappear before betting ${opposite(direction).toUpperCase()}.`,
            'warn'
        );
        publishProgress();
    } else {
        publishProgress();
    }
};

const stopEngine = (reason: TReversalTraderState['stop_reason'] = null) => {
    engine.isArmed = false;
    engine.mode = 'virtual';
    engine.activeSymbol = null;
    engine.activeDigit = null;
    engine.pending = false;
    engine.awaitingResolution = false;
    engine.reversalSide = null;
    engine.messageSubscription?.unsubscribe();
    engine.messageSubscription = null;
    pushLog('Stopped.', 'info');
    setPublicState({ is_armed: false, stop_reason: reason, active_symbol: null });
};

const startEngine = async (params: TReversalTraderParams) => {
    engine.params = params;
    engine.totalPnl = 0;
    engine.currentStake = params.initial_stake;
    engine.isArmed = true;
    engine.mode = 'virtual';
    engine.activeSymbol = null;
    engine.activeDigit = null;
    engine.pending = false;
    engine.awaitingResolution = false;
    engine.reversalSide = null;

    const symbols = params.symbols;
    engine.watchedSymbols = symbols;
    const digits_to_track = candidateDigits(params);
    engine.perSymbol = new Map(symbols.map(sym => [sym, new Map(digits_to_track.map(d => [d, freshSymbolState()]))]));
    engine.lastDigit = new Map();

    let initial_active_symbol: string | null = null;
    let initial_race_progress: Record<string, TRaceProgress> = Object.fromEntries(
        symbols.map(sym => [sym, { direction: null, count: 0, target: params.streak_target }])
    );

    if (params.preloaded_trigger && symbols.length === 1) {
        const { digit, direction, count } = params.preloaded_trigger;
        const sym = symbols[0];
        const digit_map = engine.perSymbol.get(sym);
        const st = digit_map?.get(digit) ?? freshSymbolState();
        st.run_direction = direction;
        st.run_length = count;
        st.is_pending_trigger = true;
        digit_map?.set(digit, st);

        engine.activeSymbol = sym;
        engine.activeDigit = digit;
        engine.reversalSide = opposite(direction);
        initial_active_symbol = sym;
        initial_race_progress = { [sym]: { direction, count, target: params.streak_target, digit } };
    }

    engine.publicState = {
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
    };
    notify();

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

    engine.messageSubscription?.unsubscribe();
    const normalize = (s: string) => (s || '').trim().toUpperCase();
    const watched_upper = new Set(symbols.map(normalize));

    engine.messageSubscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
        if (data?.msg_type !== 'tick') return;
        const sym = data?.tick?.symbol;
        if (!sym || !watched_upper.has(normalize(sym))) return;
        const quote = Number(data.tick.quote);
        const pip_size = api_base?.pip_sizes?.[sym] ?? String(data.tick.quote).split('.')[1]?.length ?? 2;
        handleTick(sym, quote, pip_size);
    });

    try {
        await Promise.all(symbols.map(sym => api_base.api.send({ ticks: sym, subscribe: 1 }).catch(() => null)));
    } catch {
        // individual symbol failures are non-fatal — others keep scanning
    }

    setPublicState({ is_loading: false });
};

const subscribe = (onStoreChange: () => void) => {
    engine.listeners.add(onStoreChange);
    return () => {
        engine.listeners.delete(onStoreChange);
        // Deliberately no stopEngine() here. This is a real-money trading
        // engine — switching tabs must never interrupt an armed bot or a
        // trade mid-flight. It keeps running in the background regardless
        // of which component (if any) is currently displaying it.
    };
};

const getSnapshot = () => engine.publicState;

/**
 * Thin React binding over a module-level trading engine singleton. The
 * engine itself (armed state, martingale progress, live tick subscription,
 * in-flight trades) lives independently of this hook's component lifecycle,
 * so navigating to another tab and back never stops or resets a running bot.
 */
export const useReversalTrader = (currency: string) => {
    useEffect(() => {
        engine.currency = currency;
    }, [currency]);

    const state = useSyncExternalStore(subscribe, getSnapshot);

    return { state, start: startEngine, stop: stopEngine };
};
