import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { localize } from '@deriv-com/translations';
import { SliderField, ToggleSwitch } from './reversal-trader-fields';
import { consumePendingReversalConfig } from './trade-bridge';
import { useReversalTrader, TReversalMode } from './use-reversal-trader';
import './reversal-trader.scss';

const DIGIT_OPTIONS = Array.from({ length: 10 }, (_, i) => i);

const directionLabel = (dir: string | null) => (dir ? dir.toUpperCase() : '—');

const ReversalTrader = observer(() => {
    const { client } = useStore();
    const symbol_options = useSyntheticSymbols();

    const [symbol, setSymbol] = React.useState('1HZ100V');
    const [watch_all_markets, setWatchAllMarkets] = React.useState(false);
    const [mode, setMode] = React.useState<TReversalMode>('evenodd');
    const [reference_digit, setReferenceDigit] = React.useState(7);
    const [threshold_digit, setThresholdDigit] = React.useState(5);
    const [streak_target, setStreakTarget] = React.useState(4);
    const [initial_stake, setInitialStake] = React.useState(0.35);
    const [martingale_mult, setMartingaleMult] = React.useState(2);
    const [max_martingale_steps, setMaxMartingaleSteps] = React.useState(5);
    const [stop_loss, setStopLoss] = React.useState(5);
    const [take_profit, setTakeProfit] = React.useState(100);
    const [show_confirm, setShowConfirm] = React.useState(false);

    // Pre-fill from the Signals "Trade this" bridge, once, on first mount.
    React.useEffect(() => {
        const pending = consumePendingReversalConfig();
        if (!pending) return;
        setSymbol(pending.symbol);
        setMode(pending.mode);
        setReferenceDigit(pending.reference_digit);
        setThresholdDigit(pending.threshold_digit);
    }, []);

    const { state, start, stop } = useReversalTrader(client?.currency);
    const logEndRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state.logs.length]);

    const confirmStart = () => {
        setShowConfirm(false);
        const symbols = watch_all_markets ? symbol_options.map(s => s.symbol) : [symbol];
        start({
            symbols,
            reference_digit,
            mode,
            threshold_digit,
            streak_target,
            initial_stake,
            martingale_mult,
            max_martingale_steps,
            stop_loss,
            take_profit,
        });
    };

    const displayName = (sym: string) => symbol_options.find(s => s.symbol === sym)?.display_name || sym;
    const label_a = mode === 'evenodd' ? 'EVEN' : 'OVER';
    const label_b = mode === 'evenodd' ? 'ODD' : 'UNDER';

    const race_rows = Object.entries(state.race_progress).sort(
        ([, a], [, b]) => b.count / b.target - a.count / a.target
    );

    return (
        <div className='reversal-trader'>
            <div className='reversal-trader__layout'>
                <div className='reversal-trader__col-controls'>
                    <div className='reversal-trader__header'>
                        <h1 className='reversal-trader__title'>{localize('Reversal Trader')}</h1>
                        <div className={`reversal-trader__badge ${state.is_armed ? 'live' : 'stopped'}`}>
                            {state.is_armed ? (state.is_loading ? '🔄 Connecting' : '🟢 LIVE') : '⏹️ Stopped'}
                        </div>
                    </div>

                    {state.is_armed && (
                        <div className='reversal-trader__status-card'>
                            <div className='status-row'>
                                <span className='label'>Status:</span>
                                <span className='value'>
                                    {state.active_symbol
                                        ? `Trading ${displayName(state.active_symbol)}`
                                        : `Scanning ${state.watching.length} market${state.watching.length > 1 ? 's' : ''}`}
                                </span>
                            </div>
                            <div className='status-row'>
                                <span className='label'>Watching for:</span>
                                <span className='value'>
                                    {reference_digit} → {streak_target}x {mode === 'evenodd' ? 'even/odd' : 'over/under'}
                                </span>
                            </div>
                            <div className='status-row'>
                                <span className='label'>Current stake:</span>
                                <span className='value'>${state.current_stake.toFixed(2)}</span>
                            </div>
                            <div className='status-row'>
                                <span className={`value ${state.total_pnl >= 0 ? 'profit' : 'loss'}`}>
                                    ${state.total_pnl.toFixed(2)} P&L
                                </span>
                            </div>
                        </div>
                    )}

                    <div className='reversal-trader__controls'>
                        <div className='reversal-trader__panel'>
                            <h2>{localize('Pattern')}</h2>

                            <div className='reversal-trader__field-group'>
                                <span className='reversal-trader__field-label'>{localize('Mode')}</span>
                                <div className='reversal-trader__mode-toggle'>
                                    <button
                                        className={mode === 'evenodd' ? 'active' : ''}
                                        disabled={state.is_armed}
                                        onClick={() => setMode('evenodd')}
                                    >
                                        Even / Odd
                                    </button>
                                    <button
                                        className={mode === 'overunder' ? 'active' : ''}
                                        disabled={state.is_armed}
                                        onClick={() => setMode('overunder')}
                                    >
                                        Over / Under
                                    </button>
                                </div>
                            </div>

                            <div className='reversal-trader__field-group'>
                                <span className='reversal-trader__field-label'>{localize('Reference digit')}</span>
                                <div className='reversal-trader__digit-picker'>
                                    {DIGIT_OPTIONS.map(d => (
                                        <button
                                            key={d}
                                            className={reference_digit === d ? 'active' : ''}
                                            disabled={state.is_armed}
                                            onClick={() => setReferenceDigit(d)}
                                        >
                                            {d}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {mode === 'overunder' && (
                                <div className='reversal-trader__field-group'>
                                    <label className='reversal-trader__field-label' htmlFor='rt-threshold'>
                                        {localize('Over/Under threshold')}
                                    </label>
                                    <select
                                        id='rt-threshold'
                                        value={threshold_digit}
                                        disabled={state.is_armed}
                                        onChange={e => setThresholdDigit(Number(e.target.value))}
                                    >
                                        {DIGIT_OPTIONS.map(d => (
                                            <option key={d} value={d}>
                                                {d}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <SliderField
                                label={localize('Streak target')}
                                value={streak_target}
                                min={2}
                                max={10}
                                step={1}
                                disabled={state.is_armed}
                                onChange={v => setStreakTarget(Math.round(v))}
                                decimals={0}
                            />

                            <p className='reversal-trader__field-hint'>
                                Every time <strong>{reference_digit}</strong> appears, the digit right after it is checked
                                {mode === 'evenodd' ? ' for even/odd' : ` against ${threshold_digit} (over/under)`}. Once{' '}
                                <strong>{streak_target}</strong> in a row land the same way, the reversal (
                                {label_b}/{label_a}) is traded on the next tick.
                            </p>

                            <div className='reversal-trader__field-group'>
                                <ToggleSwitch
                                    checked={watch_all_markets}
                                    disabled={state.is_armed}
                                    onChange={setWatchAllMarkets}
                                    label={localize('Race across all markets')}
                                />
                            </div>

                            {!watch_all_markets && (
                                <div className='reversal-trader__field-group'>
                                    <label className='reversal-trader__field-label' htmlFor='rt-symbol'>
                                        {localize('Symbol')}
                                    </label>
                                    <select
                                        id='rt-symbol'
                                        value={symbol}
                                        disabled={state.is_armed}
                                        onChange={e => setSymbol(e.target.value)}
                                    >
                                        {symbol_options.map(s => (
                                            <option key={s.symbol} value={s.symbol}>
                                                {s.display_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        <div className='reversal-trader__panel'>
                            <h2>{localize('Stake & recovery')}</h2>

                            <SliderField
                                label={localize('Initial stake')}
                                value={initial_stake}
                                min={0.35}
                                max={20}
                                step={0.05}
                                disabled={state.is_armed}
                                onChange={setInitialStake}
                                prefix='$'
                                decimals={2}
                            />
                            <SliderField
                                label={localize('Martingale multiplier')}
                                value={martingale_mult}
                                min={1.5}
                                max={5}
                                step={0.1}
                                disabled={state.is_armed}
                                onChange={setMartingaleMult}
                                suffix='x'
                                decimals={1}
                            />
                            <SliderField
                                label={localize('Max martingale steps')}
                                value={max_martingale_steps}
                                min={2}
                                max={10}
                                step={1}
                                disabled={state.is_armed}
                                onChange={v => setMaxMartingaleSteps(Math.round(v))}
                                decimals={0}
                            />
                        </div>

                        <div className='reversal-trader__panel'>
                            <h2>{localize('Risk management')}</h2>
                            <SliderField
                                label={localize('Stop loss')}
                                value={stop_loss}
                                min={1}
                                max={200}
                                step={1}
                                disabled={state.is_armed}
                                onChange={setStopLoss}
                                prefix='$'
                                decimals={2}
                            />
                            <SliderField
                                label={localize('Take profit')}
                                value={take_profit}
                                min={10}
                                max={1000}
                                step={10}
                                disabled={state.is_armed}
                                onChange={setTakeProfit}
                                prefix='$'
                                decimals={2}
                            />
                        </div>

                        <div className='reversal-trader__actions'>
                            {!state.is_armed ? (
                                <button onClick={() => setShowConfirm(true)} className='btn btn-primary'>
                                    {localize('Start Trading')}
                                </button>
                            ) : (
                                <button onClick={() => stop()} className='btn btn-danger'>
                                    {localize('Stop Trading')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className='reversal-trader__col-output'>
                    {watch_all_markets && state.is_armed && (
                        <div className='reversal-trader__race-panel'>
                            <h3>{localize('Race progress')}</h3>
                            <div className='race-list'>
                                {race_rows.length > 0 ? (
                                    race_rows.map(([sym, progress]) => (
                                        <div
                                            key={sym}
                                            className={`race-item ${sym === state.active_symbol ? 'active' : ''}`}
                                        >
                                            <div className='race-header'>
                                                <span className='symbol'>{displayName(sym)}</span>
                                                <span className='progress-text'>
                                                    {directionLabel(progress.direction)} {progress.count}/{progress.target}
                                                </span>
                                            </div>
                                            <div className='progress-bar'>
                                                <div
                                                    className='progress-fill'
                                                    style={{
                                                        width: `${Math.min(100, (progress.count / progress.target) * 100)}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className='empty-state'>{localize('Waiting for market data...')}</div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className='reversal-trader__logs-panel'>
                        <h3>{localize('Activity Log')}</h3>
                        <div className='logs-container'>
                            {state.logs.length > 0 ? (
                                state.logs.map(log => (
                                    <div key={log.id} className={`log-entry log-${log.kind}`}>
                                        <span className='time'>{log.time}</span>
                                        <span className='text'>{log.text}</span>
                                    </div>
                                ))
                            ) : (
                                <div className='empty-state'>{localize('Waiting for activity...')}</div>
                            )}
                            <div ref={logEndRef} />
                        </div>
                    </div>
                </div>
            </div>

            {show_confirm && (
                <div className='modal-overlay' onClick={() => setShowConfirm(false)}>
                    <div className='modal-content' onClick={e => e.stopPropagation()}>
                        <h2>{localize('Confirm Trade Settings')}</h2>
                        <div className='confirm-details'>
                            <p>
                                <strong>Pattern:</strong> {reference_digit} → {streak_target}x{' '}
                                {mode === 'evenodd' ? 'even/odd' : `over/under ${threshold_digit}`}, then trade the reversal
                            </p>
                            <p>
                                <strong>Markets:</strong>{' '}
                                {watch_all_markets ? `${symbol_options.length} markets (race mode)` : displayName(symbol)}
                            </p>
                            <p>
                                <strong>Initial stake:</strong> ${initial_stake.toFixed(2)}
                            </p>
                            <p>
                                <strong>Max loss per trade:</strong> $
                                {(initial_stake * Math.pow(martingale_mult, max_martingale_steps - 1)).toFixed(2)}
                            </p>
                        </div>
                        <div className='modal-actions'>
                            <button onClick={() => setShowConfirm(false)} className='btn btn-secondary'>
                                {localize('Cancel')}
                            </button>
                            <button onClick={confirmStart} className='btn btn-primary'>
                                {localize('Confirm & Start')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default ReversalTrader;
