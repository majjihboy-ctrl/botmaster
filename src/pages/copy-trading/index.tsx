import React from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { useCopyEngine } from './use-copy-engine';
import './copy-trading.scss';

const STAKE_MODE = { FIXED: 'fixed', FOLLOW: 'follow' } as const;
const SCALING_MODE = { NONE: 'none', MARTINGALE: 'martingale', COMPOUNDING: 'compounding' } as const;

const statusLabel = (status: string) => {
    switch (status) {
        case 'pending':
            return localize('Pending');
        case 'won':
            return localize('Won');
        case 'lost':
            return localize('Lost');
        case 'skipped':
            return localize('Skipped');
        case 'failed':
            return localize('Failed');
        default:
            return status;
    }
};

const CopyTrading = observer(() => {
    const { client } = useStore() ?? {};
    const { status, status_message, log, session_profit, settings, updateSettings, stop_reason, start, stop } =
        useCopyEngine();

    const [nickname, setNickname] = React.useState('');
    const [token, setToken] = React.useState('');
    const [symbols_text, setSymbolsText] = React.useState(settings.allowed_symbols.join(', '));

    const stake_mode = settings.follow_master_stake ? STAKE_MODE.FOLLOW : STAKE_MODE.FIXED;
    const scaling_mode = settings.martingale_enabled
        ? SCALING_MODE.MARTINGALE
        : settings.compounding_enabled
          ? SCALING_MODE.COMPOUNDING
          : SCALING_MODE.NONE;

    const is_running = status === 'connecting' || status === 'running';

    const handleStart = () => {
        if (!token.trim() || !client) return;
        updateSettings({
            allowed_symbols: symbols_text
                .split(',')
                .map(s => s.trim())
                .filter(Boolean),
        });
        start(token.trim(), client.currency || 'USD');
    };

    const setScalingMode = (mode: (typeof SCALING_MODE)[keyof typeof SCALING_MODE]) => {
        updateSettings({
            martingale_enabled: mode === SCALING_MODE.MARTINGALE,
            compounding_enabled: mode === SCALING_MODE.COMPOUNDING,
        });
    };

    return (
        <div className='copy-trading'>
            <div className='copy-trading__topbar'>
                <div className='copy-trading__title'>
                    <h1>{localize('Copy Trading')}</h1>
                </div>
                <p className='copy-trading__field-hint'>
                    {localize(
                        'Watches a live feed of another trader\u2019s trades and mirrors them onto your own account, using your own settings below. Runs only while this tab stays open.'
                    )}
                </p>
            </div>

            <div className='copy-trading__grid'>
                <div className='copy-trading__col-main'>
                    <div className='copy-trading__panel'>
                        <h2>{localize('Trader to copy')}</h2>

                        <div className='copy-trading__field-group'>
                            <label className='copy-trading__field-label' htmlFor='ct-nickname'>
                                {localize('Nickname (just for your reference)')}
                            </label>
                            <input
                                id='ct-nickname'
                                type='text'
                                value={nickname}
                                onChange={e => setNickname(e.target.value)}
                                placeholder={localize('e.g. Jake — Volatility scalper')}
                                disabled={is_running}
                            />
                        </div>

                        <div className='copy-trading__field-group'>
                            <label className='copy-trading__field-label' htmlFor='ct-token'>
                                {localize("Trader's API token")}
                            </label>
                            <input
                                id='ct-token'
                                type='password'
                                autoComplete='off'
                                value={token}
                                onChange={e => setToken(e.target.value)}
                                placeholder={localize('Paste the token they shared with you')}
                                disabled={is_running}
                            />
                            <p className='copy-trading__field-hint small'>
                                {localize(
                                    'This token can place trades on their account too — only use one from someone you trust.'
                                )}
                            </p>
                        </div>
                    </div>

                    <div className='copy-trading__panel'>
                        <h2>{localize('Stake sizing')}</h2>
                        <div className='copy-trading__toggle-row'>
                            <button
                                className={`copy-trading__toggle-btn ${stake_mode === STAKE_MODE.FIXED ? 'active' : ''}`}
                                onClick={() => updateSettings({ follow_master_stake: false })}
                                disabled={is_running}
                            >
                                {localize('Fixed stake')}
                            </button>
                            <button
                                className={`copy-trading__toggle-btn ${stake_mode === STAKE_MODE.FOLLOW ? 'active' : ''}`}
                                onClick={() => updateSettings({ follow_master_stake: true })}
                                disabled={is_running}
                            >
                                {localize("Follow master's stake")}
                            </button>
                        </div>
                        {stake_mode === STAKE_MODE.FIXED && (
                            <div className='copy-trading__field-group'>
                                <label className='copy-trading__field-label' htmlFor='ct-fixed-stake'>
                                    {localize('Fixed stake')}
                                </label>
                                <input
                                    id='ct-fixed-stake'
                                    type='number'
                                    min={0.35}
                                    step={0.01}
                                    value={settings.fixed_stake}
                                    onChange={e => updateSettings({ fixed_stake: Number(e.target.value) })}
                                    disabled={is_running}
                                />
                            </div>
                        )}
                    </div>

                    <div className='copy-trading__panel'>
                        <h2>{localize('Stake scaling')}</h2>
                        <div className='copy-trading__toggle-row'>
                            <button
                                className={`copy-trading__toggle-btn ${scaling_mode === SCALING_MODE.NONE ? 'active' : ''}`}
                                onClick={() => setScalingMode(SCALING_MODE.NONE)}
                                disabled={is_running}
                            >
                                {localize('None')}
                            </button>
                            <button
                                className={`copy-trading__toggle-btn ${scaling_mode === SCALING_MODE.MARTINGALE ? 'active' : ''}`}
                                onClick={() => setScalingMode(SCALING_MODE.MARTINGALE)}
                                disabled={is_running}
                            >
                                {localize('Martingale')}
                            </button>
                            <button
                                className={`copy-trading__toggle-btn ${scaling_mode === SCALING_MODE.COMPOUNDING ? 'active' : ''}`}
                                onClick={() => setScalingMode(SCALING_MODE.COMPOUNDING)}
                                disabled={is_running}
                            >
                                {localize('Compounding')}
                            </button>
                        </div>

                        {scaling_mode === SCALING_MODE.MARTINGALE && (
                            <div className='copy-trading__field-row'>
                                <div className='copy-trading__field-group'>
                                    <label className='copy-trading__field-label'>{localize('Multiplier')}</label>
                                    <input
                                        type='number'
                                        min={1.1}
                                        step={0.1}
                                        value={settings.martingale_mult}
                                        onChange={e => updateSettings({ martingale_mult: Number(e.target.value) })}
                                        disabled={is_running}
                                    />
                                </div>
                                <div className='copy-trading__field-group'>
                                    <label className='copy-trading__field-label'>{localize('After N losses')}</label>
                                    <input
                                        type='number'
                                        min={1}
                                        step={1}
                                        value={settings.do_martingale_at}
                                        onChange={e => updateSettings({ do_martingale_at: Number(e.target.value) })}
                                        disabled={is_running}
                                    />
                                </div>
                                <div className='copy-trading__field-group'>
                                    <label className='copy-trading__field-label'>{localize('Max steps')}</label>
                                    <input
                                        type='number'
                                        min={1}
                                        step={1}
                                        value={settings.max_martingale_steps}
                                        onChange={e => updateSettings({ max_martingale_steps: Number(e.target.value) })}
                                        disabled={is_running}
                                    />
                                </div>
                            </div>
                        )}

                        {scaling_mode === SCALING_MODE.COMPOUNDING && (
                            <div className='copy-trading__field-row'>
                                <div className='copy-trading__field-group'>
                                    <label className='copy-trading__field-label'>{localize('Multiplier')}</label>
                                    <input
                                        type='number'
                                        min={1.1}
                                        step={0.1}
                                        value={settings.compounding_mult}
                                        onChange={e => updateSettings({ compounding_mult: Number(e.target.value) })}
                                        disabled={is_running}
                                    />
                                </div>
                                <div className='copy-trading__field-group'>
                                    <label className='copy-trading__field-label'>{localize('Max steps')}</label>
                                    <input
                                        type='number'
                                        min={1}
                                        step={1}
                                        value={settings.max_compound_steps}
                                        onChange={e => updateSettings({ max_compound_steps: Number(e.target.value) })}
                                        disabled={is_running}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className='copy-trading__panel'>
                        <h2>{localize('Session limits & filters')}</h2>
                        <div className='copy-trading__field-row'>
                            <div className='copy-trading__field-group'>
                                <label className='copy-trading__field-label'>{localize('Stop loss (0 = off)')}</label>
                                <input
                                    type='number'
                                    min={0}
                                    step={0.5}
                                    value={settings.stop_loss}
                                    onChange={e => updateSettings({ stop_loss: Number(e.target.value) })}
                                    disabled={is_running}
                                />
                            </div>
                            <div className='copy-trading__field-group'>
                                <label className='copy-trading__field-label'>{localize('Take profit (0 = off)')}</label>
                                <input
                                    type='number'
                                    min={0}
                                    step={0.5}
                                    value={settings.take_profit}
                                    onChange={e => updateSettings({ take_profit: Number(e.target.value) })}
                                    disabled={is_running}
                                />
                            </div>
                        </div>
                        <div className='copy-trading__field-group'>
                            <label className='copy-trading__field-label'>
                                {localize('Wait for master to lose N in a row before copying (0 = off)')}
                            </label>
                            <input
                                type='number'
                                min={0}
                                step={1}
                                value={settings.wait_for_loss}
                                onChange={e => updateSettings({ wait_for_loss: Number(e.target.value) })}
                                disabled={is_running}
                            />
                        </div>
                        <div className='copy-trading__field-group'>
                            <label className='copy-trading__field-label'>
                                {localize('Only copy these symbols (comma-separated, blank = all)')}
                            </label>
                            <input
                                type='text'
                                value={symbols_text}
                                onChange={e => setSymbolsText(e.target.value)}
                                placeholder='R_50, R_100'
                                disabled={is_running}
                            />
                        </div>
                    </div>
                </div>

                <div className='copy-trading__col-side'>
                    <div className='copy-trading__panel'>
                        <h2>{localize('Session')}</h2>

                        {status === 'idle' && (
                            <button className='copy-trading__btn primary' onClick={handleStart} disabled={!token.trim()}>
                                {localize('Start copying')}
                            </button>
                        )}
                        {(status === 'connecting' || status === 'running') && (
                            <>
                                <p className='copy-trading__message success'>
                                    {status === 'connecting'
                                        ? localize('Connecting to trader…')
                                        : localize('Live — copying trades')}
                                </p>
                                <button className='copy-trading__btn danger' onClick={stop}>
                                    {localize('Stop copying')}
                                </button>
                            </>
                        )}
                        {status === 'error' && (
                            <>
                                <p className='copy-trading__message error'>{status_message}</p>
                                <button className='copy-trading__btn primary' onClick={handleStart} disabled={!token.trim()}>
                                    {localize('Retry')}
                                </button>
                            </>
                        )}
                        {status === 'stopped' && (
                            <>
                                {stop_reason && (
                                    <p className='copy-trading__message success'>
                                        {stop_reason === 'take_profit'
                                            ? localize('Stopped — take profit reached.')
                                            : localize('Stopped — stop loss reached.')}
                                    </p>
                                )}
                                <button className='copy-trading__btn primary' onClick={handleStart} disabled={!token.trim()}>
                                    {localize('Start copying')}
                                </button>
                            </>
                        )}

                        <div className='copy-trading__session-profit'>
                            <span className='copy-trading__field-label'>{localize('Session P/L')}</span>
                            <span className={`copy-trading__profit-value ${session_profit >= 0 ? 'up' : 'down'}`}>
                                {session_profit >= 0 ? '+' : ''}
                                {session_profit.toFixed(2)}
                            </span>
                        </div>
                    </div>

                    <div className='copy-trading__panel'>
                        <h2>{localize('Trade log')}</h2>
                        {log.length === 0 ? (
                            <div className='copy-trading__empty-state'>{localize('No trades copied yet.')}</div>
                        ) : (
                            <div className='copy-trading__log-list'>
                                {log.map(entry => (
                                    <div key={entry.id} className={`copy-trading__log-item ${entry.status}`}>
                                        <div className='copy-trading__log-main'>
                                            <span className='symbol'>{entry.symbol}</span>
                                            <span className='contract-type'>{entry.contract_type}</span>
                                        </div>
                                        <div className='copy-trading__log-side'>
                                            {entry.stake > 0 && <span className='stake'>${entry.stake.toFixed(2)}</span>}
                                            <span className={`badge ${entry.status}`}>{statusLabel(entry.status)}</span>
                                        </div>
                                        {entry.skip_reason && (
                                            <div className='copy-trading__log-reason'>{entry.skip_reason}</div>
                                        )}
                                        {typeof entry.profit === 'number' && (
                                            <div className={`copy-trading__log-profit ${entry.profit >= 0 ? 'up' : 'down'}`}>
                                                {entry.profit >= 0 ? '+' : ''}
                                                {entry.profit.toFixed(2)}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default CopyTrading;
