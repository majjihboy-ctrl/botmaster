import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { localize } from '@deriv-com/translations';
import {
    getAutoTradesSnapshot,
    resetAutoTrades,
    startAutoTrades,
    stopAutoTrades,
    subscribeAutoTrades,
    TAccount,
} from './auto-trades-engine';
import { contractFor, LIMITS, roundMoney, sanitizeSettings, TMode, TSettings, TSignal } from './engine-logic';
import './auto-trades.scss';

const STORAGE_KEY = 'bm_auto_trades_settings_v1';

const DEFAULTS: TSettings = {
    signal: 'even',
    mode: 'continuation',
    barrier: 4,
    streak: 4,
    stake: 1,
    multiplier: 2,
    max_steps: 5,
    take_profit: 10,
    stop_loss: 20,
    max_stake: 50,
};

type TForm = Record<keyof TSettings, string>;

const toForm = (s: TSettings): TForm =>
    Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as TForm;

const loadForm = (): TForm => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return toForm(sanitizeSettings({ ...DEFAULTS, ...JSON.parse(raw) }));
    } catch {
        // ignore corrupted storage
    }
    return toForm(DEFAULTS);
};

const fromForm = (f: TForm): TSettings =>
    sanitizeSettings({
        signal: f.signal as TSignal,
        mode: f.mode as TMode,
        barrier: Number(f.barrier),
        streak: Number(f.streak),
        stake: Number(f.stake),
        multiplier: Number(f.multiplier),
        max_steps: Number(f.max_steps),
        take_profit: Number(f.take_profit),
        stop_loss: Number(f.stop_loss),
        max_stake: Number(f.max_stake),
    });

const CONTRACT_LABEL: Record<string, string> = {
    DIGITEVEN: 'Even',
    DIGITODD: 'Odd',
    DIGITOVER: 'Over',
    DIGITUNDER: 'Under',
};

const STOP_COPY: Record<string, string> = {
    take_profit: 'Take profit reached.',
    stop_loss: 'Stop loss reached.',
    max_steps: 'Maximum martingale steps reached.',
    stake_cap: 'The next martingale stake would exceed your stake cap.',
    account_changed: 'The active account changed.',
    user: 'Stopped by you.',
};

const money = (n: number, currency: string) => `${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)} ${currency}`;

const AutoTrades = observer(() => {
    const { client } = useStore() ?? {};
    const symbols = useSyntheticSymbols();
    const snap = useSyncExternalStore(subscribeAutoTrades, getAutoTradesSnapshot);

    const [form, setForm] = useState<TForm>(loadForm);
    const [markets, setMarkets] = useState<string[]>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(`${STORAGE_KEY}_markets`) || '[]');
            return Array.isArray(saved) ? saved.filter((m: unknown) => typeof m === 'string') : [];
        } catch {
            return [];
        }
    });
    const [confirmed_real, setConfirmedReal] = useState(false);

    const is_logged_in = !!client?.is_logged_in;
    const is_virtual = !!client?.is_virtual;
    const currency = client?.currency || 'USD';
    const running = snap.status === 'running' || snap.status === 'starting';
    const settings = useMemo(() => fromForm(form), [form]);
    const contract = contractFor(settings.signal, settings.mode);
    const uses_barrier = settings.signal === 'over' || settings.signal === 'under';

    // The confirmation applies to one account only: switching accounts clears it.
    useEffect(() => {
        setConfirmedReal(false);
    }, [client?.loginid]);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            localStorage.setItem(`${STORAGE_KEY}_markets`, JSON.stringify(markets));
        } catch {
            // storage is a convenience only
        }
    }, [settings, markets]);

    const set = (key: keyof TSettings) => (e: { target: { value: string } }) =>
        setForm(prev => ({ ...prev, [key]: e.target.value }));

    const toggleMarket = (symbol: string) =>
        setMarkets(prev => (prev.includes(symbol) ? prev.filter(m => m !== symbol) : [...prev, symbol]));

    const getAccount = useCallback((): TAccount | null => {
        if (!client?.is_logged_in || !client.loginid) return null;
        return { loginid: client.loginid, currency: client.currency || 'USD', is_virtual: !!client.is_virtual };
    }, [client]);

    const can_start = is_logged_in && markets.length > 0 && (is_virtual || confirmed_real) && !running;

    const handleStart = () => {
        if (!can_start) return;
        setForm(toForm(settings)); // show the values that will actually be used after clamping
        resetAutoTrades();
        startAutoTrades(settings, markets, getAccount);
    };

    const worst_case = useMemo(() => {
        let total = 0;
        for (let i = 0; i < settings.max_steps; i += 1) {
            total += Math.min(settings.max_stake, settings.stake * Math.pow(settings.multiplier, i));
        }
        return roundMoney(total);
    }, [settings]);

    const total_trades = snap.wins + snap.losses;

    return (
        <div className='auto-trades'>
            <div className='auto-trades__toolbar'>
                <div>
                    <h2>{localize('Auto Trades')}</h2>
                    <p>{localize('Trades automatically when a market prints your chosen streak of digits.')}</p>
                </div>
                <div className='auto-trades__account'>
                    {is_logged_in ? (
                        <span className={`auto-trades__badge ${is_virtual ? 'is-demo' : 'is-real'}`}>
                            {is_virtual ? localize('Demo account') : localize('REAL account')}
                        </span>
                    ) : (
                        <span className='auto-trades__badge'>{localize('Not logged in')}</span>
                    )}
                </div>
            </div>

            {snap.status === 'stopped' && (snap.stop_reason || snap.message) && (
                <div className='auto-trades__notice' role='alert'>
                    {snap.message || localize(STOP_COPY[snap.stop_reason as string] ?? 'Stopped.')}
                </div>
            )}
            {!is_logged_in && (
                <div className='auto-trades__notice'>{localize('Log in to your Deriv account to start trading.')}</div>
            )}

            <div className='auto-trades__body'>
                <section className='auto-trades__card'>
                    <h4>{localize('Strategy')}</h4>
                    <div className='auto-trades__grid'>
                        <label>
                            <span>{localize('Watch for a streak of')}</span>
                            <select value={form.signal} onChange={set('signal')} disabled={running}>
                                <option value='even'>{localize('Even digits')}</option>
                                <option value='odd'>{localize('Odd digits')}</option>
                                <option value='over'>{localize('Digits over barrier')}</option>
                                <option value='under'>{localize('Digits under barrier')}</option>
                            </select>
                        </label>
                        <label>
                            <span>{localize('When it forms')}</span>
                            <select value={form.mode} onChange={set('mode')} disabled={running}>
                                <option value='continuation'>{localize('Trade with the streak')}</option>
                                <option value='reversal'>{localize('Trade against the streak')}</option>
                            </select>
                        </label>
                        <label>
                            <span>
                                {localize('Streak length')} ({LIMITS.min_streak}-{LIMITS.max_streak})
                            </span>
                            <input
                                type='number'
                                value={form.streak}
                                onChange={set('streak')}
                                disabled={running}
                                data-testid='dt_auto_streak'
                            />
                        </label>
                        {uses_barrier && (
                            <label>
                                <span>
                                    {localize('Barrier digit')} ({LIMITS.min_barrier}-{LIMITS.max_barrier})
                                </span>
                                <input type='number' value={form.barrier} onChange={set('barrier')} disabled={running} />
                            </label>
                        )}
                    </div>
                    <p className='auto-trades__hint'>
                        {localize('Buys')} <strong>{CONTRACT_LABEL[contract]}</strong>
                        {uses_barrier || contract === 'DIGITOVER' || contract === 'DIGITUNDER'
                            ? ` ${localize('with barrier')} ${settings.barrier}`
                            : ''}{' '}
                        {localize('for 1 tick, one trade at a time.')}
                    </p>
                </section>

                <section className='auto-trades__card'>
                    <h4>{localize('Money management')}</h4>
                    <div className='auto-trades__grid'>
                        <label>
                            <span>
                                {localize('Stake')} ({currency})
                            </span>
                            <input type='number' value={form.stake} onChange={set('stake')} disabled={running} data-testid='dt_auto_stake' />
                        </label>
                        <label>
                            <span>{localize('Martingale multiplier (1 = off)')}</span>
                            <input type='number' value={form.multiplier} onChange={set('multiplier')} disabled={running} />
                        </label>
                        <label>
                            <span>{localize('Max martingale steps')}</span>
                            <input type='number' value={form.max_steps} onChange={set('max_steps')} disabled={running} />
                        </label>
                        <label>
                            <span>{localize('Stake cap')}</span>
                            <input type='number' value={form.max_stake} onChange={set('max_stake')} disabled={running} />
                        </label>
                        <label>
                            <span>{localize('Take profit (0 = off)')}</span>
                            <input type='number' value={form.take_profit} onChange={set('take_profit')} disabled={running} />
                        </label>
                        <label>
                            <span>{localize('Stop loss (0 = off)')}</span>
                            <input type='number' value={form.stop_loss} onChange={set('stop_loss')} disabled={running} />
                        </label>
                    </div>
                    <p className='auto-trades__hint'>
                        {localize('Worst case before max steps: you could stake up to')}{' '}
                        <strong>{money(worst_case, currency)}</strong> {localize('in one losing run.')}
                    </p>
                </section>

                <section className='auto-trades__card'>
                    <h4>{localize('Markets')}</h4>
                    <div className='auto-trades__markets'>
                        {symbols.map(s => (
                            <label key={s.symbol} className={`auto-trades__chip${markets.includes(s.symbol) ? ' is-on' : ''}`}>
                                <input
                                    type='checkbox'
                                    checked={markets.includes(s.symbol)}
                                    onChange={() => toggleMarket(s.symbol)}
                                    disabled={running}
                                />
                                {s.display_name.replace(' Index', '')}
                            </label>
                        ))}
                    </div>
                </section>

                <section className='auto-trades__card auto-trades__card--run'>
                    {is_logged_in && !is_virtual && (
                        <label className='auto-trades__confirm'>
                            <input
                                type='checkbox'
                                checked={confirmed_real}
                                onChange={e => setConfirmedReal(e.target.checked)}
                                disabled={running}
                                data-testid='dt_auto_confirm_real'
                            />
                            <span>
                                {localize(
                                    'I understand this will trade REAL money on this account and I can lose my stake.'
                                )}
                            </span>
                        </label>
                    )}
                    {running ? (
                        <button
                            type='button'
                            className='auto-trades__stop'
                            onClick={() => stopAutoTrades('user')}
                            data-testid='dt_auto_stop'
                        >
                            {localize('Stop')}
                        </button>
                    ) : (
                        <button
                            type='button'
                            className='auto-trades__start'
                            onClick={handleStart}
                            disabled={!can_start}
                            data-testid='dt_auto_start'
                        >
                            {localize('Start')}
                        </button>
                    )}
                    <p className='auto-trades__hint'>
                        {running
                            ? snap.in_trade
                                ? localize('Trade open...')
                                : snap.cooldown_left > 0
                                  ? `${localize('Cooling down after losses')}: ${snap.cooldown_left}`
                                  : snap.message
                            : markets.length === 0
                              ? localize('Pick at least one market.')
                              : localize('Stopping does not close a trade that is already open.')}
                    </p>

                    <dl className='auto-trades__stats'>
                        <div>
                            <dt>{localize('Session P/L')}</dt>
                            <dd className={snap.session_profit >= 0 ? 'is-up' : 'is-down'}>
                                {money(snap.session_profit, currency)}
                            </dd>
                        </div>
                        <div>
                            <dt>{localize('Trades')}</dt>
                            <dd>
                                {total_trades} ({snap.wins}W / {snap.losses}L)
                            </dd>
                        </div>
                        <div>
                            <dt>{localize('Next stake')}</dt>
                            <dd>{money(snap.next_stake || settings.stake, currency)}</dd>
                        </div>
                        <div>
                            <dt>{localize('Loss run')}</dt>
                            <dd>{snap.loss_run}</dd>
                        </div>
                    </dl>
                </section>

                {running && (
                    <section className='auto-trades__card'>
                        <h4>{localize('Live streaks')}</h4>
                        <ul className='auto-trades__streaks'>
                            {Object.entries(snap.streaks).map(([symbol, n]) => (
                                <li key={symbol}>
                                    <span>{symbols.find(s => s.symbol === symbol)?.display_name.replace(' Index', '') ?? symbol}</span>
                                    <span className={n >= settings.streak - 1 ? 'is-close' : ''}>
                                        {n}/{settings.streak}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <section className='auto-trades__card auto-trades__card--log'>
                    <h4>{localize('Trade log')}</h4>
                    {snap.log.length === 0 ? (
                        <p className='auto-trades__hint'>{localize('No trades yet this session.')}</p>
                    ) : (
                        <table>
                            <thead>
                                <tr>
                                    <th>{localize('Time')}</th>
                                    <th>{localize('Market')}</th>
                                    <th>{localize('Type')}</th>
                                    <th>{localize('Stake')}</th>
                                    <th>{localize('Result')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {snap.log.map(row => (
                                    <tr key={row.id}>
                                        <td>{new Date(row.time).toLocaleTimeString()}</td>
                                        <td>{row.symbol}</td>
                                        <td>{CONTRACT_LABEL[row.contract]}</td>
                                        <td>{row.stake.toFixed(2)}</td>
                                        <td className={row.error ? 'is-down' : row.won ? 'is-up' : row.won === false ? 'is-down' : ''}>
                                            {row.error
                                                ? row.error
                                                : row.profit === undefined
                                                  ? '...'
                                                  : money(row.profit, currency)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>
            </div>

            <p className='auto-trades__footnote'>
                {localize(
                    'Streaks do not make the next digit more or less likely. No setting here guarantees profit. Test on a demo account first.'
                )}
            </p>
        </div>
    );
});

export default AutoTrades;
