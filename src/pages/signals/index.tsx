import React from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { setPendingReversalConfig } from '@/pages/digit-pattern/trade-bridge';
import { useSignalStreak, useAllDigitStreaks, TSignalDirection, TDigitStreakRow } from './use-signal-streak';
import './signals.scss';

const STORAGE_KEY = 'signals_settings';

type TStoredSettings = {
    symbol?: string;
    tickCount?: number;
    evenOddRefDigit?: number;
    overUnderRefDigit?: number;
    overUnderThreshold?: number;
    subTab?: 'evenodd' | 'overunder';
    viewMode?: 'single' | 'all';
    sortByStreak?: boolean;
};

const loadStoredSettings = (): TStoredSettings => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const saveStoredSettings = (partial: TStoredSettings) => {
    try {
        const current = loadStoredSettings();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }));
    } catch {
        // localStorage unavailable — fail silently, tool still works.
    }
};

const DIGIT_OPTIONS = Array.from({ length: 10 }, (_, i) => i);
const HOT_STREAK_THRESHOLD = 3; // streak length at which a card visually "heats up"

const directionLabel = (dir: TSignalDirection | null) => {
    if (!dir) return '—';
    return dir.toUpperCase();
};

const directionColorClass = (dir: TSignalDirection | null) => {
    if (dir === 'even' || dir === 'over') return 'positive';
    if (dir === 'odd' || dir === 'under') return 'negative';
    return '';
};

const Signals = observer(() => {
    const { dashboard } = useStore();
    const symbol_options = useSyntheticSymbols();
    const stored = React.useMemo(() => loadStoredSettings(), []);

    const [symbol, setSymbolState] = React.useState(stored.symbol ?? 'R_100');
    const [tickCount, setTickCountState] = React.useState(stored.tickCount ?? 1000);
    const [subTab, setSubTabState] = React.useState<'evenodd' | 'overunder'>(stored.subTab ?? 'evenodd');
    const [evenOddRefDigit, setEvenOddRefDigitState] = React.useState(stored.evenOddRefDigit ?? 7);
    const [overUnderRefDigit, setOverUnderRefDigitState] = React.useState(stored.overUnderRefDigit ?? 7);
    const [overUnderThreshold, setOverUnderThresholdState] = React.useState(stored.overUnderThreshold ?? 5);
    const [viewMode, setViewModeState] = React.useState<'single' | 'all'>(stored.viewMode ?? 'all');
    const [sortByStreak, setSortByStreakState] = React.useState(stored.sortByStreak ?? true);

    const setSymbol = (v: string) => {
        setSymbolState(v);
        saveStoredSettings({ symbol: v });
    };
    const setTickCount = (v: number) => {
        setTickCountState(v);
        saveStoredSettings({ tickCount: v });
    };
    const setSubTab = (v: 'evenodd' | 'overunder') => {
        setSubTabState(v);
        saveStoredSettings({ subTab: v });
    };
    const setEvenOddRefDigit = (v: number) => {
        setEvenOddRefDigitState(v);
        saveStoredSettings({ evenOddRefDigit: v });
    };
    const setOverUnderRefDigit = (v: number) => {
        setOverUnderRefDigitState(v);
        saveStoredSettings({ overUnderRefDigit: v });
    };
    const setOverUnderThreshold = (v: number) => {
        setOverUnderThresholdState(v);
        saveStoredSettings({ overUnderThreshold: v });
    };
    const setViewMode = (v: 'single' | 'all') => {
        setViewModeState(v);
        saveStoredSettings({ viewMode: v });
    };
    const setSortByStreak = (v: boolean) => {
        setSortByStreakState(v);
        saveStoredSettings({ sortByStreak: v });
    };

    // Exactly one of these four hook instances is ever active — each is
    // disabled unless it matches BOTH the current sub-tab and view mode, so
    // switching between them never opens a second tick subscription.
    const evenOddSingle = useSignalStreak(
        symbol,
        tickCount,
        evenOddRefDigit,
        'evenodd',
        5,
        !(subTab === 'evenodd' && viewMode === 'single')
    );
    const overUnderSingle = useSignalStreak(
        symbol,
        tickCount,
        overUnderRefDigit,
        'overunder',
        overUnderThreshold,
        !(subTab === 'overunder' && viewMode === 'single')
    );
    const evenOddAll = useAllDigitStreaks(symbol, tickCount, 'evenodd', 5, !(subTab === 'evenodd' && viewMode === 'all'));
    const overUnderAll = useAllDigitStreaks(
        symbol,
        tickCount,
        'overunder',
        overUnderThreshold,
        !(subTab === 'overunder' && viewMode === 'all')
    );

    const active = subTab === 'evenodd' ? evenOddSingle : overUnderSingle;
    const activeAll = subTab === 'evenodd' ? evenOddAll : overUnderAll;
    const ref_digit = subTab === 'evenodd' ? evenOddRefDigit : overUnderRefDigit;
    const set_ref_digit = subTab === 'evenodd' ? setEvenOddRefDigit : setOverUnderRefDigit;

    const jumpToDigit = (digit: number) => {
        set_ref_digit(digit);
        setViewMode('single');
    };

    const tradeThis = (digit: number, current_streak: number, current_direction: TSignalDirection | null) => {
        if (!current_direction) return; // nothing to hand over — shouldn't happen from a "hot" row, but stay safe
        setPendingReversalConfig({
            symbol,
            reference_digit: digit,
            mode: subTab,
            threshold_digit: overUnderThreshold,
            current_streak,
            current_direction,
        });
        dashboard.setActiveTab(DBOT_TABS.DIGIT_PATTERN);
    };

    const is_live = viewMode === 'single' ? active.is_loading : activeAll.is_loading;
    const is_stale = viewMode === 'single' ? active.is_stale : activeAll.is_stale;

    const label_a = subTab === 'evenodd' ? 'EVEN' : 'OVER';
    const label_b = subTab === 'evenodd' ? 'ODD' : 'UNDER';

    const sorted_rows: TDigitStreakRow[] = React.useMemo(() => {
        const rows = [...activeAll.rows];
        if (sortByStreak) rows.sort((a, b) => b.current_streak - a.current_streak);
        return rows;
    }, [activeAll.rows, sortByStreak]);

    return (
        <div className='signals'>
            <div className='signals__topbar'>
                <div className='signals__title'>
                    <h1>Signals</h1>
                    <span className={`signals__live ${is_stale ? 'stale' : ''}`}>
                        <span className='signals__pulse' />
                        {is_live ? 'CONNECTING' : is_stale ? 'RECONNECTING' : 'LIVE'}
                    </span>
                </div>
                <div className='signals__controls'>
                    <label className='signals__field-label' htmlFor='signals-symbol'>
                        Symbol
                    </label>
                    <select id='signals-symbol' value={symbol} onChange={e => setSymbol(e.target.value)}>
                        {symbol_options.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                                {s.display_name}
                            </option>
                        ))}
                    </select>
                    <label className='signals__field-label' htmlFor='signals-tick-count'>
                        Ticks
                    </label>
                    <input
                        id='signals-tick-count'
                        type='number'
                        min={50}
                        max={5000}
                        step={50}
                        value={tickCount}
                        onChange={e => setTickCount(Math.max(50, Math.min(5000, Number(e.target.value) || 1000)))}
                    />
                </div>
            </div>

            <div className='signals__subtabs'>
                <button
                    className={`signals__subtab-btn ${subTab === 'evenodd' ? 'active' : ''}`}
                    onClick={() => setSubTab('evenodd')}
                >
                    Even / Odd
                </button>
                <button
                    className={`signals__subtab-btn ${subTab === 'overunder' ? 'active' : ''}`}
                    onClick={() => setSubTab('overunder')}
                >
                    Over / Under
                </button>

                <div className='signals__view-toggle'>
                    <button
                        className={`signals__view-btn ${viewMode === 'all' ? 'active' : ''}`}
                        onClick={() => setViewMode('all')}
                    >
                        All digits
                    </button>
                    <button
                        className={`signals__view-btn ${viewMode === 'single' ? 'active' : ''}`}
                        onClick={() => setViewMode('single')}
                    >
                        Single digit
                    </button>
                </div>
            </div>

            <div className='signals__panel'>
                <div className='signals__ref-row'>
                    {subTab === 'overunder' && (
                        <>
                            <label className='signals__field-label' htmlFor='signals-threshold'>
                                Over/Under threshold
                            </label>
                            <select
                                id='signals-threshold'
                                value={overUnderThreshold}
                                onChange={e => setOverUnderThreshold(Number(e.target.value))}
                            >
                                {DIGIT_OPTIONS.map(d => (
                                    <option key={d} value={d}>
                                        {d}
                                    </option>
                                ))}
                            </select>
                        </>
                    )}

                    {viewMode === 'single' && (
                        <>
                            <label className='signals__field-label' htmlFor='signals-ref-digit'>
                                Reference digit
                            </label>
                            <div className='signals__digit-picker'>
                                {DIGIT_OPTIONS.map(d => (
                                    <button
                                        key={d}
                                        className={`signals__digit-btn ${ref_digit === d ? 'active' : ''}`}
                                        onClick={() => set_ref_digit(d)}
                                    >
                                        {d}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {viewMode === 'all' && (
                        <div className='signals__view-toggle signals__sort-toggle'>
                            <button
                                className={`signals__view-btn ${sortByStreak ? 'active' : ''}`}
                                onClick={() => setSortByStreak(true)}
                            >
                                Sort: Hottest
                            </button>
                            <button
                                className={`signals__view-btn ${!sortByStreak ? 'active' : ''}`}
                                onClick={() => setSortByStreak(false)}
                            >
                                Sort: Digit
                            </button>
                        </div>
                    )}
                </div>

                <p className='signals__explainer'>
                    {viewMode === 'all' ? (
                        <>
                            Every digit 0-9 is tracked at once. Whenever a digit appears, the tick right after it is checked
                            {subTab === 'evenodd' ? <> for even/odd</> : <> against {overUnderThreshold} (over/under)</>} —
                            consecutive matching outcomes build that digit's streak below. Click a card to drill into it.
                        </>
                    ) : (
                        <>
                            Every time <strong>{ref_digit}</strong> appears, the digit right after it is checked
                            {subTab === 'evenodd' ? (
                                <> for even/odd.</>
                            ) : (
                                <>
                                    {' '}
                                    against <strong>{overUnderThreshold}</strong> (over/under).
                                </>
                            )}{' '}
                            Consecutive matching outcomes build the streak below; a flip resets it.
                        </>
                    )}
                </p>
            </div>

            {viewMode === 'all' ? (
                <div className='signals__digit-grid'>
                    {sorted_rows.map(row => {
                        const is_hot = row.current_streak >= HOT_STREAK_THRESHOLD;
                        return (
                            <div
                                key={row.digit}
                                className={`signals__digit-card ${directionColorClass(row.current_direction)} ${
                                    is_hot ? 'hot' : ''
                                }`}
                            >
                                <button className='signals__digit-card-main' onClick={() => jumpToDigit(row.digit)}>
                                    <span className='signals__digit-card-digit'>{row.digit}</span>
                                    <span className='signals__digit-card-streak'>{row.current_streak}</span>
                                    <span className='signals__digit-card-direction'>
                                        {directionLabel(row.current_direction)}
                                    </span>
                                    <span className='signals__digit-card-best'>
                                        best {label_a} {row.longest_a} · {label_b} {row.longest_b}
                                    </span>
                                </button>
                                {is_hot && (
                                    <button
                                        className='signals__trade-this-btn'
                                        onClick={e => {
                                            e.stopPropagation();
                                            tradeThis(row.digit, row.current_streak, row.current_direction);
                                        }}
                                    >
                                        ⚡ Trade this
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <>
                    <div className='signals__grid'>
                        <div className='signals__panel signals__streak-panel'>
                            <h2>Current streak</h2>
                            <div className={`signals__streak-display ${directionColorClass(active.current_direction)}`}>
                                <span className='signals__streak-count'>{active.current_streak}</span>
                                <span className='signals__streak-direction'>
                                    {directionLabel(active.current_direction)} in a row after {ref_digit}
                                </span>
                            </div>
                            {active.current_streak >= HOT_STREAK_THRESHOLD && (
                                <button
                                    className='signals__trade-this-btn wide'
                                    onClick={() => tradeThis(ref_digit, active.current_streak, active.current_direction)}
                                >
                                    ⚡ Trade this
                                </button>
                            )}
                        </div>

                        <div className='signals__panel'>
                            <h2>Longest streaks seen</h2>
                            <div className='signals__longest-row'>
                                <div className='signals__longest-item positive'>
                                    <span className='signals__longest-label'>{label_a}</span>
                                    <span className='signals__longest-value'>{active.longest_a}</span>
                                </div>
                                <div className='signals__longest-item negative'>
                                    <span className='signals__longest-label'>{label_b}</span>
                                    <span className='signals__longest-value'>{active.longest_b}</span>
                                </div>
                            </div>
                            <p className='signals__field-hint'>
                                Total triggers in window: <strong>{active.total_triggers}</strong>
                            </p>
                        </div>
                    </div>

                    <div className='signals__panel'>
                        <h2>Recent outcomes after {ref_digit}</h2>
                        <div className='signals__outcomes-row'>
                            {active.recent_outcomes.length === 0 ? (
                                <span className='signals__field-hint'>No triggers yet in this window.</span>
                            ) : (
                                active.recent_outcomes.map((o, i) => (
                                    <div
                                        key={i}
                                        className={`signals__outcome-chip ${directionColorClass(o)} ${
                                            i === active.recent_outcomes.length - 1 ? 'latest' : ''
                                        }`}
                                    >
                                        {o === 'even' || o === 'over' ? label_a[0] : label_b[0]}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className='signals__panel'>
                        <h2>Recent ticks</h2>
                        <div className='signals__ticks-row'>
                            {active.recent_digits.map((d, i) => (
                                <div
                                    key={i}
                                    className={`signals__tick-chip ${d === ref_digit ? 'ref' : ''} ${
                                        i === active.recent_digits.length - 1 ? 'latest' : ''
                                    }`}
                                >
                                    {d}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
});

export default Signals;
