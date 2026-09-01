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
    const [require_confirmation, setRequireConfirmation] = React.useState(false);
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
            require_confirmation,
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
            <div className='speed-trader__topbar'>
                <div className='speed-trader__title'>
                    <h1>{localize('Speed Trader')}</h1>
                    <span className={`speed-trader__live ${!state.is_armed ? 'stale' : ''}`}>
                        <span className='speed-trader__pulse' />
                        {state.is_armed
                            ? state.is_loading
                                ? localize('CONNECTING')
                                : state.active_symbol
                                  ? localize('LIVE')
                                  : localize('SCANNING')
                            : localize('STOPPED')}
                    </span>
                </div>
            </div>

            <div className='speed-trader__layout'>
                <div className='speed-trader__col-main'>
                    {state.is_armed && (
                        <div className='speed-trader__panel'>
                            <h2>{localize('Status')}</h2>
                            <div className='speed-trader__status-grid'>
                                <div className='speed-trader__stat-row'>
                                    <span className='speed-trader__field-label'>{localize('Status')}</span>
                                    <span className='speed-trader__stat-value'>
                                        {state.active_symbol ? (
                                            <>{localize('Trading {{symbol}}', { symbol: displayName(state.active_symbol) })}</>
                                        ) : (
                                            <>{localize('Scanning {{count}} markets', { count: state.watching.length })}</>
                                        )}
                                    </span>
                                </div>
                                <div className='speed-trader__stat-row'>
                                    <span className='speed-trader__field-label'>{localize('Strategy')}</span>
                                    <span className='speed-trader__stat-value'>{contractLabel}</span>
                                </div>
                                <div className='speed-trader__stat-row'>
                                    <span className='speed-trader__field-label'>{localize('Current stake')}</span>
                                    <span className='speed-trader__stat-value'>${state.current_stake.toFixed(2)}</span>
                                </div>
                                <div className='speed-trader__stat-row'>
                                    <span className='speed-trader__field-label'>{localize('P&L')}</span>
                                    <span
                                        className={`speed-trader__stat-value ${state.total_pnl >= 0 ? 'up' : 'down'}`}
                                    >
                                        ${state.total_pnl.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className='speed-trader__panel'>
                        <h2>{localize('Strategy')}</h2>

                        <div className='speed-trader__controls'>
                            <label className='speed-trader__field-label' htmlFor='speed-trader-contract-type'>
                                {localize('Contract type')}
                            </label>
                            <select
                                id='speed-trader-contract-type'
                                value={contract_type}
                                disabled={state.is_armed}
                                onChange={e => setContractType(e.target.value as TSide)}
                            >
                                {CONTRACT_TYPES.map(ct => (
                                    <option key={ct.value} value={ct.value}>
                                        {ct.label} — {ct.description}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className='speed-trader__checkbox-field'>
                            <input
                                type='checkbox'
                                id='speed-trader-watch-all'
                                checked={watch_all_markets}
                                disabled={state.is_armed}
                                onChange={e => setWatchAllMarkets(e.target.checked)}
                            />
                            <label htmlFor='speed-trader-watch-all'>{localize('Trade all markets (race mode)')}</label>
                        </div>

                        {!watch_all_markets && (
                            <div className='speed-trader__controls'>
                                <label className='speed-trader__field-label' htmlFor='speed-trader-symbol'>
                                    {localize('Symbol')}
                                </label>
                                <select
                                    id='speed-trader-symbol'
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

                    <div className='speed-trader__panel'>
                        <h2>{localize('Entry & recovery')}</h2>

                        <div className='speed-trader__controls'>
                            <label className='speed-trader__field-label' htmlFor='speed-trader-loss-mode'>
                                {localize('Virtual loss target')}
                            </label>
                            <select
                                id='speed-trader-loss-mode'
                                value={virtual_loss_mode}
                                disabled={state.is_armed}
                                onChange={e => setVirtualLossMode(e.target.value as 'random' | 'fixed')}
                            >
                                <option value='random'>{localize('Randomized (3-5)')}</option>
                                <option value='fixed'>{localize('Fixed (5)')}</option>
                            </select>
                        </div>

                        <div className='speed-trader__controls'>
                            <label className='speed-trader__checkbox-label'>
                                <input
                                    type='checkbox'
                                    checked={require_confirmation}
                                    disabled={state.is_armed}
                                    onChange={e => setRequireConfirmation(e.target.checked)}
                                />
                                <span>{localize('Require confirmation tick')}</span>
                            </label>
                            <p className='speed-trader__field-hint'>
                                {localize(
                                    'After the loss streak hits target, wait for the streak to actually break (a real winning tick) before trading — instead of firing the instant the target is reached.'
                                )}
                            </p>
                        </div>

                        <div className='speed-trader__slider-field'>
                            <div className='speed-trader__slider-label-row'>
                                <span className='speed-trader__field-label'>{localize('Initial stake')}</span>
                                <span className='speed-trader__slider-value'>${initial_stake.toFixed(2)}</span>
                            </div>
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

                        <div className='speed-trader__slider-field'>
                            <div className='speed-trader__slider-label-row'>
                                <span className='speed-trader__field-label'>{localize('Martingale multiplier')}</span>
                                <span className='speed-trader__slider-value'>{martingale_mult.toFixed(1)}x</span>
                            </div>
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

                        <div className='speed-trader__slider-field'>
                            <div className='speed-trader__slider-label-row'>
                                <span className='speed-trader__field-label'>{localize('Max martingale steps')}</span>
                                <span className='speed-trader__slider-value'>{max_martingale_steps}</span>
                            </div>
                            <input
                                type='range'
                                min='2'
                                max='10'
                                step='1'
                                value={max_martingale_steps}
                                disabled={state.is_armed}
                                onChange={e => setMaxMartingaleSteps(parseInt(e.target.value, 10))}
                            />
                        </div>
                    </div>

                    <div className='speed-trader__panel'>
                        <h2>{localize('Risk management')}</h2>

                        <div className='speed-trader__slider-field'>
                            <div className='speed-trader__slider-label-row'>
                                <span className='speed-trader__field-label'>{localize('Stop loss')}</span>
                                <span className='speed-trader__slider-value'>${stop_loss.toFixed(2)}</span>
                            </div>
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

                        <div className='speed-trader__slider-field'>
                            <div className='speed-trader__slider-label-row'>
                                <span className='speed-trader__field-label'>{localize('Take profit')}</span>
                                <span className='speed-trader__slider-value'>${take_profit.toFixed(2)}</span>
                            </div>
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

                        <div className='speed-trader__actions'>
                            {!state.is_armed ? (
                                <button type='button' className='speed-trader__btn start' onClick={handleStartClick}>
                                    {localize('Start trading')}
                                </button>
                            ) : (
                                <button type='button' className='speed-trader__btn stop' onClick={stop}>
                                    {localize('Stop trading')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className='speed-trader__col-side'>
                    {watch_all_markets && state.is_armed && (
                        <div className='speed-trader__panel speed-trader__race-panel'>
                            <h2>{localize('Race progress')}</h2>
                            <div className='speed-trader__race-list'>
                                {race_rows.length > 0 ? (
                                    race_rows.map(([sym, progress]) => {
                                        const is_active = sym === state.active_symbol;
                                        const pct = Math.min(100, (progress.count / progress.target) * 100);
                                        return (
                                            <div
                                                key={sym}
                                                className={`speed-trader__race-row ${is_active ? 'active' : ''} ${progress.awaiting_confirmation ? 'confirming' : ''}`}
                                                aria-label={`${displayName(sym)}: ${progress.count} of ${progress.target} virtual losses`}
                                            >
                                                <span className='speed-trader__race-name'>{displayName(sym)}</span>
                                                <div className='speed-trader__race-bar'>
                                                    <div className='speed-trader__race-bar-fill' style={{ width: `${pct}%` }} />
                                                </div>
                                                <span className='speed-trader__race-count'>
                                                    {progress.awaiting_confirmation
                                                        ? localize('confirming…')
                                                        : `${progress.count}/${progress.target}`}
                                                    {is_active ? ` ${localize('LIVE')}` : ''}
                                                </span>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className='speed-trader__empty-state'>{localize('Waiting for market data…')}</div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className='speed-trader__panel speed-trader__log-panel'>
                        <h2>{localize('Live log')}</h2>
                        <div className='speed-trader__log'>
                            {state.logs.length === 0 && (
                                <div className='speed-trader__log-empty'>{localize('No activity yet.')}</div>
                            )}
                            {state.logs.map(log => (
                                <div key={log.id} className={`speed-trader__log-row ${log.kind}`}>
                                    <span className='speed-trader__log-time'>{log.time}</span>
                                    <span>{log.text}</span>
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    </div>
                </div>
            </div>

            {show_confirm && (
                <div className='speed-trader__confirm-overlay' onClick={() => setShowConfirm(false)}>
                    <div className='speed-trader__confirm-box' onClick={e => e.stopPropagation()}>
                        <h3>{localize('Confirm trade settings')}</h3>
                        <p>
                            <strong>{localize('Strategy')}:</strong> {contractLabel}
                            <br />
                            <strong>{localize('Markets')}:</strong>{' '}
                            {watch_all_markets
                                ? localize('{{count}} markets (race mode)', { count: state.watching.length })
                                : displayName(symbol)}
                            <br />
                            <strong>{localize('Initial stake')}:</strong> ${initial_stake.toFixed(2)}
                            <br />
                            <strong>{localize('Max loss per trade')}:</strong> $
                            {(initial_stake * Math.pow(martingale_mult, max_martingale_steps - 1)).toFixed(2)}
                            <br />
                            <strong>{localize('Confirmation tick')}:</strong>{' '}
                            {require_confirmation ? localize('Required') : localize('Off — trades instantly at target')}
                        </p>
                        <div className='speed-trader__confirm-actions'>
                            <button type='button' className='speed-trader__btn-secondary' onClick={() => setShowConfirm(false)}>
                                {localize('Cancel')}
                            </button>
                            <button type='button' className='speed-trader__btn start' onClick={confirmStart}>
                                {localize('Confirm & start')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default SpeedTrader;
