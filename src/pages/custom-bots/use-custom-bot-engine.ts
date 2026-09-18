import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import { TSymbolOption } from '@/pages/analysis-tool/use-digit-stats';
import {
    TScanDirection,
    TScanEntry,
    TScanMode,
    startMarketScanner,
    subscribeMarketScanner,
    getMarketScannerSnapshot,
} from '@/pages/digit-pattern/use-market-scanner';
import { opposite } from '@/pages/digit-pattern/launch-xml-bot';

export type TCustomStrategy = 'reversal' | 'continuation';
export type TEngineStatus = 'idle' | 'running' | 'stopped' | 'error';
export type TEnginePhase = 'hunting' | 'armed' | 'in_trade' | 'waiting';

export type TCustomBotSettings = {
    mode: TScanMode;
    strategy: TCustomStrategy;
    threshold_digit: number;
    /** @deprecated kept for storage compat — use continuation_streak / reversal_streak */
    min_streak: number;
    /** Enter Continuation when anchor digit has produced the same outcome this many times */
    continuation_streak: number;
    /** Enter Reversal when the pattern is this long (unhealthy / stretched) */
    reversal_streak: number;
    initial_stake: number;
    martingale_mult: number;
    max_martingale_steps: number;
    stop_loss: number;
    take_profit: number;
    /** Exact market symbols to hunt. Empty = use max_markets from the full list. */
    selected_symbols: string[];
    /** When selected_symbols is empty, only the first N markets in the list are used. */
    max_markets: number;
};

export type TLockedTarget = {
    symbol: string;
    display_name: string;
    digit: number;
    streak_direction: TScanDirection;
    trade_direction: TScanDirection;
    contract_type: string;
    count: number;
};

export type TCustomTradeLog = {
    id: string;
    time: number;
    symbol: string;
    display_name: string;
    /** Anchor digit that triggered the trade */
    digit: number;
    /** Last digit of the exit tick (result) */
    result_digit?: number;
    contract_type: string;
    strategy: TCustomStrategy;
    stake: number;
    status: 'pending' | 'won' | 'lost' | 'failed';
    profit?: number;
    fail_reason?: string;
};

const STORAGE_KEY = 'custom_bots_settings';

export const DEFAULT_CUSTOM_BOT_SETTINGS: TCustomBotSettings = {
    mode: 'evenodd',
    strategy: 'continuation',
    threshold_digit: 5,
    min_streak: 3,
    continuation_streak: 3,
    reversal_streak: 7,
    initial_stake: 0.35,
    martingale_mult: 2,
    max_martingale_steps: 4,
    stop_loss: 5,
    take_profit: 100,
    selected_symbols: [],
    max_markets: 10,
};

/** Active streak length required for the current style. */
export const requiredStreak = (s: TCustomBotSettings): number =>
    s.strategy === 'reversal'
        ? s.reversal_streak ?? s.min_streak ?? 7
        : s.continuation_streak ?? s.min_streak ?? 3;

/** Resolve which markets the engine may trade on. */
export const resolveActiveSymbols = (
    all: TSymbolOption[],
    settings: TCustomBotSettings
): TSymbolOption[] => {
    if (!all.length) return [];
    if (settings.selected_symbols?.length) {
        const allow = new Set(settings.selected_symbols);
        return all.filter(s => allow.has(s.symbol));
    }
    const n = Math.max(1, Math.min(settings.max_markets || all.length, all.length));
    return all.slice(0, n);
};

export const loadCustomBotSettings = (): TCustomBotSettings => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const loaded = raw
            ? { ...DEFAULT_CUSTOM_BOT_SETTINGS, ...JSON.parse(raw) }
            : { ...DEFAULT_CUSTOM_BOT_SETTINGS };
        // A stored barrier of 0 or 9 makes one side unwinnable (DIGITUNDER 0 /
        // DIGITOVER 9 can never resolve in your favour). The picker no longer
        // offers those, but older saved settings can still carry them.
        loaded.threshold_digit = Math.min(8, Math.max(1, Number(loaded.threshold_digit) || 5));
        return loaded;
    } catch {
        return { ...DEFAULT_CUSTOM_BOT_SETTINGS };
    }
};

export const saveCustomBotSettings = (partial: Partial<TCustomBotSettings>) => {
    try {
        const current = loadCustomBotSettings();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }));
    } catch {
        // non-fatal
    }
};

const CONTRACT_BY_DIRECTION: Record<TScanDirection, string> = {
    even: 'DIGITEVEN',
    odd: 'DIGITODD',
    over: 'DIGITOVER',
    under: 'DIGITUNDER',
};

const roundStake = (n: number) => Math.max(0.35, Math.round(n * 100) / 100);

const resolveTradeDirection = (dir: TScanDirection, strategy: TCustomStrategy): TScanDirection =>
    strategy === 'reversal' ? opposite(dir) : dir;

/** Anchor digits allowed for UNDER setups (and even/odd pool). */
const LOW_DIGITS = new Set([0, 1, 2]);
/** Anchor digits allowed for OVER setups (and even/odd pool). */
const HIGH_DIGITS = new Set([7, 8, 9]);
const ANCHOR_DIGITS = new Set([0, 1, 2, 7, 8, 9]);

/**
 * Digit gate:
 * - Over/Under: 0–2 only for UNDER trades, 7–9 only for OVER trades.
 * - Even/Odd: same anchor digits only (0–2 and 7–9); direction still even/odd.
 */
const digitAllowsTrade = (
    digit: number,
    mode: TScanMode,
    trade_direction: TScanDirection
): boolean => {
    if (!ANCHOR_DIGITS.has(digit)) return false;
    if (mode === 'overunder') {
        if (trade_direction === 'under') return LOW_DIGITS.has(digit);
        if (trade_direction === 'over') return HIGH_DIGITS.has(digit);
        return false;
    }
    // evenodd — only low/high anchors, any even/odd trade direction
    return true;
};

type TLastSetup = { symbol: string; digit: number };

type TEngineSnapshot = {
    settings: TCustomBotSettings;
    status: TEngineStatus;
    phase: TEnginePhase;
    target: TLockedTarget | null;
    stake: number;
    loss_streak: number;
    session_profit: number;
    log: TCustomTradeLog[];
    stop_reason: string | null;
    status_message: string;
    /** Custom Pro: trade direction locked during martingale recovery */
    recovery_direction: TScanDirection | null;
    /** Custom Pro: markets banned until next win */
    banned_symbols: string[];
};

/** Custom Pro score: longer streak wins; slight penalty if market was just used. */
const scoreSetup = (e: TScanEntry, last_market: string | null): number => {
    let score = e.count * 10;
    if (last_market && e.symbol === last_market) score -= 25;
    return score;
};

const pickTarget = (
    entries: TScanEntry[],
    settings: TCustomBotSettings,
    last: TLastSetup | null,
    last_market: string | null,
    locked_direction: TScanDirection | null,
    allowed_symbols: Set<string> | null,
    banned_symbols: Set<string>
): TLockedTarget | null => {
    const recovering = !!locked_direction;
    const eligible = entries.filter(e => {
        if (allowed_symbols && !allowed_symbols.has(e.symbol)) return false;
        // Market bans disabled
        if (e.count < requiredStreak(settings)) return false;
        if (last && e.symbol === last.symbol && e.digit === last.digit) return false;
        // Always skip last market while recovering; also skip on reversal style
        if (recovering && last_market && e.symbol === last_market) return false;
        if (settings.strategy === 'reversal' && last_market && e.symbol === last_market) return false;

        const trade_dir = resolveTradeDirection(e.direction, settings.strategy);
        // Only 012 → under / 789 → over; even/odd uses same digit set
        if (!digitAllowsTrade(e.digit, settings.mode, trade_dir)) return false;

        // Recovery: only setups that produce the locked trade direction
        if (locked_direction && trade_dir !== locked_direction) return false;
        return true;
    });
    if (!eligible.length) return null;
    const best = [...eligible].sort(
        (a, b) =>
            scoreSetup(b, last_market) - scoreSetup(a, last_market) ||
            b.count - a.count ||
            a.symbol.localeCompare(b.symbol)
    )[0];
    const trade_direction = resolveTradeDirection(best.direction, settings.strategy);
    return {
        symbol: best.symbol,
        display_name: best.display_name,
        digit: best.digit,
        streak_direction: best.direction,
        trade_direction,
        contract_type: CONTRACT_BY_DIRECTION[trade_direction],
        count: best.count,
    };
};

const stillValid = (target: TLockedTarget, entries: TScanEntry[], min_streak: number): boolean => {
    const row = entries.find(e => e.symbol === target.symbol && e.digit === target.digit);
    // Allow brief streak flicker so we do not drop an armed setup before the buy lands.
    if (!row) return true;
    if (row.direction !== target.streak_direction) return false;
    return row.count >= Math.max(1, min_streak - 1);
};

// ---------------------------------------------------------------------------
// Module-level singleton. Lives for the lifetime of the page so switching
// tabs away from Custom Bots does not stop trades, drop the lock, or wipe
// the session log — the tab just re-subscribes to whatever is already running.
// ---------------------------------------------------------------------------
const listeners = new Set<() => void>();

let snapshot: TEngineSnapshot = {
    settings: loadCustomBotSettings(),
    status: 'idle',
    phase: 'hunting',
    target: null,
    stake: loadCustomBotSettings().initial_stake,
    loss_streak: 0,
    session_profit: 0,
    log: [],
    stop_reason: null,
    status_message: '',
    recovery_direction: null,
    banned_symbols: [],
};

const notify = (patch: Partial<TEngineSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(l => l());
};

const running = { current: false };
const target = { current: null as TLockedTarget | null };
const stake = { current: snapshot.stake };
const loss_streak = { current: 0 };
const session_profit = { current: 0 };
const in_trade = { current: false };
const buying = { current: false };
const last_setup = { current: null as TLastSetup | null };
const last_market = { current: null as string | null };
const locked_direction = { current: null as TScanDirection | null };
/** Markets banned until a win (Custom Pro recovery). */

const banned_markets = { current: new Set<string>() };

/** Fresh proposal id so buy is one hop when the anchor digit prints. */
type TCachedProposal = {
    id: string;
    symbol: string;
    contract_type: string;
    stake: number;
    ts: number;
};
const cached_proposal = { current: null as TCachedProposal | null };
let proposal_refresh_timer: ReturnType<typeof setInterval> | null = null;

const stopProposalRefresh = () => {
    if (proposal_refresh_timer) {
        clearInterval(proposal_refresh_timer);
        proposal_refresh_timer = null;
    }
};

const buildProposalRequest = (locked: TLockedTarget, bought_stake: number) => {
    const s = snapshot.settings;
    const proposal_request: Record<string, unknown> = {
        proposal: 1,
        amount: bought_stake,
        basis: 'stake',
        contract_type: locked.contract_type,
        currency: currency.current || 'USD',
        duration: 1,
        duration_unit: 't',
        underlying_symbol: locked.symbol,
    };
    if (s.mode === 'overunder') proposal_request.barrier = s.threshold_digit;
    return proposal_request;
};

const prefetchProposal = async (locked: TLockedTarget) => {
    if (!api_base.api || api_base.api.connection?.readyState !== 1) return;
    if (!running.current || in_trade.current || buying.current) return;
    if (!target.current || target.current.symbol !== locked.symbol) return;
    try {
        const bought_stake = stake.current;
        const proposal_res = await api_base.api.send(buildProposalRequest(locked, bought_stake));
        if (proposal_res?.error) return;
        const proposal_id = proposal_res?.proposal?.id;
        if (!proposal_id) return;
        if (!target.current || target.current.symbol !== locked.symbol) return;
        cached_proposal.current = {
            id: proposal_id,
            symbol: locked.symbol,
            contract_type: locked.contract_type,
            stake: bought_stake,
            ts: Date.now(),
        };
    } catch {
        // non-fatal
    }
};

const startProposalRefresh = (locked: TLockedTarget) => {
    stopProposalRefresh();
    cached_proposal.current = null;
    void prefetchProposal(locked);
    proposal_refresh_timer = setInterval(() => {
        if (!running.current || in_trade.current || buying.current) return;
        if (!target.current) return;
        void prefetchProposal(target.current);
    }, 4000);
};

const last_epoch = { current: null as number | null };
const currency = { current: 'USD' };
const symbols = { current: [] as TSymbolOption[] };
const pending_subs = new Set<{ unsubscribe: () => void }>();
let tick_unsub: (() => void) | null = null;
let scanner_unsub: (() => void) | null = null;

const entriesNow = () => getMarketScannerSnapshot().entries;

const setLockedTarget = (next: TLockedTarget | null) => {
    target.current = next;
    notify({
        target: next,
        phase: next ? 'armed' : running.current ? 'hunting' : snapshot.phase,
    });
    if (next) {
        startProposalRefresh(next);
    } else {
        stopProposalRefresh();
        cached_proposal.current = null;
    }
};

const hunt = () => {
    if (!running.current || in_trade.current || buying.current) return;
    const s = snapshot.settings;
    const active = resolveActiveSymbols(symbols.current, s);
    if (active.length) {
        startMarketScanner(active, s.mode, s.threshold_digit);
    }
    const allowed = active.length ? new Set(active.map(x => x.symbol)) : null;
    const next = pickTarget(
        entriesNow(),
        s,
        last_setup.current,
        last_market.current,
        locked_direction.current,
        allowed,
        banned_markets.current
    );
    if (next) {
        // Lock direction on the first trade of a sequence
        if (!locked_direction.current) {
            locked_direction.current = next.trade_direction;
        }
        setLockedTarget(next);
        notify({
            status_message: `Armed digit ${next.digit} — waiting for it to appear again, then ${next.trade_direction.toUpperCase()}`,
        });
        // Do NOT buy yet. Custom Pro waits until the anchor digit prints again,
        // then places the 1-tick trade (continuation or reversal of the pattern).
    } else {
        setLockedTarget(null);
        notify({ phase: 'waiting' });
    }
};

const checkLimits = (): string | null => {
    const s = snapshot.settings;
    if (s.take_profit > 0 && session_profit.current >= s.take_profit) return 'take_profit';
    if (s.stop_loss > 0 && session_profit.current <= -s.stop_loss) return 'stop_loss';
    return null;
};

const stopEngine = (reason?: string) => {
    stopProposalRefresh();
    cached_proposal.current = null;
    running.current = false;
    in_trade.current = false;
    buying.current = false;
    target.current = null;
    locked_direction.current = null;
    tick_unsub?.();
    tick_unsub = null;
    scanner_unsub?.();
    scanner_unsub = null;
    // Contracts that never reach `is_sold` (dropped subscription, forgotten
    // server-side) would otherwise keep their listener attached forever,
    // inspecting every future WS message. The set was tracked but never
    // drained anywhere, so this was a dead safety net until now.
    pending_subs.forEach(sub => sub.unsubscribe());
    pending_subs.clear();
    notify({
        target: null,
        phase: 'hunting',
        status: 'stopped',
        stop_reason: reason ?? snapshot.stop_reason,
    });
};

const onSettled = (won: boolean, profit: number, traded: TLockedTarget) => {
    in_trade.current = false;
    buying.current = false;

    session_profit.current += profit;
    notify({ session_profit: session_profit.current });

    last_setup.current = { symbol: traded.symbol, digit: traded.digit };
    last_market.current = traded.symbol;

    const limit = checkLimits();
    if (limit) {
        locked_direction.current = null;
        banned_markets.current.clear();
        notify({ recovery_direction: null, banned_symbols: [] });
        stopEngine(limit);
        return;
    }
    if (!running.current) return;

    if (won) {
        // Custom Pro: win resets recovery — clear bans, unlock direction, base stake
        loss_streak.current = 0;
        stake.current = roundStake(snapshot.settings.initial_stake);
        locked_direction.current = null;
        banned_markets.current.clear();
        notify({
            loss_streak: 0,
            stake: stake.current,
            recovery_direction: null,
            banned_symbols: [],
            status_message: '',
        });
    } else {
        const next_losses = loss_streak.current + 1;
        loss_streak.current = next_losses;
        // Lock trade direction for recovery (markets are NOT banned after a loss)
        if (!locked_direction.current) {
            locked_direction.current = traded.trade_direction;
        }
        if (next_losses >= snapshot.settings.max_martingale_steps) {
            locked_direction.current = null;
            banned_markets.current.clear();
            notify({
                loss_streak: next_losses,
                recovery_direction: null,
                banned_symbols: [],
            });
            stopEngine('max_martingale');
            return;
        }
        stake.current = roundStake(
            snapshot.settings.initial_stake * Math.pow(snapshot.settings.martingale_mult, next_losses)
        );
        notify({
            loss_streak: next_losses,
            stake: stake.current,
            recovery_direction: locked_direction.current,
            banned_symbols: [...banned_markets.current],
            status_message: `Recovering ${locked_direction.current?.toUpperCase() || ''} on next best market`,
        });
    }

    setLockedTarget(null);
    hunt();
};

const appendLog = (entry: TCustomTradeLog) => notify({ log: [entry, ...snapshot.log].slice(0, 80) });
const patchLog = (id: string, patch: Partial<TCustomTradeLog>) =>
    notify({ log: snapshot.log.map(e => (e.id === id ? { ...e, ...patch } : e)) });

const trackContract = (contract_id: number, log_id: string, traded: TLockedTarget, bought_stake: number) => {
    if (!api_base.api) return;
    const subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
        if (data?.msg_type !== 'proposal_open_contract') return;
        const poc = data.proposal_open_contract;
        if (!poc || poc.contract_id !== contract_id || !poc.is_sold) return;

        const profit = Number(poc.sell_price ?? poc.bid_price ?? 0) - Number(poc.buy_price ?? bought_stake);
        const won = profit > 0;
        // Resulting digit from the exit tick so the log proves the contract outcome
        let result_digit: number | undefined;
        try {
            const exit_raw = poc.exit_tick ?? poc.exit_spot ?? poc.sell_spot;
            if (exit_raw !== undefined && exit_raw !== null && exit_raw !== '') {
                const pip_size =
                    api_base?.pip_sizes?.[traded.symbol] ??
                    String(exit_raw).split('.')[1]?.length ??
                    2;
                result_digit = Number(getLastDigitForList(Number(exit_raw), pip_size));
            }
        } catch {
            result_digit = undefined;
        }
        patchLog(log_id, {
            status: won ? 'won' : 'lost',
            profit,
            ...(result_digit !== undefined && !Number.isNaN(result_digit) ? { result_digit } : {}),
        });

        subscription.unsubscribe();
        pending_subs.delete(subscription);
        onSettled(won, profit, traded);
    });
    pending_subs.add(subscription);
    api_base.api.send({ proposal_open_contract: 1, contract_id, subscribe: 1 });
};

const buyNow = async (locked: TLockedTarget) => {
    if (buying.current || in_trade.current) return;
    buying.current = true;
    in_trade.current = true;
    notify({ phase: 'in_trade' });

    const s = snapshot.settings;
    const bought_stake = stake.current;
    const log_id = `${locked.symbol}-${locked.digit}-${Date.now()}`;
    appendLog({
        id: log_id,
        time: Date.now(),
        symbol: locked.symbol,
        display_name: locked.display_name,
        digit: locked.digit,
        contract_type: locked.contract_type,
        strategy: s.strategy,
        stake: bought_stake,
        status: 'pending',
    });

    if (!api_base.api || api_base.api.connection?.readyState !== 1) {
        patchLog(log_id, { status: 'failed', fail_reason: 'Connection is not ready' });
        buying.current = false;
        in_trade.current = false;
        running.current = false;
        notify({ status: 'error', status_message: 'Connection is not ready.' });
        return;
    }

    try {
        stopProposalRefresh();
        let proposal_id: string | undefined;
        const cached = cached_proposal.current;
        const cache_ok =
            cached &&
            cached.symbol === locked.symbol &&
            cached.contract_type === locked.contract_type &&
            Math.abs(cached.stake - bought_stake) < 0.001 &&
            Date.now() - cached.ts < 12000;

        if (cache_ok) {
            proposal_id = cached.id;
        } else {
            const proposal_res = await api_base.api.send(buildProposalRequest(locked, bought_stake));
            if (proposal_res?.error) throw new Error(proposal_res.error.message || 'Proposal failed');
            proposal_id = proposal_res?.proposal?.id;
            if (!proposal_id) throw new Error('No proposal returned');
        }
        cached_proposal.current = null;

        const buy_res = await api_base.api.send({ buy: proposal_id, price: bought_stake });
        if (buy_res?.error) {
            if (cache_ok) {
                const proposal_res = await api_base.api.send(buildProposalRequest(locked, bought_stake));
                if (proposal_res?.error) throw new Error(proposal_res.error.message || 'Proposal failed');
                proposal_id = proposal_res?.proposal?.id;
                if (!proposal_id) throw new Error('No proposal returned');
                const buy_res2 = await api_base.api.send({ buy: proposal_id, price: bought_stake });
                if (buy_res2?.error) throw new Error(buy_res2.error.message || 'Buy was rejected');
                const contract_id2 = buy_res2?.buy?.contract_id;
                if (!contract_id2) throw new Error('No contract id returned');
                trackContract(contract_id2, log_id, locked, bought_stake);
                return;
            }
            throw new Error(buy_res.error.message || 'Buy was rejected');
        }
        const contract_id = buy_res?.buy?.contract_id;
        if (!contract_id) throw new Error('No contract id returned');

        trackContract(contract_id, log_id, locked, bought_stake);
    } catch (err: any) {
        patchLog(log_id, { status: 'failed', fail_reason: err?.message || 'Trade failed' });
        buying.current = false;
        in_trade.current = false;
        last_setup.current = { symbol: locked.symbol, digit: locked.digit };
        setLockedTarget(null);
        if (running.current) hunt();
    }
};

const attachTickListener = () => {
    if (tick_unsub || !api_base.api) return;
    const normalize = (s: string) => (s || '').trim().toUpperCase();
    const sub = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
        if (!running.current) return;
        if (data?.msg_type !== 'tick') return;
        const locked = target.current;
        if (!locked || in_trade.current || buying.current) return;

        const raw_symbol = data?.tick?.symbol;
        if (!raw_symbol || normalize(raw_symbol) !== normalize(locked.symbol)) return;

        const epoch = Number(data.tick.epoch);
        if (epoch && epoch === last_epoch.current) return;
        last_epoch.current = epoch || null;

        const pip_size =
            api_base?.pip_sizes?.[locked.symbol] ??
            String(data.tick.quote).split('.')[1]?.length ??
            2;
        const digit = Number(getLastDigitForList(Number(data.tick.quote), pip_size));

        // Core rule: only execute when the anchor digit appears again.
        // Example: streak is "after 4 → OVER". When 4 prints, buy OVER/UNDER for the next tick.
        if (digit !== locked.digit) return;

        void buyNow(locked);
    });
    tick_unsub = () => sub.unsubscribe();
};

const attachScannerListener = () => {
    if (scanner_unsub) return;
    scanner_unsub = subscribeMarketScanner(() => {
        if (!running.current || in_trade.current || buying.current) return;
        const locked = target.current;
        if (locked) {
            // Stay armed until the anchor digit appears (or user stops).
            // Only cancel if the pattern direction clearly flipped against the lock.
            const row = entriesNow().find(
                e => e.symbol === locked.symbol && e.digit === locked.digit
            );
            if (row && row.direction && row.direction !== locked.streak_direction) {
                setLockedTarget(null);
                hunt();
            }
            return;
        }
        hunt();
    });
};

const startEngine = (
    next_currency: string,
    next_symbols: TSymbolOption[],
    lock_direction: TScanDirection | null = null
) => {
    if (running.current) return;
    currency.current = next_currency || 'USD';
    symbols.current = next_symbols;
    running.current = true;
    in_trade.current = false;
    buying.current = false;
    loss_streak.current = 0;
    session_profit.current = 0;
    last_setup.current = null;
    last_market.current = null;
    banned_markets.current.clear();
    // Applied here, before the one and only hunt() call below, so the very
    // first pick already respects the direction — never picking a target
    // and then immediately re-picking a different one once a lock lands
    // (see startCustomEngineFromSignal for why that used to happen).
    locked_direction.current = lock_direction;
    last_epoch.current = null;
    stake.current = roundStake(snapshot.settings.initial_stake);

    const s = snapshot.settings;
    const active = resolveActiveSymbols(next_symbols, s);
    if (active.length) startMarketScanner(active, s.mode, s.threshold_digit);

    notify({
        stake: stake.current,
        loss_streak: 0,
        session_profit: 0,
        stop_reason: null,
        status_message: '',
        log: [],
        status: 'running',
        phase: 'hunting',
        target: null,
        recovery_direction: lock_direction,
        banned_symbols: [],
    });
    setLockedTarget(null);
    attachScannerListener();
    attachTickListener();
    hunt();
};

const updateSettings = (patch: Partial<TCustomBotSettings>) => {
    const next = { ...snapshot.settings, ...patch };
    saveCustomBotSettings(patch);
    notify({ settings: next });
};

const subscribeEngine = (onStoreChange: () => void) => {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
        // Never stop the engine here. Tab unmount is not Stop.
    };
};


/**
 * Start (or restart) the continuous Custom Bots engine from Digit Pattern / Signals.
 * Applies the given risk + mode settings, optionally locks a trade direction,
 * then runs the same multi-market hunter that the Custom Bots tab uses —
 * so trades appear in the session log and martingale recovery works.
 */
export const startCustomEngineFromSignal = (params: {
    currency?: string;
    symbols: TSymbolOption[];
    mode: TScanMode;
    strategy: TCustomStrategy;
    threshold_digit: number;
    min_streak?: number;
    initial_stake: number;
    martingale_mult: number;
    max_martingale_steps: number;
    stop_loss: number;
    take_profit: number;
    /** If set, keep trading this direction during the first recovery sequence */
    lock_direction?: TScanDirection | null;
}) => {
    const patch: Partial<TCustomBotSettings> = {
        mode: params.mode,
        strategy: params.strategy,
        threshold_digit: params.threshold_digit,
        min_streak: params.min_streak ?? snapshot.settings.min_streak,
        initial_stake: params.initial_stake,
        martingale_mult: params.martingale_mult,
        max_martingale_steps: params.max_martingale_steps,
        stop_loss: params.stop_loss,
        take_profit: params.take_profit,
    };
    updateSettings(patch);

    if (running.current) {
        stopEngine('restart_from_signal');
    }

    // Pass the lock straight into startEngine so its single internal hunt()
    // call already respects it from the first pick - no second hunt() call
    // here, which previously overwrote whatever startEngine's own hunt()
    // had just locked in, silently swapping the target before any trade
    // ever happened.
    const lock = params.lock_direction ?? null;
    startEngine(params.currency || 'USD', params.symbols, lock);
};

export const useCustomBotEngine = (next_currency: string, next_symbols: TSymbolOption[]) => {
    const state = useSyncExternalStore(subscribeEngine, () => snapshot);

    useEffect(() => {
        currency.current = next_currency || 'USD';
        if (next_symbols.length) symbols.current = next_symbols;
    }, [next_currency, next_symbols]);

    const start = useCallback(() => startEngine(next_currency, next_symbols), [next_currency, next_symbols]);
    const stop = useCallback(() => stopEngine(), []);
    const patchSettings = useCallback((patch: Partial<TCustomBotSettings>) => updateSettings(patch), []);

    return {
        settings: state.settings,
        updateSettings: patchSettings,
        status: state.status,
        phase: state.phase,
        target: state.target,
        stake: state.stake,
        loss_streak: state.loss_streak,
        session_profit: state.session_profit,
        log: state.log,
        stop_reason: state.stop_reason,
        status_message: state.status_message,
        recovery_direction: state.recovery_direction,
        banned_symbols: state.banned_symbols,
        start,
        stop,
    };
};
