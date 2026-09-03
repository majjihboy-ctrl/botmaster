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
const LAST_SETTINGS_KEY = 'reversal_trader_last_settings';

type TLastSettings = {
    streak_target: number;
    initial_stake: number;
    martingale_mult: number;
    max_martingale_steps: number;
    stop_loss: number;
    take_profit: number;
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
        // localStorage unavailable — non-fatal, just won't be remembered next time.
    }
};

const directionLabel = (dir: string | null) => (dir ? dir.toUpperCase() : '—');

const ReversalTrader = observer(() => {
    const { client } = useStore();
    const symbol_options = useSyntheticSymbols();

    const [symbol, setSymbol] = React.useState('1HZ100V');
    const [watch_all_markets, setWatchAllMarkets] = React.useState(false);
    const [mode, setMode] = React.useState<TReversalMode>('evenodd');
    const [reference_digit, setReferenceDigit] = React.useState<number | 'all'>(7);
    const [threshold_digit, setThresholdDigit] = React.useState(5);
    const [streak_target, setStreakTarget] = React.useState(() => loadLastSettings().streak_target ?? 4);
    const [initial_stake, setInitialStake] = React.useState(() => loadLastSettings().initial_stake ?? 0.35);
    const [martingale_mult, setMartingaleMult] = React.useState(() => loadLastSettings().martingale_mult ?? 2);
    const [max_martingale_steps, setMaxMartingaleSteps] = React.useState(
        () => loadLastSettings().max_martingale_steps ?? 5
    );
    const [stop_loss, setStopLoss] = React.useState(() => loadLastSettings().stop_loss ?? 5);
    const [take_profit, setTakeProfit] = React.useState(() => loadLastSettings().take_profit ?? 100);
    const [show_confirm, setShowConfirm] = React.useState(false);
    const preloadedTriggerRef = React.useRef<{ digit: number; direction: 'even' | 'odd' | 'over' | 'under' } | null>(
        null
    );

    React.useEffect(() => {
        const pending = consumePendingReversalConfig();
        if (!pending) return;
        setSymbol(pending.symbol);
        setWatchAllMarkets(false); // "Trade this" targets one specific market — don't silently widen to a race
        setMode(pending.mode);
        setReferenceDigit(pending.reference_digit);
        setThresholdDigit(pending.threshold_digit);
        // Hand over the streak exactly as Signals had it built — no matter
        // its length, it's treated as already complete. Skips rebuilding it
        // live and goes straight to waiting for the digit to reappear.
        preloadedTriggerRef.current = { digit: pending.reference_digit, direction: pending.current_direction };
        // One click away from live: open the confirm popup right away so the
        // stake/martingale/stop-loss (not carried over from Signals) get a
        // final glance before any real money moves.
        setShowConfirm(true);
    }, []);

    const { state, start, stop } = useReversalTrader(client?.currency);
    const logEndRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state.logs.length]);

    const confirmStart = () => {
        setShowConfirm(false);
        saveLastSettings({
            streak_target,
            initial_stake,
            martingale_mult,
            max_martingale_steps,
            stop_loss,
            take_profit,
        });
        const symbols = watch_all_markets ? symbol_options.map(s => s.symbol) : [symbol];
        const preloaded_trigger = preloadedTriggerRef.current
            ? { digit: preloadedTriggerRef.current.digit, direction: preloadedTriggerRef.current.direction }
            : undefined;
        preloadedTriggerRef.current = null; // single-use — never carries over to a later manual start
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
            preloaded_trigger,
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
            <div className='reversal-trader__topbar'>
                <div className='reversal-trader__title'>
                    <h1>{localize('Reversal Trader')}</h1>
                    <span className={`reversal-trader__live ${!state.is_armed ? 'stopped' : ''}`}>
                        <span className='reversal-trader__pulse' />
                        {!state.is_armed ? 'STOPPED' : state.is_loading ? 'CONNECTING' : 'LIVE'}
                    </span>
                </div>
                {state.is_armed && (
                    <div className='reversal-trader__status-row'>
                        <span>
                            {state.active_symbol ? (
                                <>
                                    Trading <strong>{displayName(state.active_symbol)}</strong>
                                </>
                            ) : (
                                <>
                                    Scanning <strong>{state.watching.length}</strong> market
                                    {state.watching.length > 1 ? 's' : ''}
                                </>
                            )}
                        </span>
                        <span>
                            Watching for <strong>{reference_digit === 'all' ? 'all digits' : reference_digit}</strong> →{' '}
                            <strong>{streak_target}x</strong> {mode === 'evenodd' ? 'even/odd' : 'over/under'}
                        </span>
                        <span>
                            Stake <strong>${state.current_stake.toFixed(2)}</strong>
                        </span>
                        <span className={state.total_pnl >= 0 ? 'profit' : 'loss'}>
                            PnL <strong>${state.total_pnl.toFixed(2)}</strong>
                        </span>
                    </div>
                )}
            </div>

            <div className='reversal-trader__grid'>
                <div className='reversal-trader__col-controls'>
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
                                <button
                                    className={reference_digit === 'all' ? 'active' : ''}
                                    disabled={state.is_armed}
                                    onClick={() => setReferenceDigit('all')}
                                >
                                    {localize('All')}
                                </button>
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
                            {reference_digit === 'all' && (
                                <p className='reversal-trader__field-hint'>
                                    {localize(
                                        'Tracks every digit 0-9 in parallel on each watched market. A longer streak target is rarer per digit, but with 10x more trackers running at once, signals still come often.'
                                    )}
                                </p>
                            )}
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
                            {reference_digit === 'all' ? (
                                <>Every time any digit appears, the digit right after it is checked</>
                            ) : (
                                <>
                                    Every time <strong>{reference_digit}</strong> appears, the digit right after it is checked
                                </>
                            )}
                            {mode === 'evenodd' ? ' for even/odd' : ` against ${threshold_digit} (over/under)`}. Once{' '}
                            <strong>{streak_target}</strong> in a row land the same way, the bot waits for that same
                            reference digit to reappear once, then trades the reversal ({label_b}/{label_a}) on the tick
                            right after.
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
                            <button onClick={() => setShowConfirm(true)} className='reversal-trader__btn primary'>
                                {localize('Start Trading')}
                            </button>
                        ) : (
                            <button onClick={() => stop()} className='reversal-trader__btn danger'>
                                {localize('Stop Trading')}
                            </button>
                        )}
                    </div>
                </div>

                <div className='reversal-trader__col-output'>
                    {watch_all_markets && state.is_armed && (
                        <div className='reversal-trader__panel'>
                            <h2>{localize('Race progress')}</h2>
                            <div className='reversal-trader__race-list'>
                                {race_rows.length > 0 ? (
                                    race_rows.map(([sym, progress]) => (
                                        <div
                                            key={sym}
                                            className={`reversal-trader__race-item ${
                                                sym === state.active_symbol ? 'active' : ''
                                            }`}
                                        >
                                            <div className='reversal-trader__race-header'>
                                                <span className='symbol'>{displayName(sym)}</span>
                                                <span className='progress-text'>
                                                    {reference_digit === 'all' && progress.digit !== undefined
                                                        ? `${progress.digit} → `
                                                        : ''}
                                                    {directionLabel(progress.direction)} {progress.count}/{progress.target}
                                                </span>
                                            </div>
                                            <div className='reversal-trader__progress-bar'>
                                                <div
                                                    className='reversal-trader__progress-fill'
                                                    style={{
                                                        width: `${Math.min(100, (progress.count / progress.target) * 100)}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className='reversal-trader__empty-state'>Waiting for market data...</div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className='reversal-trader__panel reversal-trader__logs-panel'>
                        <h2>{localize('Activity log')}</h2>
                        <div className='reversal-trader__logs-container'>
                            {state.logs.length > 0 ? (
                                state.logs.map(log => (
                                    <div key={log.id} className={`reversal-trader__log-entry ${log.kind}`}>
                                        <span className='time'>{log.time}</span>
                                        <span className='text'>{log.text}</span>
                                    </div>
                                ))
                            ) : (
                                <div className='reversal-trader__empty-state'>Waiting for activity...</div>
                            )}
                            <div ref={logEndRef} />
                        </div>
                    </div>
                </div>
            </div>

            {show_confirm && (
                <div
                    className='reversal-trader__modal-overlay'
                    onClick={() => {
                        preloadedTriggerRef.current = null;
                        setShowConfirm(false);
                    }}
                >
                    <div className='reversal-trader__modal-content' onClick={e => e.stopPropagation()}>
                        <h2>{localize('Confirm trade settings')}</h2>
                        <div className='reversal-trader__confirm-details'>
                            {preloadedTriggerRef.current && (
                                <p>
                                    <strong>Handed over from Signals:</strong> {streak_target}x{' '}
                                    {preloadedTriggerRef.current.direction.toUpperCase()} after{' '}
                                    {preloadedTriggerRef.current.digit} — trading fires as soon as{' '}
                                    {preloadedTriggerRef.current.digit} reappears, no rebuild needed.
                                </p>
                            )}
                            <p>
                                <strong>Pattern:</strong> {reference_digit === 'all' ? 'all digits' : reference_digit} →{' '}
                                {streak_target}x{' '}
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
                        <div className='reversal-trader__modal-actions'>
                            <button
                                onClick={() => {
                                    preloadedTriggerRef.current = null;
                                    setShowConfirm(false);
                                }}
                                className='reversal-trader__btn secondary'
                            >
                                {localize('Cancel')}
                            </button>
                            <button onClick={confirmStart} className='reversal-trader__btn primary'>
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
