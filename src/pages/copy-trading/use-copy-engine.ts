import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { requestOptionsProposalForQS } from '@/external/bot-skeleton/scratch/options-proposal-handler';
import { MasterConnection, TMasterTrade } from './master-connection';
import { DEFAULT_COPY_SETTINGS, loadCopySettings, saveCopySettings, TCopySettings } from './copy-settings';

export type TCopyEngineStatus = 'idle' | 'connecting' | 'running' | 'stopped' | 'error';

export type TCopiedTradeLog = {
    id: string;
    time: number;
    symbol: string;
    contract_type: string;
    stake: number;
    status: 'pending' | 'won' | 'lost' | 'skipped' | 'failed';
    profit?: number;
    skip_reason?: string;
};

const trailingCount = (outcomes: boolean[], wantWin: boolean): number => {
    let n = 0;
    for (let i = outcomes.length - 1; i >= 0; i--) {
        if (outcomes[i] === wantWin) n++;
        else break;
    }
    return n;
};

export const useCopyEngine = () => {
    const [status, setStatus] = useState<TCopyEngineStatus>('idle');
    const [status_message, setStatusMessage] = useState('');
    const [log, setLog] = useState<TCopiedTradeLog[]>([]);
    const [session_profit, setSessionProfit] = useState(0);
    const [settings, setSettingsState] = useState<TCopySettings>(() => loadCopySettings());
    const [stop_reason, setStopReason] = useState<string | null>(null);

    const master_conn_ref = useRef<MasterConnection | null>(null);
    const settings_ref = useRef<TCopySettings>(settings);
    const currency_ref = useRef<string>('USD');
    // Tracks every open proposal_open_contract listener for a trade that
    // hasn't settled yet. Without this, stopping mid-trade (or unmounting)
    // leaves the listener attached forever — it never unsubscribes itself
    // since it only does that once the contract sells, and every dangling
    // one keeps inspecting every single incoming WS message from then on.
    const pending_subscriptions_ref = useRef<Set<{ unsubscribe: () => void }>>(new Set());
    const follower_outcomes_ref = useRef<boolean[]>([]); // for martingale/compounding — this account's own results
    const master_outcomes_ref = useRef<boolean[]>([]); // for wait_for_loss — the master's own results
    const session_profit_ref = useRef(0);
    const running_ref = useRef(false);

    useEffect(() => {
        settings_ref.current = settings;
    }, [settings]);

    const updateSettings = useCallback((patch: Partial<TCopySettings>) => {
        setSettingsState(prev => {
            const next = { ...prev, ...patch };
            saveCopySettings(patch);
            return next;
        });
    }, []);

    const appendLog = (entry: TCopiedTradeLog) => setLog(prev => [entry, ...prev].slice(0, 100));
    const patchLog = (id: string, patch: Partial<TCopiedTradeLog>) =>
        setLog(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));

    const calculateStake = (masterTrade: TMasterTrade): number => {
        const s = settings_ref.current;
        if (s.follow_master_stake) return Math.max(0.35, masterTrade.buy_price);

        let stake = s.fixed_stake;
        if (s.martingale_enabled) {
            const losses = trailingCount(follower_outcomes_ref.current, false);
            if (losses >= s.do_martingale_at) {
                const level = Math.min(losses - s.do_martingale_at + 1, s.max_martingale_steps);
                stake = s.fixed_stake * Math.pow(s.martingale_mult, level);
            }
        } else if (s.compounding_enabled) {
            const wins = trailingCount(follower_outcomes_ref.current, true);
            if (wins > 0) {
                const level = Math.min(wins, s.max_compound_steps);
                stake = s.fixed_stake * Math.pow(s.compounding_mult, level);
            }
        }
        return Math.round(stake * 100) / 100;
    };

    const checkSessionLimits = (): string | null => {
        const s = settings_ref.current;
        if (s.take_profit > 0 && session_profit_ref.current >= s.take_profit) return 'take_profit';
        if (s.stop_loss > 0 && session_profit_ref.current <= -s.stop_loss) return 'stop_loss';
        return null;
    };

    // Follows the same api_base.api.onMessage() + subscribe(proposal_open_contract)
    // pattern OpenContract.js already uses for this app's own bots — just
    // scoped to one contract at a time here instead of the bot engine's state.
    const trackFollowerContract = (contract_id: number, log_id: string, stake: number) => {
        if (!api_base.api) return;
        const subscription = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type !== 'proposal_open_contract') return;
            const poc = data.proposal_open_contract;
            if (!poc || poc.contract_id !== contract_id || !poc.is_sold) return;

            const profit = Number(poc.sell_price ?? poc.bid_price ?? 0) - Number(poc.buy_price ?? stake);
            const win = profit > 0;

            follower_outcomes_ref.current = [...follower_outcomes_ref.current, win].slice(-50);
            session_profit_ref.current += profit;
            setSessionProfit(session_profit_ref.current);
            patchLog(log_id, { status: win ? 'won' : 'lost', profit });

            subscription.unsubscribe();
            pending_subscriptions_ref.current.delete(subscription);

            const reason = checkSessionLimits();
            if (reason) {
                setStopReason(reason);
                stop();
            }
        });
        pending_subscriptions_ref.current.add(subscription);
        api_base.api.send({ proposal_open_contract: 1, contract_id, subscribe: 1 });
    };

    const mirrorTrade = async (masterTrade: TMasterTrade) => {
        const s = settings_ref.current;
        const log_id = `${masterTrade.contract_id}-${Date.now()}`;

        if (s.allowed_symbols.length > 0 && !s.allowed_symbols.includes(masterTrade.underlying_symbol)) {
            appendLog({
                id: log_id,
                time: Date.now(),
                symbol: masterTrade.underlying_symbol,
                contract_type: masterTrade.contract_type,
                stake: 0,
                status: 'skipped',
                skip_reason: 'Symbol not in allowed list',
            });
            return;
        }

        if (s.wait_for_loss > 0) {
            const masterTrailingLosses = trailingCount(master_outcomes_ref.current, false);
            if (masterTrailingLosses < s.wait_for_loss) {
                appendLog({
                    id: log_id,
                    time: Date.now(),
                    symbol: masterTrade.underlying_symbol,
                    contract_type: masterTrade.contract_type,
                    stake: 0,
                    status: 'skipped',
                    skip_reason: `Waiting for master to lose ${s.wait_for_loss} in a row`,
                });
                return;
            }
        }

        const stake = calculateStake(masterTrade);

        appendLog({
            id: log_id,
            time: Date.now(),
            symbol: masterTrade.underlying_symbol,
            contract_type: masterTrade.contract_type,
            stake,
            status: 'pending',
        });

        if (!api_base.api || api_base.api.connection?.readyState !== 1) {
            patchLog(log_id, { status: 'failed', skip_reason: 'Your own connection is not ready' });
            return;
        }

        try {
            const proposal_res = await requestOptionsProposalForQS(
                {
                    amount: stake,
                    currency: currency_ref.current,
                    underlying_symbol: masterTrade.underlying_symbol,
                    contract_type: masterTrade.contract_type,
                    duration: masterTrade.duration,
                    duration_unit: masterTrade.duration_unit,
                    basis: 'stake',
                },
                api_base.api as any
            );

            const proposal_id = proposal_res?.proposal?.id;
            if (!proposal_id) throw new Error('No proposal returned for this contract.');

            const buy_res = await api_base.api.send({ buy: proposal_id, price: stake });
            if (buy_res?.error) throw new Error(buy_res.error.message || 'Buy was rejected.');

            const contract_id = buy_res?.buy?.contract_id;
            if (contract_id) trackFollowerContract(contract_id, log_id, stake);
        } catch (err: any) {
            patchLog(log_id, { status: 'failed', skip_reason: err?.message || 'Trade failed' });
        }
    };

    const start = useCallback(async (masterToken: string, currency: string) => {
        if (running_ref.current) return;
        running_ref.current = true;
        currency_ref.current = currency;
        setStopReason(null);
        setStatus('connecting');
        setStatusMessage('');
        session_profit_ref.current = 0;
        setSessionProfit(0);
        follower_outcomes_ref.current = [];
        master_outcomes_ref.current = [];

        const conn = new MasterConnection({
            onStatus: (s, message) => {
                if (s === 'connected') {
                    setStatus('running');
                } else if (s === 'error') {
                    setStatus('error');
                    setStatusMessage(message || 'Connection error.');
                    running_ref.current = false;
                } else if (s === 'closed') {
                    if (running_ref.current) {
                        setStatus('error');
                        setStatusMessage(message || 'Connection dropped.');
                        running_ref.current = false;
                    }
                }
            },
            onTrade: masterTrade => {
                if (!running_ref.current) return;
                mirrorTrade(masterTrade);
            },
            onOutcome: (_contract_id, win) => {
                master_outcomes_ref.current = [...master_outcomes_ref.current, win].slice(-50);
            },
        });

        master_conn_ref.current = conn;
        await conn.connect(masterToken);
    }, []);

    const stop = useCallback(() => {
        running_ref.current = false;
        master_conn_ref.current?.close();
        master_conn_ref.current = null;
        // Any trade still in flight when stopping loses its settlement
        // listener here — without this, each one keeps inspecting every
        // WS message forever.
        pending_subscriptions_ref.current.forEach(sub => sub.unsubscribe());
        pending_subscriptions_ref.current.clear();
        setStatus('stopped');
    }, []);

    useEffect(() => {
        return () => {
            master_conn_ref.current?.close();
            pending_subscriptions_ref.current.forEach(sub => sub.unsubscribe());
            pending_subscriptions_ref.current.clear();
        };
    }, []);

    return {
        status,
        status_message,
        log,
        session_profit,
        settings,
        updateSettings,
        stop_reason,
        start,
        stop,
    };
};
