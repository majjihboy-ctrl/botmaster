import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { localize } from '@deriv-com/translations';
import { SliderField } from './reversal-trader-fields';
import { consumePendingReversalConfig } from './trade-bridge';
import { useMarketScanner, TScanMode, TScanEntry } from './use-market-scanner';
import { useReversalTrader } from './use-reversal-trader';
import './digit-pattern.scss';

const DIGIT_OPTIONS = Array.from({ length: 10 }, (_, i) => i);
const LAST_SETTINGS_KEY = 'digit_pattern_last_settings';

type TLastSettings = {
    initial_stake: number;
    martingale_mult: number;
    max_martingale_steps: number;
    stop_loss: number;
    take_profit: number;
    min_streak: number;
};

const loadLastSettings = (): Partial<TLastSettings> => {
    try {
        const raw = localStorage.getItem(LAST_SETTINGS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const saveLastSettings = (settings: TLastSettings) => {
    try {
        localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // non-fatal
    }
};

const opposite = (dir: TScanEntry['direction']) => {
    if (dir === 'even') return 'odd';
    if (dir === 'odd') return 'even';
    if (dir === 'over') return 'under';
    return 'over';
};

const DigitPattern = observer(() => {
    const { client } = useStore();
    const symbol_options = useSyntheticSymbols();

    const [mode, setMode] = React.useState<TScanMode>('evenodd');
    const [threshold_digit, setThresholdDigit] = React.useState(5);
    const [min_streak, setMinStreak] = React.useState(() => loadLastSettings().min_streak ?? 7);

    const [initial_stake, setInitialStake] = React.useState(() => loadLastSettings().initial_stake ?? 0.35);
    const [martingale_mult, setMartingaleMult] = React.useState(() => loadLastSettings().martingale_mult ?? 2);
    const [max_martingale_steps, setMaxMartingaleSteps] = React.useState(
        () => loadLastSettings().max_martingale_steps ?? 5
    );
    const [stop_loss, setStopLoss] = React.useState(() => loadLastSettings().stop_loss ?? 5);
    const [take_profit, setTakeProfit] = React.useState(() => loadLastSettings().take_profit ?? 100);

    const [show_confirm, setShowConfirm] = React.useState(false);
    const pendingEntryRef = React.useRef<TScanEntry | null>(null);

    const { state, start, stop } = useReversalTrader(client?.currency);
    const scanner = useMarketScanner(symbol_options, mode, threshold_digit, state.is_armed);

    const logEndRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state.logs.length]);

    // Signals' "Trade this" bridge still lands here — same one-click flow,
    // just now the scanner IS the default view instead of a manual form.
    React.useEffect(() => {
        const pending = consumePendingReversalConfig();
        if (!pending) return;
        setMode(pending.mode);
        setThresholdDigit(pending.threshold_digit);
        pendingEntryRef.current = {
            symbol: pending.symbol,
            display_name: symbol_options.find(s => s.symbol === pending.symbol)?.display_name ?? pending.symbol,
            digit: pending.reference_digit,
            direction: pending.current_direction,
            count: pending.current_streak,
        };
        setShowConfirm(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const visible_entries = scanner.entries.filter(e => e.count >= min_streak);
    const best_entry = visible_entries[0];

    const openEntry = (entry: TScanEntry) => {
        pendingEntryRef.current = entry;
        setShowConfirm(true);
    };

    const confirmStart = () => {
        const entry = pendingEntryRef.current;
        if (!entry) return;
        setShowConfirm(false);
        saveLastSettings({ initial_stake, martingale_mult, max_martingale_steps, stop_loss, take_profit, min_streak });

        start({
            symbols: [entry.symbol],
            reference_digit: entry.digit,
            mode,
            threshold_digit,
            streak_target: entry.count,
            initial_stake,
            martingale_mult,
            max_martingale_steps,
            stop_loss,
            take_profit,
            preloaded_trigger: { digit: entry.digit, direction: entry.direction, count: entry.count },
        });
        pendingEntryRef.current = null;
    };

    const cancelEntry = () => {
        pendingEntryRef.current = null;
        setShowConfirm(false);
    };

    const label_a = mode === 'evenodd' ? 'EVEN' : 'OVER';
    const label_b = mode === 'evenodd' ? 'ODD' : 'UNDER';

    return (
        <div className='digit-pattern'>
            <div className='digit-pattern__topbar'>
                <div className='digit-pattern__title'>
                    <h1>{localize('Digit Pattern')}</h1>
                    <span className={`digit-pattern__live ${scanner.is_loading ? 'connecting' : ''}`}>
                        <span className='digit-pattern__pulse' />
                        {scanner.is_loading
                            ? `CONNECTING ${scanner.connected_count}/${scanner.total_count}`
                            : `SCANNING ${scanner.total_count} MARKETS`}
                    </span>
                </div>
                {state.is_armed && (
                    <div className='digit-pattern__status-line'>
                        <span>
                            Trading <strong>{state.active_symbol}</strong>
                        </span>
                        <span>
                            Pattern <strong>{pendingEntryRef.current?.digit ?? '—'}</strong>
                        </span>
                    </div>
                )}
            </div>

            {state.is_armed && (
                <div className='digit-pattern__stat-cards'>
                    <div className='digit-pattern__stat-card'>
                        <span className='digit-pattern__stat-label'>{localize('Current stake')}</span>
                        <span className='digit-pattern__stat-value'>${state.current_stake.toFixed(2)}</span>
                    </div>
                    <div className={`digit-pattern__stat-card ${state.total_pnl >= 0 ? 'profit' : 'loss'}`}>
                        <span className='digit-pattern__stat-label'>{localize('Total P&L')}</span>
                        <span className='digit-pattern__stat-value'>
                            {state.total_pnl >= 0 ? '+' : ''}
                            ${state.total_pnl.toFixed(2)}
                        </span>
                    </div>
                    <div className='digit-pattern__stat-card'>
                        <span className='digit-pattern__stat-label'>{localize('Status')}</span>
                        <span className='digit-pattern__stat-value small'>
                            {state.is_loading ? 'Connecting…' : 'Armed'}
                        </span>
                    </div>
                    <div className='digit-pattern__stat-card'>
                        <button className='digit-pattern__btn danger full' onClick={() => stop()}>
                            {localize('Stop')}
                        </button>
                    </div>
                </div>
            )}

            <div className='digit-pattern__grid'>
                <div className='digit-pattern__col-main'>
                    <div className='digit-pattern__panel'>
                        <div className='digit-pattern__scanner-controls'>
                            <div className='digit-pattern__mode-toggle'>
                                <button className={mode === 'evenodd' ? 'active' : ''} onClick={() => setMode('evenodd')}>
                                    Even / Odd
                                </button>
                                <button
                                    className={mode === 'overunder' ? 'active' : ''}
                                    onClick={() => setMode('overunder')}
                                >
                                    Over / Under
                                </button>
                            </div>

                            {mode === 'overunder' && (
                                <div className='digit-pattern__field-group inline'>
                                    <label className='digit-pattern__field-label' htmlFor='dp-threshold'>
                                        {localize('Threshold')}
                                    </label>
                                    <select
                                        id='dp-threshold'
                                        value={threshold_digit}
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

                            <div className='digit-pattern__field-group inline grow'>
                                <label className='digit-pattern__field-label' htmlFor='dp-min-streak'>
                                    {localize('Minimum streak to show')}: <strong>{min_streak}+</strong>
                                </label>
                                <input
                                    id='dp-min-streak'
                                    type='range'
                                    min={3}
                                    max={12}
                                    step={1}
                                    value={min_streak}
                                    onChange={e => setMinStreak(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <p className='digit-pattern__field-hint'>
                            Every digit on every market is tracked live. Whenever a digit appears, the tick right after it
                            is checked{mode === 'evenodd' ? ' for even/odd' : ` against ${threshold_digit} (over/under)`}.
                            Rows below show digits currently on a streak of {min_streak}+ — click Enter to trade the
                            reversal on that market.
                        </p>
                    </div>

                    <div className='digit-pattern__panel digit-pattern__scanner-panel'>
                        <h2>
                            {localize('Live opportunities')} ({visible_entries.length})
                        </h2>
                        {visible_entries.length === 0 ? (
                            <div className='digit-pattern__empty-state'>
                                {scanner.is_loading
                                    ? 'Connecting to markets…'
                                    : `No digit has hit a ${min_streak}+ streak right now. Lower the minimum or wait.`}
                            </div>
                        ) : (
                            <div className='digit-pattern__scanner-list'>
                                {visible_entries.map(entry => {
                                    const is_best = entry === best_entry;
                                    const is_positive = entry.direction === 'even' || entry.direction === 'over';
                                    return (
                                        <div
                                            key={`${entry.symbol}-${entry.digit}`}
                                            className={`digit-pattern__scan-row ${is_best ? 'best' : ''} ${
                                                is_positive ? 'positive' : 'negative'
                                            }`}
                                        >
                                            {is_best && <span className='digit-pattern__best-badge'>BEST</span>}
                                            <div className='digit-pattern__scan-market'>
                                                <span className='name'>{entry.display_name}</span>
                                                <span className='digit'>digit {entry.digit}</span>
                                            </div>
                                            <div className='digit-pattern__scan-streak'>
                                                <span className='count'>{entry.count}x</span>
                                                <span className='direction'>{entry.direction.toUpperCase()}</span>
                                            </div>
                                            <div className='digit-pattern__scan-reversal'>
                                                → trade <strong>{opposite(entry.direction).toUpperCase()}</strong>
                                            </div>
                                            <button
                                                className='digit-pattern__btn primary'
                                                disabled={state.is_armed}
                                                onClick={() => openEntry(entry)}
                                            >
                                                {localize('Enter')}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className='digit-pattern__panel digit-pattern__logs-panel'>
                        <h2>{localize('Activity log')}</h2>
                        <div className='digit-pattern__logs-container'>
                            {state.logs.length > 0 ? (
                                state.logs.map(log => (
                                    <div key={log.id} className={`digit-pattern__log-entry ${log.kind}`}>
                                        <span className='time'>{log.time}</span>
                                        <span className='text'>{log.text}</span>
                                    </div>
                                ))
                            ) : (
                                <div className='digit-pattern__empty-state'>No trades yet.</div>
                            )}
                            <div ref={logEndRef} />
                        </div>
                    </div>
                </div>

                <div className='digit-pattern__col-side'>
                    <div className='digit-pattern__panel'>
                        <h2>{localize('Trade settings')}</h2>
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
                </div>
            </div>

            {show_confirm && pendingEntryRef.current && (
                <div className='digit-pattern__modal-overlay' onClick={cancelEntry}>
                    <div className='digit-pattern__modal-content' onClick={e => e.stopPropagation()}>
                        <h2>{localize('Confirm entry')}</h2>
                        <div className='digit-pattern__confirm-details'>
                            <p>
                                <strong>Market:</strong> {pendingEntryRef.current.display_name}
                            </p>
                            <p>
                                <strong>Pattern:</strong> {pendingEntryRef.current.count}x{' '}
                                {pendingEntryRef.current.direction.toUpperCase()} after {pendingEntryRef.current.digit}
                            </p>
                            <p>
                                <strong>Trade:</strong> {opposite(pendingEntryRef.current.direction).toUpperCase()} —
                                fires the moment {pendingEntryRef.current.digit} reappears
                            </p>
                            <p>
                                <strong>Initial stake:</strong> ${initial_stake.toFixed(2)}
                            </p>
                            <p>
                                <strong>Stake at final step:</strong> $
                                {(initial_stake * Math.pow(martingale_mult, max_martingale_steps - 1)).toFixed(2)}
                            </p>
                            <p>
                                <strong>Total risk if every step loses:</strong> $
                                {Array.from(
                                    { length: max_martingale_steps },
                                    (_, i) => initial_stake * Math.pow(martingale_mult, i)
                                )
                                    .reduce((sum, v) => sum + v, 0)
                                    .toFixed(2)}
                            </p>
                        </div>
                        <div className='digit-pattern__modal-actions'>
                            <button onClick={cancelEntry} className='digit-pattern__btn secondary'>
                                {localize('Cancel')}
                            </button>
                            <button onClick={confirmStart} className='digit-pattern__btn primary'>
                                {localize('Confirm & Start')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default DigitPattern;
