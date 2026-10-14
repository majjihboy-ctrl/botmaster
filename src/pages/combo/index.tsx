import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { TAccount } from '../auto-trades/auto-trades-engine';
import { contractFor, LIMITS, sanitizeSettings, TMode, TSettings, TSignal } from '../auto-trades/engine-logic';
import { localize } from '@deriv-com/translations';
import { MAX_MARKETS, roundExposure, worstCaseExposure } from './combo-logic';
import { getComboSnapshot, resetCombo, startCombo, stopCombo, subscribeCombo } from './combo-engine';
import '../auto-trades/auto-trades.scss';

const KEY = 'bm_combo_settings_v1';
const DEFAULTS: TSettings = {
    signal: 'even',
    mode: 'continuation',
    barrier: 4,
    streak: 4,
    stake: 0.5,
    multiplier: 2,
    max_steps: 4,
    take_profit: 10,
    stop_loss: 20,
    max_stake: 20,
};
type TForm = Record<keyof TSettings, string>;
const toForm = (s: TSettings): TForm => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as TForm;
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
const loadForm = (): TForm => {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) return toForm(sanitizeSettings({ ...DEFAULTS, ...JSON.parse(raw) }));
    } catch {
        // ignore
    }
    return toForm(DEFAULTS);
};

const LABEL: Record<string, string> = { DIGITEVEN: 'Even', DIGITODD: 'Odd', DIGITOVER: 'Over', DIGITUNDER: 'Under' };
const STOP: Record<string, string> = {
    take_profit: 'Take profit reached.',
    stop_loss: 'Stop loss reached.',
    max_steps: 'Maximum martingale steps reached.',
    stake_cap: 'The next martingale stake would exceed your stake cap.',
    account_changed: 'The active account changed.',
    user: 'Stopped by you.',
};
const money = (n: number, c: string) => `${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)} ${c}`;

const Combo = observer(() => {
    const { client } = useStore() ?? {};
    const symbols = useSyntheticSymbols();
    const snap = useSyncExternalStore(subscribeCombo, getComboSnapshot);
    const [form, setForm] = useState<TForm>(loadForm);
    const [markets, setMarkets] = useState<string[]>(() => {
        try {
            const v = JSON.parse(localStorage.getItem(`${KEY}_markets`) || '[]');
            return Array.isArray(v) ? v.filter((m: unknown) => typeof m === 'string').slice(0, MAX_MARKETS) : [];
        } catch {
            return [];
        }
    });
    const [confirmed, setConfirmed] = useState(false);

    const logged_in = !!client?.is_logged_in;
    const is_virtual = !!client?.is_virtual;
    const currency = client?.currency || 'USD';
    const running = snap.status === 'running' || snap.status === 'starting';
    const s = useMemo(() => fromForm(form), [form]);
    const contract = contractFor(s.signal, s.mode);
    const uses_barrier = s.signal === 'over' || s.signal === 'under';

    useEffect(() => setConfirmed(false), [client?.loginid]);
    useEffect(() => {
        try {
            localStorage.setItem(KEY, JSON.stringify(s));
            localStorage.setItem(`${KEY}_markets`, JSON.stringify(markets));
        } catch {
            // convenience only
        }
    }, [s, markets]);

    const set = (k: keyof TSettings) => (e: { target: { value: string } }) => setForm(p => ({ ...p, [k]: e.target.value }));
    const toggle = (sym: string) =>
        setMarkets(p => (p.includes(sym) ? p.filter(m => m !== sym) : p.length >= MAX_MARKETS ? p : [...p, sym]));
    const getAccount = useCallback((): TAccount | null => {
        if (!client?.is_logged_in || !client.loginid) return null;
        return { loginid: client.loginid, currency: client.currency || 'USD', is_virtual: !!client.is_virtual };
    }, [client]);

    const can_start = logged_in && markets.length >= 2 && (is_virtual || confirmed) && !running;
    const handleStart = () => {
        if (!can_start) return;
        setForm(toForm(s));
        resetCombo();
        startCombo(s, markets, getAccount);
    };
    const name = (sym: string) => symbols.find(x => x.symbol === sym)?.display_name.replace(' Index', '') ?? sym;

    return (
        <div className='auto-trades combo'>
            <div className='auto-trades__toolbar'>
                <div>
                    <h2>{localize('Combo Trading')}</h2>
                    <p>
                        {localize(
                            'When any selected market completes the streak, one trade fires on every selected market at once. Martingale steps up only when the whole round loses.'
                        )}
                    </p>
                </div>
                <span className={`auto-trades__badge ${logged_in ? (is_virtual ? 'is-demo' : 'is-real') : ''}`}>
                    {logged_in ? (is_virtual ? localize('Demo account') : localize('REAL account')) : localize('Not logged in')}
                </span>
            </div>

            {snap.status === 'stopped' && (snap.stop_reason || snap.message) && (
                <div className='auto-trades__notice' role='alert'>
                    {snap.message || localize(STOP[snap.stop_reason as string] ?? 'Stopped.')}
                </div>
            )}
            {!logged_in && <div className='auto-trades__notice'>{localize('Log in to your Deriv account to start trading.')}</div>}

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
                            <span>{localize('Streak length')} ({LIMITS.min_streak}-{LIMITS.max_streak})</span>
                            <input type='number' value={form.streak} onChange={set('streak')} disabled={running} />
                        </label>
                        {uses_barrier && (
                            <label>
                                <span>{localize('Barrier digit')} ({LIMITS.min_barrier}-{LIMITS.max_barrier})</span>
                                <input type='number' value={form.barrier} onChange={set('barrier')} disabled={running} />
                            </label>
                        )}
                    </div>
                    <p className='auto-trades__hint'>
                        {localize('Each round buys')} <strong>{LABEL[contract]}</strong>
                        {contract === 'DIGITOVER' || contract === 'DIGITUNDER' ? ` ${localize('with barrier')} ${s.barrier}` : ''}{' '}
                        {localize('for 1 tick on every selected market.')}
                    </p>
                </section>

                <section className='auto-trades__card'>
                    <h4>{localize('Money management (per trade)')}</h4>
                    <div className='auto-trades__grid'>
                        <label><span>{localize('Stake')} ({currency})</span><input type='number' value={form.stake} onChange={set('stake')} disabled={running} /></label>
                        <label><span>{localize('Martingale multiplier (1 = off)')}</span><input type='number' value={form.multiplier} onChange={set('multiplier')} disabled={running} /></label>
                        <label><span>{localize('Max martingale steps')}</span><input type='number' value={form.max_steps} onChange={set('max_steps')} disabled={running} /></label>
                        <label><span>{localize('Stake cap (per trade)')}</span><input type='number' value={form.max_stake} onChange={set('max_stake')} disabled={running} /></label>
                        <label><span>{localize('Take profit (0 = off)')}</span><input type='number' value={form.take_profit} onChange={set('take_profit')} disabled={running} /></label>
                        <label><span>{localize('Stop loss (0 = off)')}</span><input type='number' value={form.stop_loss} onChange={set('stop_loss')} disabled={running} /></label>
                    </div>
                    <p className='auto-trades__hint'>
                        {localize('One round risks')} <strong>{money(roundExposure(s.stake, Math.max(markets.length, 1)), currency)}</strong>
                        {' · '}
                        {localize('worst case across a losing run')}{' '}
                        <strong>{money(worstCaseExposure(s, Math.max(markets.length, 1)), currency)}</strong>
                    </p>
                </section>

                <section className='auto-trades__card'>
                    <h4>{localize('Markets')} ({markets.length}/{MAX_MARKETS}, {localize('minimum 2')})</h4>
                    <div className='auto-trades__markets'>
                        {symbols.map(m => {
                            const on = markets.includes(m.symbol);
                            return (
                                <label key={m.symbol} className={`auto-trades__chip${on ? ' is-on' : ''}`}>
                                    <input
                                        type='checkbox'
                                        checked={on}
                                        onChange={() => toggle(m.symbol)}
                                        disabled={running || (!on && markets.length >= MAX_MARKETS)}
                                    />
                                    {m.display_name.replace(' Index', '')}
                                </label>
                            );
                        })}
                    </div>
                </section>

                <section className='auto-trades__card auto-trades__card--run'>
                    {logged_in && !is_virtual && (
                        <label className='auto-trades__confirm'>
                            <input type='checkbox' checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={running} />
                            <span>{localize('I understand this will trade REAL money on this account, on several markets at once, and I can lose my stakes.')}</span>
                        </label>
                    )}
                    {running ? (
                        <button type='button' className='auto-trades__stop' onClick={() => stopCombo('user')}>{localize('Stop')}</button>
                    ) : (
                        <button type='button' className='auto-trades__start' onClick={handleStart} disabled={!can_start}>{localize('Start')}</button>
                    )}
                    <p className='auto-trades__hint'>
                        {running
                            ? snap.in_round
                                ? localize('Round open...')
                                : snap.cooldown_left > 0
                                  ? `${localize('Cooling down after losses')}: ${snap.cooldown_left}`
                                  : snap.message
                            : markets.length < 2
                              ? localize('Pick at least two markets.')
                              : localize('Stopping does not close trades that are already open.')}
                    </p>
                    <dl className='auto-trades__stats'>
                        <div><dt>{localize('Session P/L')}</dt><dd className={snap.session_profit >= 0 ? 'is-up' : 'is-down'}>{money(snap.session_profit, currency)}</dd></div>
                        <div><dt>{localize('Rounds')}</dt><dd>{snap.rounds} ({snap.rounds_lost} {localize('fully lost')})</dd></div>
                        <div><dt>{localize('Next stake / trade')}</dt><dd>{money(snap.next_stake || s.stake, currency)}</dd></div>
                        <div><dt>{localize('Loss run')}</dt><dd>{snap.loss_run}</dd></div>
                    </dl>
                </section>

                {running && (
                    <section className='auto-trades__card'>
                        <h4>{localize('Live streaks')}</h4>
                        <ul className='auto-trades__streaks'>
                            {Object.entries(snap.streaks).map(([sym, n]) => (
                                <li key={sym}>
                                    <span>{name(sym)}</span>
                                    <span className={n >= s.streak - 1 ? 'is-close' : ''}>{n}/{s.streak}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <section className='auto-trades__card auto-trades__card--log'>
                    <h4>{localize('Trade log')}</h4>
                    {snap.log.length === 0 ? (
                        <p className='auto-trades__hint'>{localize('No rounds yet this session.')}</p>
                    ) : (
                        <table>
                            <thead><tr><th>{localize('Time')}</th><th>{localize('Market')}</th><th>{localize('Type')}</th><th>{localize('Stake')}</th><th>{localize('Result')}</th></tr></thead>
                            <tbody>
                                {snap.log.map(r => (
                                    <tr key={r.id}>
                                        <td>{new Date(r.time).toLocaleTimeString()}</td>
                                        <td>{r.symbol}</td>
                                        <td>{LABEL[r.contract]}</td>
                                        <td>{r.stake.toFixed(2)}</td>
                                        <td className={r.error || r.won === false ? 'is-down' : r.won ? 'is-up' : ''}>
                                            {r.error ? r.error : r.profit === undefined ? '...' : money(r.profit, currency)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>
            </div>
            <p className='auto-trades__footnote'>
                {localize('Streaks do not make the next digit more or less likely. Firing on several markets multiplies your exposure. Test on a demo account first.')}
            </p>
        </div>
    );
});

export default Combo;
