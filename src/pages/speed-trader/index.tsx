import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { localize } from '@deriv-com/translations';
import { useSpeedTrader, TSide } from './use-speed-trader';
import './speed-trader.scss';

const CONTRACT_TYPES: { value: TSide; label: string; description: string }[] = [
    { value: 'even', label: 'Even', description: 'Last digit is even (0,2,4,6,8)' },
    { value: 'odd', label: 'Odd', description: 'Last digit is odd (1,3,5,7,9)' },
    { value: 'over4', label: 'Over 4', description: 'Last digit > 4 (5,6,7,8,9)' },
    { value: 'under5', label: 'Under 5', description: 'Last digit < 5 (0,1,2,3,4)' },
    { value: 'rise', label: 'Rise', description: 'Digit rises from previous' },
    { value: 'fall', label: 'Fall', description: 'Digit falls from previous' },
];

const SpeedTrader = observer(() => {
    const { client } = useStore();
    const symbol_options = useSyntheticSymbols();

    const [symbol, setSymbol] = React.useState('1HZ100V');
    const [watch_all_markets, setWatchAllMarkets] = React.useState(false);
    const [contract_type, setContractType] = React.useState<TSide>('even');
    const [virtual_loss_mode, setVirtualLossMode] = React.useState<'random' | 'fixed'>('random');
    const [initial_stake, setInitialStake] = React.useState(0.35);
    const [martingale_mult, setMartingaleMult] = React.useState(2);
    const [max_martingale_steps, setMaxMartingaleSteps] = React.useState(5);
    const [stop_loss, setStopLoss] = React.useState(5);
    const [take_profit, setTakeProfit] = React.useState(100);
    const [show_confirm, setShowConfirm] = React.useState(false);

    const { state, start, stop } = useSpeedTrader(client?.currency);
    const logEndRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state.logs.length]);

    const handleStartClick = () => setShowConfirm(true);

    const confirmStart = () => {
        setShowConfirm(false);
        const symbols = watch_all_markets ? symbol_options.map(s => s.symbol) : [symbol];
        start({
            symbols,
            initial_stake,
            martingale_mult,
            max_martingale_steps,
            stop_loss,
            take_profit,
            virtual_loss_mode,
            contract_type,
        });
    };

    const displayName = (sym: string) => symbol_options.find(s => s.symbol === sym)?.display_name || sym;
    const contractLabel = CONTRACT_TYPES.find(t => t.value === contract_type)?.label || 'Even';

    // Sort so the closest-to-triggering markets float to the top of the race panel.
    const race_rows = Object.entries(state.virtual_progress).sort(
        ([, a], [, b]) => b.count / b.target - a.count / a.target
    );

    return (
        <div className='speed-trader'>
            <div className='speed-trader__layout'>
                {/* Left Column - Controls & Status */}
                <div className='speed-trader__col-controls'>
                    {/* Header */}
                    <div className='speed-trader__header'>
                        <h1 className='speed-trader__title'>{localize('Speed Trader')}</h1>
                        <div className={`speed-trader__badge ${state.is_armed ? 'live' : 'stopped'}`}>
                            {state.is_armed ? (state.is_loading ? '🔄 Connecting' : '🟢 LIVE') : '⏹️ Stopped'}
                        </div>
                    </div>

                    {/* Status Info */}
                    {state.is_armed && (
                        <div className='speed-trader__status-card'>
                            <div className='status-row'>
                                <span className='label'>Status:</span>
                                <span className='value'>
                                    {state.active_symbol ? (
                                        <>Trading {displayName(state.active_symbol)}</>
                                    ) : (
                                        <>Scanning {state.watching.length} markets</>
                                    )}
                                </span>
                            </div>
                            <div className='status-row'>
                                <span className='label'>Strategy:</span>
                                <span className='value'>{contractLabel}</span>
                            </div>
                            <div className='status-row'>
                                <span className='label'>Current Stake:</span>
                                <span className='value'>${state.current_stake.toFixed(2)}</span>
                            </div>
                            <div className='status-row'>
                                <span className={`value ${state.total_pnl >= 0 ? 'profit' : 'loss'}`}>
                                    ${state.total_pnl.toFixed(2)} P&L
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Controls */}
                    <div className='speed-trader__controls'>
                        <div className='control-section'>
                            <h3 className='section-title'>{localize('Strategy')}</h3>

                            <div className='control-group'>
                                <label>{localize('Contract Type')}</label>
                                <select
                                    value={contract_type}
                                    disabled={state.is_armed}
                                    className='contract-select'
                                    onChange={e => setContractType(e.target.value as TSide)}
                                >
                                    {CONTRACT_TYPES.map(ct => (
                                        <option key={ct.value} value={ct.value}>
                                            {ct.label} - {ct.description}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className='control-group'>
                                <label>
                                    <input
                                        type='checkbox'
                                        checked={watch_all_markets}
                                        disabled={state.is_armed}
                                        onChange={e => setWatchAllMarkets(e.target.checked)}
                                    />
                                    <span>{localize('Trade all markets (race mode)')}</span>
                                </label>
                            </div>

                            {!watch_all_markets && (
                                <div className='control-group'>
                                    <label>{localize('Symbol')}</label>
                                    <select
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

                        <div className='control-section'>
                            <h3 className='section-title'>{localize('Entry & Recovery')}</h3>

                            <div className='control-group'>
                                <label>{localize('Virtual Loss Target')}</label>
                                <select
                                    value={virtual_loss_mode}
                                    disabled={state.is_armed}
                                    onChange={e => setVirtualLossMode(e.target.value as 'random' | 'fixed')}
                                >
                                    <option value='random'>{localize('Randomized (3-5)')}</option>
                                    <option value='fixed'>{localize('Fixed (5)')}</option>
                                </select>
                            </div>

                            <div className='control-group'>
                                <label>
                                    {localize('Initial Stake')}{' '}
                                    <span className='value'>${initial_stake.toFixed(2)}</span>
                                </label>
                                <input
                                    type='range'
                                    min='0.1'
                                    max='10'
                                    step='0.05'
                                    value={initial_stake}
                                    disabled={state.is_armed}
                                    onChange={e => setInitialStake(parseFloat(e.target.value))}
                                />
                            </div>

                            <div className='control-group'>
                                <label>
                                    {localize('Martingale Multiplier')}{' '}
                                    <span className='value'>{martingale_mult.toFixed(1)}x</span>
                                </label>
                                <input
                                    type='range'
                                    min='1.5'
                                    max='5'
                                    step='0.1'
                                    value={martingale_mult}
                                    disabled={state.is_armed}
                                    onChange={e => setMartingaleMult(parseFloat(e.target.value))}
                                />
                            </div>

                            <div className='control-group'>
                                <label>
                                    {localize('Max Martingale Steps')}{' '}
                                    <span className='value'>{max_martingale_steps}</span>
                                </label>
                                <input
                                    type='range'
                                    min='2'
                                    max='10'
                                    step='1'
                                    value={max_martingale_steps}
                                    disabled={state.is_armed}
                                    onChange={e => setMaxMartingaleSteps(parseInt(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className='control-section'>
                            <h3 className='section-title'>{localize('Risk Management')}</h3>

                            <div className='control-group'>
                                <label>
                                    {localize('Stop Loss')}{' '}
                                    <span className='value'>${stop_loss.toFixed(2)}</span>
                                </label>
                                <input
                                    type='range'
                                    min='1'
                                    max='100'
                                    step='1'
                                    value={stop_loss}
                                    disabled={state.is_armed}
                                    onChange={e => setStopLoss(parseFloat(e.target.value))}
                                />
                            </div>

                            <div className='control-group'>
                                <label>
                                    {localize('Take Profit')}{' '}
                                    <span className='value'>${take_profit.toFixed(2)}</span>
                                </label>
                                <input
                                    type='range'
                                    min='10'
                                    max='500'
                                    step='10'
                                    value={take_profit}
                                    disabled={state.is_armed}
                                    onChange={e => setTakeProfit(parseFloat(e.target.value))}
                                />
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className='speed-trader__actions'>
                            {!state.is_armed ? (
                                <button onClick={handleStartClick} className='btn btn-primary'>
                                    {localize('Start Trading')}
                                </button>
                            ) : (
                                <button onClick={stop} className='btn btn-danger'>
                                    {localize('Stop Trading')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column - Race Progress & Logs */}
                <div className='speed-trader__col-output'>
                    {/* Race Progress */}
                    {watch_all_markets && state.is_armed && (
                        <div className='speed-trader__race-panel'>
                            <h3>{localize('Race Progress')}</h3>
                            <div className='race-list'>
                                {race_rows.length > 0 ? (
                                    race_rows.map(([sym, progress]) => (
                                        <div key={sym} className={`race-item ${sym === state.active_symbol ? 'active' : ''}`}>
                                            <div className='race-header'>
                                                <span className='symbol'>{displayName(sym)}</span>
                                                <span className='progress-text'>
                                                    {progress.count}/{progress.target}
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

                    {/* Logs */}
                    <div className='speed-trader__logs-panel'>
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

            {/* Confirmation Modal */}
            {show_confirm && (
                <div className='modal-overlay' onClick={() => setShowConfirm(false)}>
                    <div className='modal-content' onClick={e => e.stopPropagation()}>
                        <h2>{localize('Confirm Trade Settings')}</h2>
                        <div className='confirm-details'>
                            <p>
                                <strong>Strategy:</strong> {contractLabel}
                            </p>
                            <p>
                                <strong>Markets:</strong>{' '}
                                {watch_all_markets ? `${state.watching.length} markets (race mode)` : displayName(symbol)}
                            </p>
                            <p>
                                <strong>Initial Stake:</strong> ${initial_stake.toFixed(2)}
                            </p>
                            <p>
                                <strong>Max Loss/Trade:</strong> ${(initial_stake * Math.pow(martingale_mult, max_martingale_steps - 1)).toFixed(2)}
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

export default SpeedTrader;
