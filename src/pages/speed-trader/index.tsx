import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { localize } from '@deriv-com/translations';
import { useSpeedTrader } from './use-speed-trader';
import './speed-trader.scss';

const SpeedTrader = observer(() => {
    const { client } = useStore();
    const symbol_options = useSyntheticSymbols();

    const [symbol, setSymbol] = React.useState('1HZ100V');
    const [watch_all_markets, setWatchAllMarkets] = React.useState(false);
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
        start({ symbols, initial_stake, martingale_mult, max_martingale_steps, stop_loss, take_profit });
    };

    const displayName = (sym: string) => symbol_options.find(s => s.symbol === sym)?.display_name || sym;

    // Sort so the closest-to-triggering markets float to the top of the race panel.
    const race_rows = Object.entries(state.virtual_progress).sort(
        ([, a], [, b]) => b.count / b.target - a.count / a.target
    );

    return (
        <div className='speed-trader'>
            <div className='speed-trader__panel'>
                <div className='speed-trader__header'>
                    <h1>{localize('Speed Trader')}</h1>
                    <span className={`speed-trader__status ${state.is_armed ? 'live' : ''}`}>
                        {state.is_armed
                            ? state.is_loading
                                ? localize('Connecting…')
                                : state.active_symbol
                                  ? localize('LIVE — trading {{symbol}}', { symbol: displayName(state.active_symbol) })
                                  : localize('SCANNING — {{count}} markets', { count: state.watching.length })
                            : localize('Stopped')}
                    </span>
                </div>
                <p className='speed-trader__desc'>
                    {localize(
                        'Monitors the market continuously and executes trades automatically, with martingale recovery on loss.'
                    )}
                </p>

                <div className='speed-trader__controls-grid'>
                    <label className='speed-trader__checkbox-field'>
                        <input
                            type='checkbox'
                            checked={watch_all_markets}
                            disabled={state.is_armed}
                            onChange={e => setWatchAllMarkets(e.target.checked)}
                        />
                        <span>{localize('Trade all markets (race mode)')}</span>
                    </label>
                    <label>
                        <span>{localize('Symbol')}</span>
                        <select
                            value={symbol}
                            disabled={state.is_armed || watch_all_markets}
                            onChange={e => setSymbol(e.target.value)}
                        >
                            {symbol_options.map(s => (
                                <option key={s.symbol} value={s.symbol}>
                                    {s.display_name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        <span>{localize('Initial stake')}</span>
                        <input
                            type='number'
                            min={0.35}
                            step={0.01}
                            value={initial_stake}
                            disabled={state.is_armed}
                            onFocus={e => e.target.select()}
                            onChange={e => setInitialStake(Number(e.target.value) || 0.35)}
                        />
                    </label>
                    <label>
                        <span>{localize('Martingale multiplier')}</span>
                        <input
                            type='number'
                            min={1}
                            step={0.1}
                            value={martingale_mult}
                            disabled={state.is_armed}
                            onFocus={e => e.target.select()}
                            onChange={e => setMartingaleMult(Number(e.target.value) || 1)}
                        />
                    </label>
                    <label>
                        <span>{localize('Max martingale steps')}</span>
                        <input
                            type='number'
                            min={1}
                            step={1}
                            value={max_martingale_steps}
                            disabled={state.is_armed}
                            onFocus={e => e.target.select()}
                            onChange={e => setMaxMartingaleSteps(Number(e.target.value) || 5)}
                        />
                    </label>
                    <label>
                        <span>{localize('Stop loss (USD)')}</span>
                        <input
                            type='number'
                            min={0}
                            step={1}
                            value={stop_loss}
                            disabled={state.is_armed}
                            onFocus={e => e.target.select()}
                            onChange={e => setStopLoss(Number(e.target.value) || 0)}
                        />
                    </label>
                    <label>
                        <span>{localize('Take profit (USD)')}</span>
                        <input
                            type='number'
                            min={0}
                            step={0.1}
                            value={take_profit}
                            disabled={state.is_armed}
                            onFocus={e => e.target.select()}
                            onChange={e => setTakeProfit(Number(e.target.value) || 0)}
                        />
                    </label>
                </div>

                <div className='speed-trader__actions'>
                    {!state.is_armed ? (
                        <button type='button' className='speed-trader__btn start' onClick={handleStartClick}>
                            {localize('Start')}
                        </button>
                    ) : (
                        <button type='button' className='speed-trader__btn stop' onClick={stop}>
                            {localize('Stop')}
                        </button>
                    )}
                    <div className='speed-trader__live-stats'>
                        <div>
                            <span className='speed-trader__label'>{localize('PnL')}</span>
                            <span className={`speed-trader__value ${state.total_pnl >= 0 ? 'up' : 'down'}`}>
                                ${state.total_pnl.toFixed(2)}
                            </span>
                        </div>
                        <div>
                            <span className='speed-trader__label'>{localize('Next stake')}</span>
                            <span className='speed-trader__value'>${state.current_stake.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {state.is_armed && race_rows.length > 1 && (
                <div className='speed-trader__panel speed-trader__race-panel'>
                    <h2>{localize('Market race')}</h2>
                    <div className='speed-trader__race-list'>
                        {race_rows.map(([sym, progress]) => {
                            const is_active = state.active_symbol === sym;
                            const pct = Math.min(100, (progress.count / progress.target) * 100);
                            return (
                                <div
                                    key={sym}
                                    className={`speed-trader__race-row ${is_active ? 'active' : ''}`}
                                    aria-label={`${displayName(sym)}: ${progress.count} of ${progress.target} virtual losses`}
                                >
                                    <span className='speed-trader__race-name'>{displayName(sym)}</span>
                                    <div className='speed-trader__race-bar'>
                                        <div className='speed-trader__race-bar-fill' style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className='speed-trader__race-count'>
                                        {progress.count}/{progress.target}
                                        {is_active ? ` ${localize('LIVE')}` : ''}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className='speed-trader__panel speed-trader__log-panel'>
                <h2>{localize('Live log')}</h2>
                <div className='speed-trader__log'>
                    {state.logs.length === 0 && (
                        <div className='speed-trader__log-empty'>{localize('No activity yet.')}</div>
                    )}
                    {state.logs.map(entry => (
                        <div className={`speed-trader__log-row ${entry.kind}`} key={entry.id}>
                            <span className='speed-trader__log-time'>{entry.time}</span>
                            <span className='speed-trader__log-text'>{entry.text}</span>
                        </div>
                    ))}
                    <div ref={logEndRef} />
                </div>
            </div>

            {show_confirm && (
                <div className='speed-trader__confirm-overlay'>
                    <div className='speed-trader__confirm-box'>
                        <h3>{localize('Start live speed trading?')}</h3>
                        <p>
                            {localize(
                                'This trades with real funds automatically, without waiting for each contract to fully settle before deciding the next move. Stake'
                            )}{' '}
                            ${initial_stake.toFixed(2)}, {localize('martingale')} {martingale_mult}x ({localize('max')}{' '}
                            {max_martingale_steps} {localize('steps')}), {localize('stop loss')} ${stop_loss},{' '}
                            {localize('take profit')} ${take_profit}{' '}
                            {watch_all_markets
                                ? localize('across all {{count}} markets — first to hit the loss target trades.', {
                                      count: symbol_options.length,
                                  })
                                : `${localize('on')} ${symbol}.`}
                        </p>
                        <div className='speed-trader__confirm-actions'>
                            <button
                                type='button'
                                className='speed-trader__btn-secondary'
                                onClick={() => setShowConfirm(false)}
                            >
                                {localize('Cancel')}
                            </button>
                            <button type='button' className='speed-trader__btn start' onClick={confirmStart}>
                                {localize('Start trading')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default SpeedTrader;
