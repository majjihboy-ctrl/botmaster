import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import { TAccount, TTradeLog } from '../auto-trades/auto-trades-engine';
import {
    afterTrade,
    contractFor,
    currentStreak,
    initialTracker,
    needsBarrier,
    roundMoney,
    stakeAfterLosses,
    stopReason,
    TLossTracker,
    TSettings,
} from '../auto-trades/engine-logic';
import { MAX_MARKETS, roundOutcome } from './combo-logic';

/**
 * Combo runtime: when ANY selected market completes the streak, one trade is placed on EVERY
 * selected market at once. Martingale steps up only when the whole round loses.
 * Same safety rules as Auto Trades: one round at a time, account re-checked before buying,
 * only live ticks trigger, nothing is retried automatically, every stop path unsubscribes.
 */

export type TStatus = 'idle' | 'starting' | 'running' | 'stopped';
export type TSnapshot = {
    status: TStatus;
    message: string;
    stop_reason: string | null;
    session_profit: number;
    rounds: number;
    rounds_lost: number;
    next_stake: number;
    loss_run: number;
    cooldown_left: number;
    in_round: boolean;
    streaks: Record<string, number>;
    log: TTradeLog[];
};

const SETTLE_TIMEOUT_MS = 90_000;
const SETTLE_POLL_MS = 4_000;
const DIGITS_KEPT = 30;

const blank = (): TSnapshot => ({
    status: 'idle',
    message: '',
    stop_reason: null,
    session_profit: 0,
    rounds: 0,
    rounds_lost: 0,
    next_stake: 0,
    loss_run: 0,
    cooldown_left: 0,
    in_round: false,
    streaks: {},
    log: [],
});

let snapshot = blank();
const listeners = new Set<() => void>();
let settings: TSettings | null = null;
let getAccount: (() => TAccount | null) | null = null;
let started_account: TAccount | null = null;
let symbols: string[] = [];
let digits = new Map<string, number[]>();
let tracker: TLossTracker = initialTracker();
let busy = false;
let generation = 0;
let tick_sub: { unsubscribe: () => void } | null = null;
let tick_ids: string[] = [];
let cleanups = new Set<() => void>();

const emit = (patch: Partial<TSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(l => l());
};
export const subscribeCombo = (l: () => void) => {
    listeners.add(l);
    return () => {
        listeners.delete(l);
    };
};
export const getComboSnapshot = () => snapshot;

const teardown = () => {
    tick_sub?.unsubscribe();
    tick_sub = null;
    tick_ids.forEach(id => api_base.api?.send({ forget: id }).catch(() => {}));
    tick_ids = [];
    cleanups.forEach(c => c());
    cleanups = new Set();
};

export const stopCombo = (reason = 'user', message = '') => {
    if (snapshot.status !== 'running' && snapshot.status !== 'starting') return;
    generation += 1;
    teardown();
    busy = false;
    emit({ status: 'stopped', stop_reason: reason, message, in_round: false });
};

export const resetCombo = () => {
    if (snapshot.status === 'running' || snapshot.status === 'starting') return;
    snapshot = blank();
    listeners.forEach(l => l());
};

const patchLog = (id: string, patch: Partial<TTradeLog>) =>
    emit({ log: snapshot.log.map(e => (e.id === id ? { ...e, ...patch } : e)) });

const streaksNow = () => {
    const out: Record<string, number> = {};
    symbols.forEach(s => {
        out[s] = settings ? currentStreak(digits.get(s) ?? [], settings.signal, settings.barrier) : 0;
    });
    return out;
};

/** Resolves with the profit once the contract settles, or rejects on timeout. */
const settle = (contract_id: number, buy_price: number, my_generation: number) =>
    new Promise<number>((resolve, reject) => {
        let done = false;
        let poll: ReturnType<typeof setInterval> | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let sub: { unsubscribe: () => void } | undefined;
        const cleanup = () => {
            done = true;
            if (poll) clearInterval(poll);
            if (timer) clearTimeout(timer);
            sub?.unsubscribe();
            cleanups.delete(cleanup);
        };
        cleanups.add(cleanup);
        const finish = (poc: any) => {
            if (done || my_generation !== generation) return;
            cleanup();
            resolve(roundMoney(Number(poc.sell_price ?? poc.bid_price ?? 0) - Number(poc.buy_price ?? buy_price)));
        };
        sub = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
            const poc = data?.proposal_open_contract;
            if (data?.msg_type === 'proposal_open_contract' && poc?.contract_id === contract_id && poc.is_sold) {
                finish(poc);
            }
        });
        api_base.api.send({ proposal_open_contract: 1, contract_id, subscribe: 1 }).catch(() => {});
        poll = setInterval(async () => {
            try {
                const res = await api_base.api.send({ proposal_open_contract: 1, contract_id });
                if (res?.proposal_open_contract?.is_sold) finish(res.proposal_open_contract);
            } catch {
                // the timeout decides
            }
        }, SETTLE_POLL_MS);
        timer = setTimeout(() => {
            if (done) return;
            cleanup();
            reject(new Error('Result not received'));
        }, SETTLE_TIMEOUT_MS);
    });

const runRound = async () => {
    if (!settings || busy) return;
    busy = true; // before any await: two ticks can never start two rounds
    const my_generation = generation;
    const s = settings;

    const account = getAccount?.() ?? null;
    if (!account || !started_account || account.loginid !== started_account.loginid) {
        stopCombo('account_changed', 'The active account changed, so Combo stopped.');
        return;
    }

    const contract = contractFor(s.signal, s.mode);
    const stake = stakeAfterLosses(s, tracker.losses_in_a_row);
    const stamp = Date.now();
    const rows: TTradeLog[] = symbols.map(sym => ({
        id: `${stamp}-${sym}`,
        time: stamp,
        symbol: sym,
        contract,
        stake,
    }));
    emit({ in_round: true, message: `Round on ${symbols.length} markets`, log: [...rows, ...snapshot.log].slice(0, 100) });

    const proposalFor = (sym: string) => {
        const req: Record<string, unknown> = {
            proposal: 1,
            amount: stake,
            basis: 'stake',
            contract_type: contract,
            currency: account.currency || 'USD',
            duration: 1,
            duration_unit: 't',
            underlying_symbol: sym,
        };
        if (needsBarrier(contract)) req.barrier = s.barrier;
        return api_base.api.send(req);
    };

    try {
        // Price every market first. If ANY proposal fails, buy nothing.
        const proposals = await Promise.all(symbols.map(proposalFor));
        if (my_generation !== generation) return;
        const bad = proposals.findIndex(p => p?.error || !p?.proposal?.id);
        if (bad >= 0) throw new Error(proposals[bad]?.error?.message || `No proposal for ${symbols[bad]}`);

        const again = getAccount?.() ?? null;
        if (!again || again.loginid !== started_account!.loginid) {
            stopCombo('account_changed', 'The active account changed, so Combo stopped.');
            return;
        }

        const buys = await Promise.allSettled(
            proposals.map(p => api_base.api.send({ buy: p.proposal.id, price: stake }))
        );
        if (my_generation !== generation) return;

        let failed_buys = 0;
        const settles: Promise<number>[] = [];
        buys.forEach((b, i) => {
            const res: any = b.status === 'fulfilled' ? b.value : null;
            if (!res || res.error || !res.buy?.contract_id) {
                failed_buys += 1;
                patchLog(rows[i].id, { error: res?.error?.message || 'Buy was rejected' });
                return;
            }
            const p = settle(res.buy.contract_id, Number(res.buy.buy_price ?? stake), my_generation);
            settles.push(
                p.then(profit => {
                    patchLog(rows[i].id, { profit, won: profit > 0 });
                    return profit;
                })
            );
        });
        if (settles.length === 0) throw new Error('Every buy was rejected');

        const profits = await Promise.all(settles);
        if (my_generation !== generation) return;

        const { net, all_lost } = roundOutcome(profits);
        tracker = afterTrade(tracker, !all_lost);
        const session_profit = roundMoney(snapshot.session_profit + net);
        busy = false;
        emit({
            session_profit,
            rounds: snapshot.rounds + 1,
            rounds_lost: snapshot.rounds_lost + (all_lost ? 1 : 0),
            loss_run: tracker.losses_in_a_row,
            cooldown_left: tracker.cooldown_left,
            next_stake: stakeAfterLosses(s, tracker.losses_in_a_row),
            in_round: false,
        });
        if (failed_buys > 0) {
            stopCombo('error', 'Some trades in the last round were rejected. Check your Deriv statement.');
            return;
        }
        const why = stopReason(s, session_profit, tracker.losses_in_a_row);
        if (why) stopCombo(why);
    } catch (err: any) {
        stopCombo('error', err?.message || 'Round failed. Check your Deriv statement before restarting.');
    }
};

const onTick = (symbol: string, quote: number) => {
    if (!settings || snapshot.status !== 'running') return;
    const pip = api_base?.pip_sizes?.[symbol] ?? String(quote).split('.')[1]?.length ?? 2;
    const list = digits.get(symbol) ?? [];
    list.push(Number(getLastDigitForList(quote, pip)));
    if (list.length > DIGITS_KEPT) list.splice(0, list.length - DIGITS_KEPT);
    digits.set(symbol, list);

    if (symbol === symbols[0] && tracker.cooldown_left > 0) {
        tracker = { ...tracker, cooldown_left: tracker.cooldown_left - 1 };
    }
    emit({ streaks: streaksNow(), cooldown_left: tracker.cooldown_left });
    if (busy || tracker.cooldown_left > 0) return;
    if (currentStreak(list, settings.signal, settings.barrier) >= settings.streak) {
        symbols.forEach(s => digits.set(s, [])); // one trigger, one round
        runRound();
    }
};

export const startCombo = async (next: TSettings, markets: string[], account_getter: () => TAccount | null) => {
    if (snapshot.status === 'running' || snapshot.status === 'starting') return;
    const fail = (message: string) => emit({ ...blank(), status: 'stopped', stop_reason: 'error', message });
    const account = account_getter();
    if (!account) return fail('Log in to trade.');
    if (!api_base.api || api_base.api.connection?.readyState !== 1) return fail('Connection is not ready yet.');
    if (markets.length < 2) return fail('Pick at least two markets for a combo.');
    if (markets.length > MAX_MARKETS) return fail(`Pick at most ${MAX_MARKETS} markets.`);

    generation += 1;
    const my_generation = generation;
    settings = next;
    getAccount = account_getter;
    started_account = account;
    symbols = markets.slice();
    digits = new Map(symbols.map(m => [m, []]));
    tracker = initialTracker();
    busy = false;
    snapshot = { ...blank(), status: 'starting', next_stake: next.stake, message: 'Connecting to markets...' };
    listeners.forEach(l => l());

    const wanted = new Map(symbols.map(m => [m.toUpperCase(), m]));
    tick_sub = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
        if (my_generation !== generation || data?.msg_type !== 'tick') return;
        const sym = wanted.get(String(data?.tick?.symbol ?? '').toUpperCase());
        if (sym) onTick(sym, Number(data.tick.quote));
    });

    let live = 0;
    await Promise.all(
        symbols.map(async sym => {
            // Deriv reports "already subscribed" when another tab streams the market. Ticks still
            // reach us through onMessage, so that case counts as live.
            const alreadySubscribed = (e: any) =>
                e?.code === 'AlreadySubscribed' || /already subscribed/i.test(String(e?.message ?? ''));
            try {
                const res = await api_base.api.send({ ticks: sym, subscribe: 1 });
                if (res?.subscription?.id) tick_ids.push(res.subscription.id);
                if (!res?.error || alreadySubscribed(res.error)) live += 1;
            } catch (e: any) {
                if (alreadySubscribed(e?.error ?? e)) live += 1;
            }
        })
    );
    if (my_generation !== generation) return;
    // A combo needs EVERY market streaming, otherwise it would silently trade fewer markets.
    if (live < symbols.length) {
        generation += 1;
        teardown();
        emit({ status: 'stopped', stop_reason: 'error', message: 'Could not stream all selected markets.' });
        return;
    }
    emit({ status: 'running', message: `Watching ${live} markets`, streaks: streaksNow() });
};
