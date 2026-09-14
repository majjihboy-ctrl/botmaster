import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { SliderField } from '@/pages/digit-pattern/reversal-trader-fields';
import { describeTradeDirection } from '@/pages/digit-pattern/launch-xml-bot';
import { useMarketScanner, TScanMode } from '@/pages/digit-pattern/use-market-scanner';
import { localize } from '@deriv-com/translations';
import { useCustomBotEngine, TCustomStrategy } from './use-custom-bot-engine';
import './custom-bots.scss';

const DIGIT_OPTIONS = Array.from({ length: 10 }, (_, i) => i);

const phaseLabel = (phase: string, min_streak: number) => {
    switch (phase) {
        case 'armed':
            return localize('Armed — waiting for trigger digit');
        case 'in_trade':
            return localize('In trade');
        case 'waiting':
            return localize(`Waiting for a ${min_streak}+ streak`);
        default:
            return localize(`Hunting hottest ${min_streak}+ streak`);
    }
};

const CustomBots = observer(() => {
    const { client } = useStore() ?? {};
    const is_logged_in = !!client?.is_logged_in;
    const currency = client?.currency || 'USD';
    const symbol_options = useSyntheticSymbols();

    const {
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
        stop,
    } = useCustomBotEngine(currency, symbol_options);

    const mode = settings.mode;
    const threshold_digit = settings.threshold_digit;
    const scanner = useMarketScanner(symbol_options, mode, threshold_digit, false);

    const is_running = status === 'running';
    const min_streak = settings.min_streak;
    const visible_entries = scanner.entries.filter(e => e.count >= min_streak);
    const best_entry = visible_entries[0];

    const setStrategy = (v: TCustomStrategy) => updateSettings({ strategy: v });
    const setMinStreak = (v: number) => updateSettings({ min_streak: v });

    const onMode = (v: TScanMode) => updateSettings({ mode: v });
    const onThreshold = (v: number) => updateSettings({ threshold_digit: v });

    const handleStart = () => {
        if (!is_logged_in || is_running) return;
        start();
    };

    const stop_copy =
        stop_reason === 'take_profit'
            ? localize('Stopped — take profit reached.')
            : stop_reason === 'stop_loss'
              ? localize('Stopped — stop loss reached.')
              : stop_reason === 'max_martingale'
                ? localize('Stopped — max martingale steps reached.')
                : null;

    return (
        <div className='custom-bots'>
            <div className='custom-bots__topbar'>
                <div className='custom-bots__title'>
                    <h1>{localize('Custom Bots')}</h1>
                    <span className={`custom-bots__live ${scanner.is_loading ? 'connecting' : is_running ? '' : 'idle'}`}>
                        <span className='custom-bots__pulse' />
                        {scanner.is_loading
                            ? `CONNECTING ${scanner.connected_count}/${scanner.total_count}`
                            : is_running
                              ? 'LIVE ENGINE'
                              : `SCANNING ${scanner.total_count} MARKETS`}
                    </span>
                </div>
                <p className='custom-bots__field-hint'>
                    {localize(
                        `Runs on Deriv directly — no Bot Builder. Keeps trading if you switch tabs. Hunts the hottest ${min_streak}+ streak, hops after a loss with martingale, and hunts a new streak after a win.`
                    )}
                </p>
            </div>

            <div className='custom-bots__grid'>
                <div className='custom-bots__col-main'>
                    <div className='custom-bots__panel'>
                        <div className='custom-bots__scanner-controls'>
                            <div className='custom-bots__mode-toggle'>
                                <button
                                    className={mode === 'evenodd' ? 'active' : ''}
                                    disabled={is_running}
                                    onClick={() => onMode('evenodd')}
                                >
                                    Even / Odd
                                </button>
                                <button
                                    className={mode === 'overunder' ? 'active' : ''}
                                    disabled={is_running}
                                    onClick={() => onMode('overunder')}
                                >
                                    Over / Under
                                </button>
                            </div>

                            <div className='custom-bots__mode-toggle'>
                                <button
                                    className={settings.strategy === 'continuation' ? 'active' : ''}
                                    disabled={is_running}
                                    onClick={() => setStrategy('continuation')}
                                    title='Bet the streak keeps running. Loss hops to the hottest other 7+.'
                                >
                                    Continuation
                                </button>
                                <button
                                    className={settings.strategy === 'reversal' ? 'active' : ''}
                                    disabled={is_running}
                                    onClick={() => setStrategy('reversal')}
                                    title='Bet the streak snaps back. Loss hops to the hottest 7+ on another market.'
                                >
                                    Reversal
                                </button>
                            </div>

                            {mode === 'overunder' && (
                                <div className='custom-bots__field-group inline'>
                                    <label className='custom-bots__field-label' htmlFor='cb-threshold'>
                                        {localize('Threshold')}
                                    </label>
                                    <select
                                        id='cb-threshold'
                                        value={threshold_digit}
                                        disabled={is_running}
                                        onChange={e => onThreshold(Number(e.target.value))}
                                    >
                                        {DIGIT_OPTIONS.map(d => (
                                            <option key={d} value={d}>
                                                {d}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className='custom-bots__field-group inline grow'>
                                <label className='custom-bots__field-label' htmlFor='cb-min-streak'>
                                    {localize('Minimum streak')}: <strong>{min_streak}+</strong>
                                </label>
                                <input
                                    id='cb-min-streak'
                                    type='range'
                                    min={3}
                                    max={12}
                                    step={1}
                                    value={min_streak}
                                    disabled={is_running}
                                    onChange={e => setMinStreak(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <p className='custom-bots__field-hint'>
                            {settings.strategy === 'continuation'
                                ? localize(
                                      `Continuation buys the same direction as the streak. After a loss it jumps to whichever other ${min_streak}+ is hottest and keeps continuation until a win.`
                                  )
                                : localize(
                                      `Reversal buys the opposite of the streak. After a loss it jumps to another market, finds a new digit on ${min_streak}+, and reverses that one — and so on until a win.`
                                  )}
                        </p>
                    </div>

                    <div className='custom-bots__panel'>
                        <h2>{localize('Engine')}</h2>
                        <div className={`custom-bots__engine-status ${phase}`}>
                            <span className='label'>{phaseLabel(is_running ? phase : 'hunting', min_streak)}</span>
                            {target && (
                                <span className='lock'>
                                    {target.display_name} · digit {target.digit} · {target.count}x{' '}
                                    {target.streak_direction.toUpperCase()} →{' '}
                                    <strong>{target.trade_direction.toUpperCase()}</strong>
                                </span>
                            )}
                            {!is_logged_in && (
                                <span className='warn'>{localize('Log in to start the engine.')}</span>
                            )}
                            {status_message && <span className='warn'>{status_message}</span>}
                            {stop_copy && <span className='ok'>{stop_copy}</span>}
                        </div>
                        <div className='custom-bots__engine-actions'>
                            {!is_running ? (
                                <button
                                    className='custom-bots__btn primary'
                                    disabled={!is_logged_in}
                                    onClick={handleStart}
                                >
                                    {localize('Start engine')}
                                </button>
                            ) : (
                                <button className='custom-bots__btn danger' onClick={stop}>
                                    {localize('Stop engine')}
                                </button>
                            )}
                            <div className='custom-bots__mini-stats'>
                                <div>
                                    <span className='k'>{localize('Stake')}</span>
                                    <span className='v'>${stake.toFixed(2)}</span>
                                </div>
                                <div>
                                    <span className='k'>{localize('Loss streak')}</span>
                                    <span className='v'>
                                        {loss_streak}/{settings.max_martingale_steps}
                                    </span>
                                </div>
                                <div>
                                    <span className='k'>{localize('Session P/L')}</span>
                                    <span className={`v ${session_profit >= 0 ? 'up' : 'down'}`}>
                                        {session_profit >= 0 ? '+' : ''}
                                        {session_profit.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className='custom-bots__panel custom-bots__scanner-panel'>
                        <h2>
                            {localize('Live opportunities')} ({visible_entries.length})
                        </h2>
                        {visible_entries.length === 0 ? (
                            <div className='custom-bots__empty-state'>
                                {scanner.is_loading
                                    ? localize('Connecting to markets…')
                                    : localize(`No digit has hit a ${min_streak}+ streak right now. Waiting.`)}
                            </div>
                        ) : (
                            <div className='custom-bots__scanner-list'>
                                {visible_entries.map(entry => {
                                    const is_best = entry === best_entry;
                                    const is_locked =
                                        target?.symbol === entry.symbol && target?.digit === entry.digit;
                                    const is_positive = entry.direction === 'even' || entry.direction === 'over';
                                    return (
                                        <div
                                            key={`${entry.symbol}-${entry.digit}`}
                                            className={`custom-bots__scan-row ${is_best ? 'best' : ''} ${
                                                is_positive ? 'positive' : 'negative'
                                            } ${is_locked ? 'locked' : ''}`}
                                        >
                                            {is_locked && <span className='custom-bots__best-badge'>LOCKED</span>}
                                            {!is_locked && is_best && (
                                                <span className='custom-bots__best-badge'>BEST</span>
                                            )}
                                            <div className='custom-bots__scan-market'>
                                                <span className='name'>{entry.display_name}</span>
                                                <span className='digit'>digit {entry.digit}</span>
                                            </div>
                                            <div className='custom-bots__scan-streak'>
                                                <span className='count'>{entry.count}x</span>
                                                <span className='direction'>{entry.direction.toUpperCase()}</span>
                                            </div>
                                            <div className='custom-bots__scan-reversal'>
                                                → trade{' '}
                                                <strong>
                                                    {describeTradeDirection(entry.direction, settings.strategy)}
                                                </strong>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <div className='custom-bots__col-side'>
                    <div className='custom-bots__panel'>
                        <h2>{localize('Trade settings')}</h2>
                        <SliderField
                            label={localize('Initial stake')}
                            value={settings.initial_stake}
                            min={0.35}
                            max={20}
                            step={0.05}
                            disabled={is_running}
                            onChange={v => updateSettings({ initial_stake: v })}
                            prefix='$'
                            decimals={2}
                        />
                        <SliderField
                            label={localize('Martingale multiplier')}
                            value={settings.martingale_mult}
                            min={1.5}
                            max={5}
                            step={0.1}
                            disabled={is_running}
                            onChange={v => updateSettings({ martingale_mult: v })}
                            suffix='x'
                            decimals={1}
                        />
                        <SliderField
                            label={localize('Max martingale steps')}
                            value={settings.max_martingale_steps}
                            min={2}
                            max={10}
                            step={1}
                            disabled={is_running}
                            onChange={v => updateSettings({ max_martingale_steps: Math.round(v) })}
                            decimals={0}
                        />
                        <SliderField
                            label={localize('Stop loss')}
                            value={settings.stop_loss}
                            min={0}
                            max={200}
                            step={1}
                            disabled={is_running}
                            onChange={v => updateSettings({ stop_loss: v })}
                            prefix='$'
                            decimals={2}
                        />
                        <SliderField
                            label={localize('Take profit')}
                            value={settings.take_profit}
                            min={0}
                            max={1000}
                            step={10}
                            disabled={is_running}
                            onChange={v => updateSettings({ take_profit: v })}
                            prefix='$'
                            decimals={2}
                        />
                    </div>

                    <div className='custom-bots__panel'>
                        <h2>{localize('Trade log')}</h2>
                        {log.length === 0 ? (
                            <div className='custom-bots__empty-state'>{localize('No trades yet.')}</div>
                        ) : (
                            <div className='custom-bots__log-list'>
                                {log.map(entry => (
                                    <div key={entry.id} className={`custom-bots__log-item ${entry.status}`}>
                                        <div className='custom-bots__log-main'>
                                            <span className='symbol'>{entry.display_name}</span>
                                            <span className='contract-type'>
                                                digit {entry.digit} · {entry.contract_type} · {entry.strategy}
                                            </span>
                                        </div>
                                        <div className='custom-bots__log-side'>
                                            <span className='stake'>${entry.stake.toFixed(2)}</span>
                                            <span className={`badge ${entry.status}`}>{entry.status}</span>
                                        </div>
                                        {entry.fail_reason && (
                                            <div className='custom-bots__log-reason'>{entry.fail_reason}</div>
                                        )}
                                        {typeof entry.profit === 'number' && (
                                            <div
                                                className={`custom-bots__log-profit ${
                                                    entry.profit >= 0 ? 'up' : 'down'
                                                }`}
                                            >
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

export default CustomBots;
