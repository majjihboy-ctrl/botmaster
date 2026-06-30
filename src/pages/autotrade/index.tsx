import React from 'react';
import { observer } from 'mobx-react-lite';
import { AUTOTRADE_BOTS, TAutotradeBot } from '@/constants/autotrade-bots';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useScanSymbols, useMultiMarketScanner, TScanSignal } from './multi-market-scanner';
import './autotrade.scss';

const AutotradeTab = observer(() => {
    const { load_modal, run_panel } = useStore();
    const { loadAutotradeBot } = load_modal;
    const { is_running, onStopBotClick } = run_panel;

    const [selected_bot, setSelectedBot] = React.useState<TAutotradeBot>(AUTOTRADE_BOTS[0]);
    const [stake, setStake] = React.useState(1);
    const [martingale, setMartingale] = React.useState(2);
    const [take_profit, setTakeProfit] = React.useState(100);
    const [stop_loss, setStopLoss] = React.useState(100);
    const [is_armed, setIsArmed] = React.useState(false);
    const [show_confirm, setShowConfirm] = React.useState(false);
    const [last_signal, setLastSignal] = React.useState<TScanSignal | null>(null);
    const [is_executing, setIsExecuting] = React.useState(false);

    const symbols = useScanSymbols();

    const handleSignal = React.useCallback(
        async (signal: TScanSignal) => {
            if (is_executing || is_running) return; // don't fire a second trade while one is open
            setIsExecuting(true);
            setLastSignal(signal);
            try {
                await loadAutotradeBot(selected_bot.id, selected_bot.title, {
                    stake,
                    take_profit,
                    stop_loss,
                    martingale_size: martingale,
                    symbol: signal.symbol,
                });
                run_panel.onRunButtonClick();
            } finally {
                setIsExecuting(false);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [is_executing, is_running, selected_bot, stake, take_profit, stop_loss, martingale]
    );

    const statuses = useMultiMarketScanner(symbols, is_armed, handleSignal);

    const handleStart = () => setShowConfirm(true);

    const confirmStart = () => {
        setShowConfirm(false);
        setIsArmed(true);
    };

    const handleStop = () => {
        setIsArmed(false);
        if (is_running) onStopBotClick();
    };

    return (
        <div className='autotrade'>
            <div className='autotrade__sidebar'>
                <div className='autotrade__sidebar-title'>{localize('Auto Trades')}</div>
                <div className='autotrade__sidebar-category'>{localize('Digits')}</div>
                {AUTOTRADE_BOTS.map(bot => (
                    <button
                        key={bot.id}
                        type='button'
                        className={`autotrade__sidebar-item ${selected_bot.id === bot.id ? 'active' : ''}`}
                        disabled={is_armed}
                        onClick={() => setSelectedBot(bot)}
                    >
                        {bot.title}
                    </button>
                ))}
            </div>

            <div className='autotrade__main'>
                <div className='autotrade__panel'>
                    <h2>{localize('Auto Trades — Multi-Market Scan')}</h2>
                    <p className='autotrade__scope-text'>
                        {localize(
                            'Watches every Volatility and Jump index simultaneously. The bot trades the instant any one of them signals an entry.'
                        )}
                    </p>

                    <div className='autotrade__controls-grid'>
                        <label>
                            <span>{localize('Stake (USD)')}</span>
                            <input
                                type='number'
                                min={0.35}
                                step={0.01}
                                value={stake}
                                disabled={is_armed}
                                onChange={e => setStake(Number(e.target.value) || 0)}
                            />
                        </label>
                        <label>
                            <span>{localize('Martingale multiplier')}</span>
                            <input
                                type='number'
                                min={1}
                                step={0.1}
                                value={martingale}
                                disabled={is_armed}
                                onChange={e => setMartingale(Number(e.target.value) || 1)}
                            />
                        </label>
                        <label>
                            <span>{localize('Take Profit (USD)')}</span>
                            <input
                                type='number'
                                min={0}
                                step={1}
                                value={take_profit}
                                disabled={is_armed}
                                onChange={e => setTakeProfit(Number(e.target.value) || 0)}
                            />
                        </label>
                        <label>
                            <span>{localize('Stop Loss (USD)')}</span>
                            <input
                                type='number'
                                min={0}
                                step={1}
                                value={stop_loss}
                                disabled={is_armed}
                                onChange={e => setStopLoss(Number(e.target.value) || 0)}
                            />
                        </label>
                    </div>

                    <div className='autotrade__actions'>
                        {!is_armed ? (
                            <button type='button' className='autotrade__btn start' onClick={handleStart}>
                                {localize('Start')}
                            </button>
                        ) : (
                            <button type='button' className='autotrade__btn stop' onClick={handleStop}>
                                {localize('Stop')}
                            </button>
                        )}
                        <span className={`autotrade__status ${is_armed ? 'live' : ''}`}>
                            {is_armed
                                ? is_running || is_executing
                                    ? localize('Trade in progress…')
                                    : localize('Scanning all markets…')
                                : localize('Stopped')}
                        </span>
                    </div>

                    {last_signal && (
                        <div className='autotrade__last-signal'>
                            {localize('Last entry')}: {last_signal.display_name} —{' '}
                            {new Date(last_signal.at).toLocaleTimeString()}
                        </div>
                    )}
                </div>

                <div className='autotrade__panel'>
                    <h2>{localize('Main Strategy')}</h2>
                    <div className='autotrade__strategy-grid'>
                        <div>
                            <span className='autotrade__strategy-label'>{localize('Direction')}</span>
                            <div className='autotrade__strategy-value'>{selected_bot.direction}</div>
                        </div>
                        <div>
                            <span className='autotrade__strategy-label'>{localize('Barrier')}</span>
                            <div className='autotrade__strategy-value'>{selected_bot.barrier}</div>
                        </div>
                    </div>
                    <p className='autotrade__strategy-desc'>{selected_bot.description}</p>
                </div>

                <div className='autotrade__panel'>
                    <h2>{localize('Live market scan')}</h2>
                    <div className='autotrade__scan-grid'>
                        {symbols.map(s => {
                            const status = statuses[s.symbol];
                            const stage = status?.stage ?? 0;
                            const is_connected = status?.is_connected ?? false;
                            return (
                                <div className='autotrade__scan-card' key={s.symbol}>
                                    <div className='autotrade__scan-name'>
                                        {s.display_name}
                                        {!is_connected && is_armed && (
                                            <span className='autotrade__scan-disconnected' title='No ticks received yet'>
                                                ●
                                            </span>
                                        )}
                                    </div>
                                    <div className='autotrade__scan-stage-row'>
                                        {[0, 1, 2].map(step => (
                                            <span
                                                key={step}
                                                className={`autotrade__scan-dot ${stage >= step ? 'filled' : ''}`}
                                            />
                                        ))}
                                    </div>
                                    <div className='autotrade__scan-digit'>{status?.last_digit ?? '—'}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {show_confirm && (
                <div className='autotrade__confirm-overlay'>
                    <div className='autotrade__confirm-box'>
                        <h3>{localize('Start live auto-trading?')}</h3>
                        <p>
                            {localize('This will trade real funds automatically with stake')} ${stake.toFixed(2)}{' '}
                            {localize('using')} {selected_bot.title}{' '}
                            {localize('across every Volatility and Jump market, the instant any one signals.')}
                        </p>
                        <div className='autotrade__confirm-actions'>
                            <button
                                type='button'
                                className='autotrade__btn-secondary'
                                onClick={() => setShowConfirm(false)}
                            >
                                {localize('Cancel')}
                            </button>
                            <button type='button' className='autotrade__btn start' onClick={confirmStart}>
                                {localize('Start trading')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default AutotradeTab;
