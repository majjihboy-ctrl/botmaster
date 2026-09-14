import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import { TScanDirection, TScanEntry, TScanMode } from '@/pages/digit-pattern/use-market-scanner';
import { opposite } from '@/pages/digit-pattern/launch-xml-bot';

export type TCustomStrategy = 'reversal' | 'continuation';
export type TEngineStatus = 'idle' | 'running' | 'stopped' | 'error';
export type TEnginePhase = 'hunting' | 'armed' | 'in_trade' | 'waiting';

export type TCustomBotSettings = {
    mode: TScanMode;
    strategy: TCustomStrategy;
    threshold_digit: number;
    min_streak: number;
    initial_stake: number;
    martingale_mult: number;
    max_martingale_steps: number;
    stop_loss: number;
    take_profit: number;
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
    digit: number;
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
    min_streak: 7,
    initial_stake: 0.35,
    martingale_mult: 2,
    max_martingale_steps: 6,
    stop_loss: 5,
    take_profit: 100,
};

export const loadCustomBotSettings = (): TCustomBotSettings => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...DEFAULT_CUSTOM_BOT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_CUSTOM_BOT_SETTINGS;
    } catch {
        return DEFAULT_CUSTOM_BOT_SETTINGS;
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

const entryKey = (symbol: string, digit: number) => `${symbol}:${digit}`;

type TLastSetup = { symbol: string; digit: number };

const pickTarget = (
    entries: TScanEntry[],
    settings: TCustomBotSettings,
    last: TLastSetup | null,
    last_market: string | null
): TLockedTarget | null => {
    const eligible = entries.filter(e => {
        if (e.count < settings.min_streak) return false;
        if (last && e.symbol === last.symbol && e.digit === last.digit) return false;
        // Reversal hops to another market so the next reverse isn't on the same index.
        if (settings.strategy === 'reversal' && last_market && e.symbol === last_market) return false;
        return true;
    });
    if (!eligible.length) return null;
    const best = eligible.reduce((a, b) => (b.count > a.count ? b : a));
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
    return !!row && row.count >= min_streak && row.direction === target.streak_direction;
};

export const useCustomBotEngine = (entries: TScanEntry[], currency: string) => {
    const [settings, setSettingsState] = useState<TCustomBotSettings>(() => loadCustomBotSettings());
    const [status, setStatus] = useState<TEngineStatus>('idle');
    const [phase, setPhase] = useState<TEnginePhase>('hunting');
    const [target, setTarget] = useState<TLockedTarget | null>(null);
    const [stake, setStake] = useState(settings.initial_stake);
    const [loss_streak, setLossStreak] = useState(0);
    const [session_profit, setSessionProfit] = useState(0);
    const [log, setLog] = useState<TCustomTradeLog[]>([]);
    const [stop_reason, setStopReason] = useState<string | null>(null);
    const [status_message, setStatusMessage] = useState('');

    const settings_ref = useRef(settings);
    const entries_ref = useRef(entries);
    const currency_ref = useRef(currency);
    const running_ref = useRef(false);
    const target_ref = useRef<TLockedTarget | null>(null);
    const stake_ref = useRef(settings.initial_stake);
    const loss_streak_ref = useRef(0);
    const session_profit_ref = useRef(0);
    const in_trade_ref = useRef(false);
    const buying_ref = useRef(false);
    const last_setup_ref = useRef<TLastSetup | null>(null);
    const last_market_ref = useRef<string | null>(null);
    const last_epoch_ref = useRef<number | null>(null);
    const pending_subs_ref = useRef<Set<{ unsubscribe: () => void }>>(new Set());

    useEffect(() => {
        settings_ref.current = settings;
    }, [settings]);
    useEffect(() => {
        entries_ref.current = entries;
    }, [entries]);
    useEffect(() => {
        currency_ref.current = currency;
    }, [currency]);

    const updateSettings = useCallback((patch: Partial<TCustomBotSettings>) => {
        setSettingsState(prev => {
            const next = { ...prev, ...patch };
            saveCustomBotSettings(patch);
            return next;
        });
    }, []);

    const appendLog = (entry: TCustomTradeLog) => setLog(prev => [entry, ...prev].slice(0, 80));
    const patchLog = (id: string, patch: Partial<TCustomTradeLog>) =>
        setLog(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));

    const setLockedTarget = (next: TLockedTarget | null) => {
        target_ref.current = next;
        setTarget(next);
        if (next) setPhase('armed');
        else if (running_ref.current) setPhase('hunting');
    };

    const hunt = useCallback(() => {
        if (!running_ref.current || in_trade_ref.current || buying_ref.current) return;
        const next = pickTarget(
            entries_ref.current,
            settings_ref.current,
            last_setup_ref.current,
            last_market_ref.current
        );
        if (next) {
            setLockedTarget(next);
            setStatusMessage('');
        } else {
            setLockedTarget(null);
            setPhase('waiting');
        }
    }, []);

    const stop = useCallback((reason?: string) => {
        running_ref.current = false;
        in_trade_ref.current = false;
        buying_ref.current = false;
        target_ref.current = null;
        setTarget(null);
        setPhase('hunting');
        setStatus('stopped');
        if (reason) setStopReason(reason);
    }, []);

    const checkLimits = (): string | null => {
        const s = settings_ref.current;
        if (s.take_profit > 0 && session_profit_ref.current >= s.take_profit) return 'take_profit';
        if (s.stop_loss > 0 && session_profit_ref.current <= -s.stop_loss) return 'stop_loss';
        return null;
    };

    const onSettled = useCallback(
        (won: boolean, profit: number, traded: TLockedTarget) => {
            in_trade_ref.current = false;
            buying_ref.current = false;

            session_profit_ref.current += profit;
            setSessionProfit(session_profit_ref.current);

            last_setup_ref.current = { symbol: traded.symbol, digit: traded.digit };
            if (settings_ref.current.strategy === 'reversal') {
                last_market_ref.current = traded.symbol;
            } else {
                last_market_ref.current = null;
            }

            const limit = checkLimits();
            if (limit) {
                stop(limit);
                return;
            }
            if (!running_ref.current) return;

            if (won) {
                loss_streak_ref.current = 0;
                setLossStreak(0);
                stake_ref.current = roundStake(settings_ref.current.initial_stake);
                setStake(stake_ref.current);
            } else {
                const next_losses = loss_streak_ref.current + 1;
                loss_streak_ref.current = next_losses;
                setLossStreak(next_losses);
                if (next_losses >= settings_ref.current.max_martingale_steps) {
                    stop('max_martingale');
                    return;
                }
                stake_ref.current = roundStake(
                    settings_ref.current.initial_stake * Math.pow(settings_ref.current.martingale_mult, next_losses)
                );
                setStake(stake_ref.current);
            }

            setLockedTarget(null);
            hunt();
        },
        [hunt, stop]
    );

    const trackContract = useCallback(
        (contract_id: number, log_id: string, traded: TLockedTarget, bought_stake: number) => {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                if (data?.msg_type !== 'proposal_open_contract') return;
                const poc = data.proposal_open_contract;
                if (!poc || poc.contract_id !== contract_id || !poc.is_sold) return;

                const profit = Number(poc.sell_price ?? poc.bid_price ?? 0) - Number(poc.buy_price ?? bought_stake);
                const won = profit > 0;
                patchLog(log_id, { status: won ? 'won' : 'lost', profit });

                subscription.unsubscribe();
                pending_subs_ref.current.delete(subscription);
                onSettled(won, profit, traded);
            });
            pending_subs_ref.current.add(subscription);
            api_base.api.send({ proposal_open_contract: 1, contract_id, subscribe: 1 });
        },
        [onSettled]
    );

    const buyNow = useCallback(
        async (locked: TLockedTarget) => {
            if (buying_ref.current || in_trade_ref.current) return;
            buying_ref.current = true;
            in_trade_ref.current = true;
            setPhase('in_trade');

            const s = settings_ref.current;
            const bought_stake = stake_ref.current;
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
                buying_ref.current = false;
                in_trade_ref.current = false;
                setStatus('error');
                setStatusMessage('Connection is not ready.');
                running_ref.current = false;
                return;
            }

            try {
                const proposal_request: Record<string, unknown> = {
                    proposal: 1,
                    amount: bought_stake,
                    basis: 'stake',
                    contract_type: locked.contract_type,
                    currency: currency_ref.current || 'USD',
                    duration: 1,
                    duration_unit: 't',
                    underlying_symbol: locked.symbol,
                };
                if (s.mode === 'overunder') proposal_request.barrier = s.threshold_digit;

                const proposal_res = await api_base.api.send(proposal_request);
                if (proposal_res?.error) throw new Error(proposal_res.error.message || 'Proposal failed');
                const proposal_id = proposal_res?.proposal?.id;
                if (!proposal_id) throw new Error('No proposal returned');

                const buy_res = await api_base.api.send({ buy: proposal_id, price: bought_stake });
                if (buy_res?.error) throw new Error(buy_res.error.message || 'Buy was rejected');
                const contract_id = buy_res?.buy?.contract_id;
                if (!contract_id) throw new Error('No contract id returned');

                trackContract(contract_id, log_id, locked, bought_stake);
            } catch (err: any) {
                patchLog(log_id, { status: 'failed', fail_reason: err?.message || 'Trade failed' });
                buying_ref.current = false;
                in_trade_ref.current = false;
                // A failed buy is not a market loss — hop to the next 7+ without martingale.
                last_setup_ref.current = { symbol: locked.symbol, digit: locked.digit };
                setLockedTarget(null);
                if (running_ref.current) hunt();
            }
        },
        [hunt, trackContract]
    );

    // Live ticks — buy the moment the locked digit prints on that market.
    useEffect(() => {
        if (status !== 'running') return;
        if (!api_base.api) return;

        const normalize = (s: string) => (s || '').trim().toUpperCase();
        const sub = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
            if (!running_ref.current) return;
            if (data?.msg_type !== 'tick') return;
            const locked = target_ref.current;
            if (!locked || in_trade_ref.current || buying_ref.current) return;

            const raw_symbol = data?.tick?.symbol;
            if (!raw_symbol || normalize(raw_symbol) !== normalize(locked.symbol)) return;

            const epoch = Number(data.tick.epoch);
            if (epoch && epoch === last_epoch_ref.current) return;
            last_epoch_ref.current = epoch || null;

            const pip_size =
                api_base?.pip_sizes?.[locked.symbol] ?? String(data.tick.quote).split('.')[1]?.length ?? 2;
            const digit = Number(getLastDigitForList(Number(data.tick.quote), pip_size));
            if (digit !== locked.digit) return;

            if (!stillValid(locked, entries_ref.current, settings_ref.current.min_streak)) {
                setLockedTarget(null);
                hunt();
                return;
            }

            buyNow(locked);
        });

        return () => sub.unsubscribe();
    }, [status, buyNow, hunt]);

    // Drop a stale lock if the streak dies while we're waiting for the digit.
    // Also pick a target as soon as a fresh 7+ appears while hunting.
    useEffect(() => {
        if (status !== 'running') return;
        if (in_trade_ref.current || buying_ref.current) return;
        const locked = target_ref.current;
        if (locked) {
            if (!stillValid(locked, entries, settings.min_streak)) {
                setLockedTarget(null);
                hunt();
            }
            return;
        }
        hunt();
    }, [entries, status, settings.min_streak, hunt]);

    const start = useCallback(() => {
        if (running_ref.current) return;
        running_ref.current = true;
        in_trade_ref.current = false;
        buying_ref.current = false;
        loss_streak_ref.current = 0;
        session_profit_ref.current = 0;
        last_setup_ref.current = null;
        last_market_ref.current = null;
        last_epoch_ref.current = null;
        stake_ref.current = roundStake(settings_ref.current.initial_stake);
        setStake(stake_ref.current);
        setLossStreak(0);
        setSessionProfit(0);
        setStopReason(null);
        setStatusMessage('');
        setLog([]);
        setStatus('running');
        setPhase('hunting');
        setLockedTarget(null);
        hunt();
    }, [hunt]);

    useEffect(() => {
        return () => {
            running_ref.current = false;
            pending_subs_ref.current.forEach(s => s.unsubscribe());
            pending_subs_ref.current.clear();
        };
    }, []);

    return {
        settings,
        updateSettings,
        status,
        phase,
        target,
        stake,
        loss_streak,
        session_profit,
        log,
        stop_reason,
        status_message,
        start,
        stop: () => stop(),
    };
};
