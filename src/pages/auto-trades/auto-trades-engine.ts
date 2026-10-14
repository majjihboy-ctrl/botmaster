import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import {
    afterTrade,
    contractFor,
    currentStreak,
    initialTracker,
    needsBarrier,
    roundMoney,
    stakeAfterLosses,
    stopReason,
    TContract,
    TLossTracker,
    TSettings,
    TStopReason,
} from './engine-logic';

/**
 * Auto Trades runtime. Module-level singleton so a running session survives switching
 * tabs (the Tabs component unmounts inactive tabs). The UI only subscribes to it.
 *
 * Safety rules enforced here, not in the UI:
 *  - one trade in flight at a time, guarded by a flag set BEFORE any await
 *  - the account is re-checked before every trade; a change stops the session
 *  - a contract that never settles stops the session instead of trading blind
 *  - every stop path unsubscribes ticks
 */

export type TAccount = { loginid: string; currency: string; is_virtual: boolean };
export type TStatus = 'idle' | 'starting' | 'running' | 'stopped';
export type TTradeLog = {
    id: string;
    time: number;
    symbol: string;
    contract: TContract;
    stake: number;
    profit?: number;
    won?: boolean;
    error?: string;
};

export type TSnapshot = {
    status: TStatus;
    message: string;
    stop_reason: TStopReason | 'account_changed' | 'error' | 'user' | null;
    session_profit: number;
    wins: number;
    losses: number;
    next_stake: number;
    loss_run: number;
    cooldown_left: number;
    in_trade: boolean;
    streaks: Record<string, number>;
    log: TTradeLog[];
};

const HISTORY_COUNT = 30;
const DIGITS_KEPT = 30;
const SETTLE_TIMEOUT_MS = 90_000;
const SETTLE_POLL_MS = 4_000;

const blank = (): TSnapshot => ({
    status: 'idle',
    message: '',
    stop_reason: null,
    session_profit: 0,
    wins: 0,
    losses: 0,
    next_stake: 0,
    loss_run: 0,
    cooldown_left: 0,
    in_trade: false,
    streaks: {},
    log: [],
});

let snapshot: TSnapshot = blank();
const listeners = new Set<() => void>();

let settings: TSettings | null = null;
let getAccount: (() => TAccount | null) | null = null;
let started_account: TAccount | null = null;
let symbols: string[] = [];
let digits = new Map<string, number[]>();
let tracker: TLossTracker = initialTracker();
let busy = false;
let last_symbol: string | null = null;
let generation = 0;
let tick_sub: { unsubscribe: () => void } | null = null;
let tick_ids: string[] = [];
let settle_cleanups = new Set<() => void>();

const emit = (patch: Partial<TSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(l => l());
};

export const subscribeAutoTrades = (l: () => void) => {
    listeners.add(l);
    return () => {
        listeners.delete(l);
    };
};
export const getAutoTradesSnapshot = () => snapshot;

const teardown = () => {
    tick_sub?.unsubscribe();
    tick_sub = null;
    tick_ids.forEach(id => api_base.api?.send({ forget: id }).catch(() => {}));
    tick_ids = [];
    settle_cleanups.forEach(c => c());
    settle_cleanups = new Set();
};

export const stopAutoTrades = (reason: TSnapshot['stop_reason'] = 'user', message = '') => {
    if (snapshot.status !== 'running' && snapshot.status !== 'starting') return;
    generation += 1;
    teardown();
    emit({
        status: 'stopped',
        stop_reason: reason,
        message,
        in_trade: false,
    });
};

const refreshStreaks = () => {
    if (!settings) return;
    const streaks: Record<string, number> = {};
    symbols.forEach(s => {
        streaks[s] = currentStreak(digits.get(s) ?? [], settings!.signal, settings!.barrier);
    });
    return streaks;
};

const appendLog = (entry: TTradeLog) => emit({ log: [entry, ...snapshot.log].slice(0, 100) });
const patchLog = (id: string, patch: Partial<TTradeLog>) =>
    emit({ log: snapshot.log.map(e => (e.id === id ? { ...e, ...patch } : e)) });

const onSettled = (log_id: string, profit: number) => {
    if (!settings) return;
    const won = profit > 0;
    patchLog(log_id, { profit, won });
    tracker = afterTrade(tracker, won);
    const session_profit = roundMoney(snapshot.session_profit + profit);
    busy = false;
    emit({
        session_profit,
        wins: snapshot.wins + (won ? 1 : 0),
        losses: snapshot.losses + (won ? 0 : 1),
        loss_run: tracker.losses_in_a_row,
        cooldown_left: tracker.cooldown_left,
        next_stake: stakeAfterLosses(settings, tracker.losses_in_a_row),
        in_trade: false,
    });
    const why = stopReason(settings, session_profit, tracker.losses_in_a_row);
    if (why) stopAutoTrades(why);
};

const trackContract = (contract_id: number, log_id: string, my_generation: number, buy_price: number) => {
    let done = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let sub: { unsubscribe: () => void } | undefined;

    const cleanup = () => {
        done = true;
        if (poll) clearInterval(poll);
        if (timeout) clearTimeout(timeout);
        sub?.unsubscribe();
        settle_cleanups.delete(cleanup);
    };
    settle_cleanups.add(cleanup);

    const finish = (poc: any) => {
        if (done || my_generation !== generation) return;
        cleanup();
        const sold = Number(poc.sell_price ?? poc.bid_price ?? 0);
        const paid = Number(poc.buy_price ?? buy_price);
        onSettled(log_id, roundMoney(sold - paid));
    };

    sub = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
        if (data?.msg_type !== 'proposal_open_contract') return;
        const poc = data.proposal_open_contract;
        if (poc?.contract_id === contract_id && poc.is_sold) finish(poc);
    });
    api_base.api.send({ proposal_open_contract: 1, contract_id, subscribe: 1 }).catch(() => {});

    // Fallback in case the stream drops: poll the contract state.
    poll = setInterval(async () => {
        try {
            const res = await api_base.api.send({ proposal_open_contract: 1, contract_id });
            if (res?.proposal_open_contract?.is_sold) finish(res.proposal_open_contract);
        } catch {
            // keep polling until the timeout decides
        }
    }, SETTLE_POLL_MS);

    timeout = setTimeout(() => {
        if (done || my_generation !== generation) return;
        cleanup();
        patchLog(log_id, { error: 'Result not received' });
        busy = false;
        stopAutoTrades('error', 'A trade result never arrived. Check your Deriv statement before restarting.');
    }, SETTLE_TIMEOUT_MS);
};

const placeTrade = async (symbol: string) => {
    if (!settings || busy) return;
    busy = true; // set before any await so two ticks can never both fire
    const my_generation = generation;
    last_symbol = symbol;

    const account = getAccount?.() ?? null;
    if (!account || !started_account || account.loginid !== started_account.loginid) {
        busy = false;
        stopAutoTrades('account_changed', 'The active account changed, so Auto Trades stopped.');
        return;
    }

    const contract = contractFor(settings.signal, settings.mode);
    const stake = stakeAfterLosses(settings, tracker.losses_in_a_row);
    const log_id = `${Date.now()}-${symbol}`;
    appendLog({ id: log_id, time: Date.now(), symbol, contract, stake });
    emit({ in_trade: true, message: `Trading ${symbol}` });

    try {
        const proposal_request: Record<string, unknown> = {
            proposal: 1,
            amount: stake,
            basis: 'stake',
            contract_type: contract,
            currency: account.currency || 'USD',
            duration: 1,
            duration_unit: 't',
            underlying_symbol: symbol,
        };
        if (needsBarrier(contract)) proposal_request.barrier = settings.barrier;

        const proposal = await api_base.api.send(proposal_request);
        if (my_generation !== generation) return;
        if (proposal?.error || !proposal?.proposal?.id) {
            throw new Error(proposal?.error?.message || 'No proposal returned');
        }
        // Re-check just before spending money: the user may have stopped or switched accounts.
        const again = getAccount?.() ?? null;
        if (my_generation !== generation || !again || again.loginid !== started_account.loginid) {
            busy = false;
            stopAutoTrades('account_changed', 'The active account changed, so Auto Trades stopped.');
            return;
        }
        const buy = await api_base.api.send({ buy: proposal.proposal.id, price: stake });
        if (buy?.error || !buy?.buy?.contract_id) throw new Error(buy?.error?.message || 'Buy was rejected');
        if (my_generation !== generation) return;
        trackContract(buy.buy.contract_id, log_id, my_generation, Number(buy.buy.buy_price ?? stake));
    } catch (err: any) {
        busy = false;
        patchLog(log_id, { error: err?.message || 'Trade failed' });
        // A failed order is never retried automatically: stop and let the user look.
        stopAutoTrades('error', err?.message || 'Trade failed');
    }
};

const onTick = (symbol: string, quote: number) => {
    if (!settings || snapshot.status !== 'running') return;
    const pip = api_base?.pip_sizes?.[symbol] ?? String(quote).split('.')[1]?.length ?? 2;
    const list = digits.get(symbol) ?? [];
    list.push(Number(getLastDigitForList(quote, pip)));
    if (list.length > DIGITS_KEPT) list.splice(0, list.length - DIGITS_KEPT);
    digits.set(symbol, list);

    if (symbol === last_symbol && tracker.cooldown_left > 0) {
        tracker = { ...tracker, cooldown_left: tracker.cooldown_left - 1 };
    }
    emit({ streaks: refreshStreaks(), cooldown_left: tracker.cooldown_left });

    if (busy || tracker.cooldown_left > 0) return;
    if (currentStreak(list, settings.signal, settings.barrier) >= settings.streak) {
        // Consume the streak so one run of digits triggers exactly one trade.
        digits.set(symbol, []);
        placeTrade(symbol);
    }
};

export const startAutoTrades = async (
    next_settings: TSettings,
    markets: string[],
    account_getter: () => TAccount | null
) => {
    if (snapshot.status === 'running' || snapshot.status === 'starting') return;
    const account = account_getter();
    if (!account) {
        emit({ ...blank(), status: 'stopped', stop_reason: 'error', message: 'Log in to trade.' });
        return;
    }
    if (!api_base.api || api_base.api.connection?.readyState !== 1) {
        emit({ ...blank(), status: 'stopped', stop_reason: 'error', message: 'Connection is not ready yet.' });
        return;
    }
    if (!markets.length) {
        emit({ ...blank(), status: 'stopped', stop_reason: 'error', message: 'Pick at least one market.' });
        return;
    }

    generation += 1;
    const my_generation = generation;
    settings = next_settings;
    getAccount = account_getter;
    started_account = account;
    symbols = markets;
    digits = new Map(markets.map(m => [m, []]));
    tracker = initialTracker();
    busy = false;
    last_symbol = null;
    snapshot = { ...blank(), status: 'starting', next_stake: next_settings.stake, message: 'Connecting to markets...' };
    listeners.forEach(l => l());

    const wanted = new Map(markets.map(m => [m.toUpperCase(), m]));
    tick_sub = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
        if (my_generation !== generation || data?.msg_type !== 'tick') return;
        const symbol = wanted.get(String(data?.tick?.symbol ?? '').toUpperCase());
        if (symbol) onTick(symbol, Number(data.tick.quote));
    });

    let live = 0;
    await Promise.all(
        markets.map(async symbol => {
            try {
                const hist = await api_base.api.send({
                    ticks_history: symbol,
                    count: HISTORY_COUNT,
                    end: 'latest',
                    style: 'ticks',
                });
                if (my_generation !== generation) return;
                // History only proves the market is reachable. Its digits are deliberately NOT used:
                // a streak that already existed before Start must never trigger a trade.
                if (!hist?.history?.prices?.length) return;
                try {
                    const res = await api_base.api.send({ ticks: symbol, subscribe: 1 });
                    if (res?.subscription?.id) tick_ids.push(res.subscription.id);
                } catch {
                    // Already streamed elsewhere; ticks still arrive via onMessage.
                }
                live += 1;
            } catch {
                // One market failing must not take the others down.
            }
        })
    );
    if (my_generation !== generation) return;
    if (live === 0) {
        generation += 1;
        teardown();
        emit({ status: 'stopped', stop_reason: 'error', message: 'Could not load any market data.' });
        return;
    }
    emit({
        status: 'running',
        message: `Watching ${live} market${live === 1 ? '' : 's'}`,
        streaks: refreshStreaks(),
    });
};

export const resetAutoTrades = () => {
    if (snapshot.status === 'running' || snapshot.status === 'starting') return;
    snapshot = blank();
    listeners.forEach(l => l());
};
