import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { localize } from '@deriv-com/translations';
import { SliderField } from './reversal-trader-fields';
import { loadLastSettings, saveLastSettings } from './trade-settings';
import { launchXmlBot } from './launch-xml-bot';
import { useMarketScanner, TScanMode, TScanEntry } from './use-market-scanner';
import './digit-pattern.scss';

const DIGIT_OPTIONS = Array.from({ length: 10 }, (_, i) => i);

const opposite = (dir: TScanEntry['direction']) => {
    if (dir === 'even') return 'odd';
    if (dir === 'odd') return 'even';
    if (dir === 'over') return 'under';
    return 'over';
};

const DigitPattern = observer(() => {
    const stores = useStore();
    const { load_modal, dashboard, run_panel } = stores;
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
    const [is_launching, setIsLaunching] = React.useState(false);
    const pendingEntryRef = React.useRef<TScanEntry | null>(null);

    // The scanner is pure detection — no real trades happen here, so it
    // never needs to pause. Every real trade now runs through the XML bot
    // in Bot Builder instead, launched below.
    const scanner = useMarketScanner(symbol_options, mode, threshold_digit, false);

    const visible_entries = scanner.entries.filter(e => e.count >= min_streak);
    const best_entry = visible_entries[0];

    const openEntry = (entry: TScanEntry) => {
        pendingEntryRef.current = entry;
        setShowConfirm(true);
    };

    const confirmStart = async () => {
        const entry = pendingEntryRef.current;
        if (!entry || is_launching) return;
        setIsLaunching(true);
        saveLastSettings({ initial_stake, martingale_mult, max_martingale_steps, stop_loss, take_profit, min_streak });

        await launchXmlBot(
            { load_modal, dashboard, run_panel },
            {
                mode,
                symbol: entry.symbol,
                digit: entry.digit,
                direction: entry.direction,
                threshold_digit,
                initial_stake,
                martingale_mult,
                max_martingale_steps,
                stop_loss,
                take_profit,
            }
        );

        setIsLaunching(false);
        setShowConfirm(false);
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
                <p className='digit-pattern__field-hint'>
                    {localize(
                        'Real trades run through Bot Builder — clicking Enter loads and starts the matching bot there with your pattern and risk settings already applied.'
                    )}
                </p>
            </div>

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
                                                disabled={is_launching}
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
                            disabled={is_launching}
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
                            disabled={is_launching}
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
                            disabled={is_launching}
                            onChange={v => setMaxMartingaleSteps(Math.round(v))}
                            decimals={0}
                        />
                        <SliderField
                            label={localize('Stop loss')}
                            value={stop_loss}
                            min={1}
                            max={200}
                            step={1}
                            disabled={is_launching}
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
                            disabled={is_launching}
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
                            <button onClick={cancelEntry} className='digit-pattern__btn secondary' disabled={is_launching}>
                                {localize('Cancel')}
                            </button>
                            <button onClick={confirmStart} className='digit-pattern__btn primary' disabled={is_launching}>
                                {is_launching ? localize('Launching…') : localize('Confirm & Start')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default DigitPattern;
