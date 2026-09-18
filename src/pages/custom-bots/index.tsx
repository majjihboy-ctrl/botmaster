import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { SliderField } from '@/pages/digit-pattern/reversal-trader-fields';
import { useMarketScanner, TScanMode } from '@/pages/digit-pattern/use-market-scanner';
import { localize } from '@deriv-com/translations';
import { useCustomBotEngine, TCustomStrategy } from './use-custom-bot-engine';
import './custom-bots.scss';

const DIGIT_OPTIONS = Array.from({ length: 10 }, (_, i) => i);

// Barrier 0 and 9 make one side impossible: DIGITUNDER 0 can never win (no
// digit is below 0) and DIGITOVER 9 can never win. The engine trades BOTH
// directions off the same barrier, so only 1-8 is safe to offer.
const BARRIER_OPTIONS = DIGIT_OPTIONS.filter(d => d >= 1 && d <= 8);

// True win probability on a uniform 0-9 last digit. The barrier digit itself
// loses both ways, so over% + under% is 90%, not 100%.
const overWinPct = (barrier: number) => (9 - barrier) * 10;
const underWinPct = (barrier: number) => barrier * 10;
// Payout must exceed this for the contract to break even.
const breakEvenPayout = (win_pct: number) => (win_pct > 0 ? 100 / win_pct : Infinity);

// Anchor digits the engine is allowed to trade from: 0-2 (UNDER) and 7-9 (OVER).
const isAnchorDigit = (d: number) => d <= 2 || d >= 7;

const phaseCopy = (phase: string, is_running: boolean) => {
    if (!is_running) return localize('Idle');
    switch (phase) {
        case 'armed':
            return localize('Armed — waiting for the anchor digit to print');
        case 'in_trade':
            return localize('Trade open');
        case 'waiting':
            return localize('Waiting for a qualifying streak');
        default:
            return localize('Scanning markets for a setup');
    }
};

const CustomBots = observer(() => {
    const { client } = useStore() ?? {};
    const is_logged_in = !!client?.is_logged_in;
    const currency = client?.currency || 'USD';

    // Exclude 1-second volatility (1HZ...) markets. Memoised so the array
    // identity is stable — it feeds hook deps below and a fresh array on every
    // render would retrigger them needlessly.
    const all_symbols = useSyntheticSymbols();
    const symbol_options = React.useMemo(() => all_symbols.filter(s => !s.symbol.startsWith('1HZ')), [all_symbols]);

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
        recovery_direction,
        banned_symbols,
        start,
        stop,
    } = useCustomBotEngine(currency, symbol_options);

    const mode = settings.mode;
    const threshold_digit = settings.threshold_digit;
    const scanner = useMarketScanner(symbol_options, mode, threshold_digit, false);

    const is_running = status === 'running';
    const continuation_streak = settings.continuation_streak ?? settings.min_streak ?? 3;
    const reversal_streak = settings.reversal_streak ?? 7;

    // Digit strip for the locked market, falling back to any market that has
    // ticks yet so the panel isn't blank while hunting.
    const { recent_digits, recent_label } = React.useMemo(() => {
        const map = scanner.recent_by_symbol || {};
        if (target?.symbol && map[target.symbol]?.length) {
            return { recent_digits: map[target.symbol], recent_label: target.display_name };
        }
        const first = symbol_options.find(s => map[s.symbol]?.length);
        return {
            recent_digits: first ? map[first.symbol] : [],
            recent_label: first?.display_name ?? '',
        };
    }, [scanner.recent_by_symbol, target?.symbol, target?.display_name, symbol_options]);

    const handleStart = () => {
        if (!is_logged_in || is_running) return;
        // Use every non-1s market; no manual volatility picker.
        updateSettings({ selected_symbols: [], max_markets: Math.max(symbol_options.length, 1) });
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

    const connection_state = scanner.is_loading ? 'connecting' : is_running ? 'live' : 'idle';
    const connection_copy = scanner.is_loading
        ? localize('Connecting')
        : is_running
          ? localize('Live')
          : localize('Idle');

    return (
        <div className='custom-bots'>
            {/* ---- Control bar: status, the one primary action, and the numbers
                 that matter while it runs. Previously Start/Stop was buried at
                 the bottom of a crowded Status panel. ---- */}
            <header className='custom-bots__bar'>
                <div className='custom-bots__bar-id'>
                    <h1>{localize('Custom Pro')}</h1>
                    <span className={`custom-bots__live ${connection_state}`}>
                        <span className='custom-bots__pulse' />
                        {connection_copy}
                    </span>
                </div>

                <div className='custom-bots__bar-stats'>
                    <div className='custom-bots__stat'>
                        <span className='k'>{localize('Stake')}</span>
                        <span className='v'>${stake.toFixed(2)}</span>
                    </div>
                    <div className='custom-bots__stat'>
                        <span className='k'>{localize('Loss streak')}</span>
                        <span className='v'>
                            {loss_streak}/{settings.max_martingale_steps}
                        </span>
                    </div>
                    <div className='custom-bots__stat'>
                        <span className='k'>{localize('Session P/L')}</span>
                        <span className={`v ${session_profit >= 0 ? 'up' : 'down'}`}>
                            {session_profit >= 0 ? '+' : ''}
                            {session_profit.toFixed(2)}
                        </span>
                    </div>
                </div>

                {!is_running ? (
                    <button className='custom-bots__btn primary' disabled={!is_logged_in} onClick={handleStart}>
                        {localize('Start')}
                    </button>
                ) : (
                    <button className='custom-bots__btn danger' onClick={stop}>
                        {localize('Stop')}
                    </button>
                )}
            </header>

            {/* Alerts live directly under the bar so they're never missed. */}
            {(!is_logged_in || status_message || stop_copy) && (
                <div className='custom-bots__alerts'>
                    {!is_logged_in && (
                        <div className='custom-bots__alert warn'>{localize('Log in to start Custom Pro.')}</div>
                    )}
                    {status_message && <div className='custom-bots__alert warn'>{status_message}</div>}
                    {stop_copy && <div className='custom-bots__alert ok'>{stop_copy}</div>}
                </div>
            )}

            <div className='custom-bots__grid'>
                <section className='custom-bots__col'>
                    {/* ---- Live ---- */}
                    <div className='custom-bots__panel'>
                        <div className='custom-bots__panel-head'>
                            <h2>{localize('Live')}</h2>
                            <span className={`custom-bots__phase ${phase}`}>{phaseCopy(phase, is_running)}</span>
                        </div>

                        {target ? (
                            <div className='custom-bots__lock'>
                                <div className='custom-bots__lock-market'>{target.display_name}</div>
                                <div className='custom-bots__lock-detail'>
                                    <span>
                                        {localize('Anchor')} <strong>{target.digit}</strong>
                                    </span>
                                    <span className='sep'>·</span>
                                    <span>
                                        {target.count}× {target.streak_direction.toUpperCase()}
                                    </span>
                                    <span className='sep'>·</span>
                                    <span className='custom-bots__expect'>
                                        {localize('Trade')} <strong>{target.trade_direction.toUpperCase()}</strong>
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className='custom-bots__lock empty'>
                                {is_running ? localize('Looking for a setup…') : localize('Not running.')}
                            </div>
                        )}

                        {is_running && recovery_direction && (
                            <div className='custom-bots__recovery'>
                                {localize('Recovery locked to')} <strong>{recovery_direction.toUpperCase()}</strong>
                                {banned_symbols.length > 0 ? ` · ${banned_symbols.join(', ')}` : ''}
                            </div>
                        )}

                        <div className='custom-bots__ticks'>
                            <div className='custom-bots__ticks-head'>
                                <span>{localize('Recent digits')}</span>
                                {recent_label ? <span className='market'>{recent_label}</span> : null}
                            </div>
                            <div className='custom-bots__digit-track'>
                                {recent_digits.length === 0 ? (
                                    <span className='empty'>{localize('Waiting for ticks…')}</span>
                                ) : (
                                    recent_digits.map((d, i) => (
                                        <span
                                            key={`${i}-${d}`}
                                            className={
                                                target && d === target.digit ? 'digit locked' : 'digit'
                                            }
                                        >
                                            {d}
                                        </span>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ---- Trade log ---- */}
                    <div className='custom-bots__panel'>
                        <div className='custom-bots__panel-head'>
                            <h2>{localize('Trade log')}</h2>
                            {log.length > 0 && <span className='custom-bots__count'>{log.length}</span>}
                        </div>
                        {log.length === 0 ? (
                            <div className='custom-bots__empty-state'>{localize('No trades yet.')}</div>
                        ) : (
                            <div className='custom-bots__log-list'>
                                {log.map(entry => (
                                    <div key={entry.id} className={`custom-bots__log-item ${entry.status}`}>
                                        <div className='custom-bots__log-row'>
                                            <span className='symbol'>{entry.display_name}</span>
                                            <span className={`badge ${entry.status}`}>{entry.status}</span>
                                        </div>
                                        <div className='custom-bots__log-row sub'>
                                            <span className='meta'>
                                                {localize('anchor')} {entry.digit} · {entry.contract_type}
                                                {entry.strategy ? ` · ${entry.strategy}` : ''}
                                                {typeof entry.result_digit === 'number'
                                                    ? ` · ${localize('result')} ${entry.result_digit}`
                                                    : entry.status === 'pending'
                                                      ? ` · ${localize('result')} …`
                                                      : ''}
                                            </span>
                                            <span className='amounts'>
                                                <span className='stake'>${entry.stake.toFixed(2)}</span>
                                                {typeof entry.profit === 'number' && (
                                                    <span className={`profit ${entry.profit >= 0 ? 'up' : 'down'}`}>
                                                        {entry.profit >= 0 ? '+' : ''}
                                                        {entry.profit.toFixed(2)}
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                        {entry.fail_reason && (
                                            <div className='custom-bots__log-reason'>{entry.fail_reason}</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                <section className='custom-bots__col'>
                    {/* ---- Strategy ---- */}
                    <div className='custom-bots__panel'>
                        <div className='custom-bots__panel-head'>
                            <h2>{localize('Strategy')}</h2>
                            {is_running && <span className='custom-bots__locked-note'>{localize('Stop to edit')}</span>}
                        </div>

                        <div className='custom-bots__field'>
                            <label className='custom-bots__label'>{localize('Contract')}</label>
                            <div className='custom-bots__seg'>
                                <button
                                    className={mode === 'evenodd' ? 'active' : ''}
                                    disabled={is_running}
                                    onClick={() => updateSettings({ mode: 'evenodd' as TScanMode })}
                                >
                                    {localize('Even / Odd')}
                                </button>
                                <button
                                    className={mode === 'overunder' ? 'active' : ''}
                                    disabled={is_running}
                                    onClick={() => updateSettings({ mode: 'overunder' as TScanMode })}
                                >
                                    {localize('Over / Under')}
                                </button>
                            </div>
                        </div>

                        <div className='custom-bots__field'>
                            <label className='custom-bots__label'>{localize('Entry style')}</label>
                            <div className='custom-bots__seg'>
                                <button
                                    className={settings.strategy === 'continuation' ? 'active' : ''}
                                    disabled={is_running}
                                    onClick={() => updateSettings({ strategy: 'continuation' as TCustomStrategy })}
                                >
                                    {localize('Continuation')}
                                </button>
                                <button
                                    className={settings.strategy === 'reversal' ? 'active' : ''}
                                    disabled={is_running}
                                    onClick={() => updateSettings({ strategy: 'reversal' as TCustomStrategy })}
                                >
                                    {localize('Reversal')}
                                </button>
                            </div>
                        </div>

                        {mode === 'overunder' && (
                            <div className='custom-bots__field'>
                                <label className='custom-bots__label' htmlFor='cb-threshold'>
                                    {localize('Barrier digit')}
                                </label>
                                <select
                                    id='cb-threshold'
                                    value={threshold_digit}
                                    disabled={is_running}
                                    onChange={e => updateSettings({ threshold_digit: Number(e.target.value) })}
                                >
                                    {BARRIER_OPTIONS.map(d => (
                                        <option key={d} value={d}>
                                            {d}
                                        </option>
                                    ))}
                                </select>
                                {/* The two sides are NOT symmetric — the barrier digit
                                    itself loses both ways. Surfaced here because the
                                    engine trades whichever side the anchor picks. */}
                                <div className='custom-bots__odds'>
                                    <div className='custom-bots__odds-row'>
                                        <span>{localize('Over wins')}</span>
                                        <strong>{overWinPct(threshold_digit)}%</strong>
                                        <span className='be'>
                                            {localize('needs')} {breakEvenPayout(overWinPct(threshold_digit)).toFixed(2)}x
                                        </span>
                                    </div>
                                    <div className='custom-bots__odds-row'>
                                        <span>{localize('Under wins')}</span>
                                        <strong>{underWinPct(threshold_digit)}%</strong>
                                        <span className='be'>
                                            {localize('needs')}{' '}
                                            {breakEvenPayout(underWinPct(threshold_digit)).toFixed(2)}x
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {settings.strategy === 'continuation' ? (
                            <SliderField
                                label={localize('Continuation streak')}
                                value={continuation_streak}
                                min={2}
                                max={8}
                                step={1}
                                disabled={is_running}
                                onChange={v =>
                                    updateSettings({
                                        continuation_streak: Math.round(v),
                                        min_streak: Math.round(v),
                                    })
                                }
                                suffix='+'
                                decimals={0}
                            />
                        ) : (
                            <SliderField
                                label={localize('Reversal streak')}
                                value={reversal_streak}
                                min={5}
                                max={15}
                                step={1}
                                disabled={is_running}
                                onChange={v => updateSettings({ reversal_streak: Math.round(v) })}
                                suffix='+'
                                decimals={0}
                            />
                        )}

                        <p className='custom-bots__hint'>
                            {localize(
                                'Anchors only: 0–2 for UNDER and 7–9 for OVER. Digits 3–6 never trigger a trade, even with a long streak. Bot waits for the anchor digit to print again, then buys.'
                            )}
                        </p>
                    </div>

                    {/* ---- Risk ---- */}
                    <div className='custom-bots__panel'>
                        <div className='custom-bots__panel-head'>
                            <h2>{localize('Risk')}</h2>
                        </div>
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
                        <p className='custom-bots__hint'>
                            {localize('Worst case for this sequence')}:{' '}
                            <strong>
                                ${
                                    Array.from(
                                        { length: settings.max_martingale_steps },
                                        (_, i) => settings.initial_stake * Math.pow(settings.martingale_mult, i)
                                    )
                                        .reduce((sum, v) => sum + v, 0)
                                        .toFixed(2)}
                            </strong>{' '}
                            {localize('if every step loses.')}
                        </p>
                    </div>
                </section>
            </div>
        </div>
    );
});

export default CustomBots;
