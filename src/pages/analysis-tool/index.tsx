import React from 'react';
import { observer } from 'mobx-react-lite';
import { useDigitStats, useSyntheticSymbols } from './use-digit-stats';
import './analysis-tool.scss';

const STORAGE_KEY = 'analysis_tool_settings';

type TStoredSettings = {
    symbol?: string;
    tickCount?: number;
    overUnderDigit?: number;
    selectedDigit?: number | null;
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
        // localStorage unavailable (private browsing, etc.) — fail silently,
        // the tool still works, it just won't remember the selection.
    }
};

const AnalysisTool = observer(() => {
    const symbol_options = useSyntheticSymbols();
    const stored = React.useMemo(() => loadStoredSettings(), []);
    const [symbol, setSymbolState] = React.useState(stored.symbol ?? 'R_100');
    const [tickCount, setTickCountState] = React.useState(stored.tickCount ?? 1000);
    const [overUnderDigit, setOverUnderDigitState] = React.useState(stored.overUnderDigit ?? 5);
    const [selectedDigit, setSelectedDigitState] = React.useState<number | null>(stored.selectedDigit ?? null);

    const setSymbol = (value: string) => {
        setSymbolState(value);
        saveStoredSettings({ symbol: value });
    };
    const setTickCount = (value: number) => {
        setTickCountState(value);
        saveStoredSettings({ tickCount: value });
    };
    const setOverUnderDigit = (value: number) => {
        setOverUnderDigitState(value);
        saveStoredSettings({ overUnderDigit: value });
    };
    const setSelectedDigit = (value: number | null) => {
        setSelectedDigitState(value);
        saveStoredSettings({ selectedDigit: value });
    };

    const stats = useDigitStats(symbol, tickCount, overUnderDigit);
    const maxCount = Math.max(...stats.digit_counts, 1);
    const totalCount = stats.digit_counts.reduce((a, b) => a + b, 0) || 1;

    // Default the picked digit to whichever is currently "most" once data loads,
    // but never override a digit the person has actually clicked on (or one
    // restored from a previous visit).
    const hasUserPicked = React.useRef(stored.selectedDigit != null);
    React.useEffect(() => {
        if (!hasUserPicked.current && !stats.is_loading && stats.digits.length) {
            setSelectedDigit(stats.most_idx);
        }
    }, [stats.is_loading, stats.most_idx, stats.digits.length]);

    const handlePickDigit = (digit: number) => {
        hasUserPicked.current = true;
        setSelectedDigit(digit);
    };

    // Matches stats for the picked digit: how often it lands, how long the gaps
    // between matches run, and how long it's been since it last landed.
    const matchStats = React.useMemo(() => {
        if (selectedDigit === null || !stats.digits.length) {
            return { count: 0, match_pct: 0, avg_gap: 0, max_gap: 0, since_last: -1 };
        }
        const digits = stats.digits;
        const positions: number[] = [];
        digits.forEach((d, i) => {
            if (d === selectedDigit) positions.push(i);
        });
        const count = positions.length;
        const match_pct = Number(((count / digits.length) * 100).toFixed(1));
        let avg_gap = 0;
        let max_gap = 0;
        if (count > 1) {
            const gaps: number[] = [];
            for (let i = 1; i < positions.length; i++) gaps.push(positions[i] - positions[i - 1]);
            avg_gap = Number((gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1));
            max_gap = Math.max(...gaps);
        }
        const since_last = count ? digits.length - 1 - positions[positions.length - 1] : -1;
        return { count, match_pct, avg_gap, max_gap, since_last };
    }, [selectedDigit, stats.digits]);

    // "Due" heuristic: gap since last match is already at or past the average
    // gap for that digit, so a match is statistically overdue in this window.
    const is_overdue =
        matchStats.count > 1 && matchStats.since_last >= 0 && matchStats.since_last >= matchStats.avg_gap;

    return (
        <div className='analysis-tool'>
            <div className='analysis-tool__topbar'>
                <div className='analysis-tool__title'>
                    <h1>Analysis Tool</h1>
                    <span className={`analysis-tool__live ${stats.is_stale ? 'stale' : ''}`}>
                        <span className='analysis-tool__pulse' />
                        {stats.is_loading ? 'CONNECTING' : stats.is_stale ? 'RECONNECTING' : 'LIVE'}
                    </span>
                </div>
                <div className='analysis-tool__controls'>
                    <label className='analysis-tool__field-label' htmlFor='analysis-tool-symbol'>
                        Symbol
                    </label>
                    <select
                        id='analysis-tool-symbol'
                        aria-label='Symbol'
                        value={symbol}
                        onChange={e => setSymbol(e.target.value)}
                    >
                        {symbol_options.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                                {s.display_name}
                            </option>
                        ))}
                    </select>
                    <label className='analysis-tool__field-label' htmlFor='analysis-tool-tick-count'>
                        Ticks
                    </label>
                    <input
                        id='analysis-tool-tick-count'
                        aria-label='Number of ticks'
                        type='number'
                        min={50}
                        max={5000}
                        step={50}
                        value={tickCount}
                        onChange={e => setTickCount(Math.max(50, Math.min(5000, Number(e.target.value) || 1000)))}
                    />
                </div>
            </div>

            <div className='analysis-tool__panel'>
                <h2>Recent ticks</h2>
                <div className='analysis-tool__ticks-row'>
                    {stats.recent_digits.map((d, i) => (
                        <div
                            className={`analysis-tool__tick-chip ${i === stats.recent_digits.length - 1 ? 'latest' : ''}`}
                            key={i}
                        >
                            {d}
                        </div>
                    ))}
                </div>
            </div>

            <div className='analysis-tool__grid'>
                <div className='analysis-tool__panel'>
                    <h2>Digit distribution — last {tickCount} ticks</h2>
                    <div className='analysis-tool__chart'>
                        {stats.digit_counts.map((count, i) => {
                            const pct = ((count / totalCount) * 100).toFixed(1);
                            let cls = '';
                            if (i === stats.most_idx) cls = 'most';
                            else if (i === stats.second_idx) cls = 'second';
                            else if (i === stats.least_idx) cls = 'least';
                            if (i === selectedDigit) cls += ' selected';
                            const size = 5.2 + (count / maxCount) * 3.6; // rem
                            return (
                                <div className='analysis-tool__digit-col' key={i}>
                                    <div
                                        className={`analysis-tool__digit-circle ${cls}`}
                                        style={{ width: `${size}rem`, height: `${size}rem` }}
                                        onClick={() => handlePickDigit(i)}
                                        role='button'
                                        tabIndex={0}
                                        title={`Pick digit ${i} for Matches`}
                                    >
                                        {i}
                                    </div>
                                    <div className='analysis-tool__digit-pct'>{pct}%</div>
                                </div>
                            );
                        })}
                    </div>
                    <div className='analysis-tool__legend'>
                        <span>
                            <span className='analysis-tool__sw' style={{ background: 'var(--status-success)' }} />
                            Most appearing
                        </span>
                        <span>
                            <span className='analysis-tool__sw' style={{ background: 'var(--status-info)' }} />
                            2nd most appearing
                        </span>
                        <span>
                            <span className='analysis-tool__sw' style={{ background: 'var(--status-danger)' }} />
                            Least appearing
                        </span>
                    </div>
                </div>

                <div className='analysis-tool__stat-stack'>
                    <div className='analysis-tool__stat-card'>
                        <div className='analysis-tool__label'>Even / Odd</div>
                        <div className='analysis-tool__stat-row'>
                            <span className='analysis-tool__val'>{stats.even_pct}%</span>
                            <span className='analysis-tool__val alt'>{stats.odd_pct}%</span>
                        </div>
                        <div className='analysis-tool__bar-split'>
                            <div style={{ width: `${stats.even_pct}%`, background: 'var(--status-info)' }} />
                            <div style={{ width: `${stats.odd_pct}%`, background: 'var(--status-disabled)' }} />
                        </div>
                    </div>

                    <div className='analysis-tool__stat-card'>
                        <div className='analysis-tool__label'>Over / Under — editable digit</div>
                        <div className='analysis-tool__ou-row'>
                            <select
                                aria-label='Over/under threshold digit'
                                value={overUnderDigit}
                                onChange={e => setOverUnderDigit(Number(e.target.value))}
                            >
                                {Array.from({ length: 10 }, (_, i) => i).map(i => (
                                    <option key={i} value={i}>
                                        {i}
                                    </option>
                                ))}
                            </select>
                            <span className='analysis-tool__ou-text'>
                                Over {overUnderDigit} / Equal {overUnderDigit} / Under {overUnderDigit}
                            </span>
                        </div>
                        <div className='analysis-tool__stat-row'>
                            <span className='analysis-tool__val'>{stats.over_pct}%</span>
                            <span className='analysis-tool__val equal'>{stats.equal_pct}%</span>
                            <span className='analysis-tool__val alt'>{stats.under_pct}%</span>
                        </div>
                        <div className='analysis-tool__bar-split'>
                            <div style={{ width: `${stats.over_pct}%`, background: 'var(--status-info)' }} />
                            <div style={{ width: `${stats.equal_pct}%`, background: 'var(--text-less-prominent)' }} />
                            <div style={{ width: `${stats.under_pct}%`, background: 'var(--status-disabled)' }} />
                        </div>
                    </div>

                    <div className='analysis-tool__stat-card'>
                        <div className='analysis-tool__label'>Rise / Fall (whole window)</div>
                        <div className='analysis-tool__stat-row'>
                            <span className='analysis-tool__val'>{stats.rise_pct}%</span>
                            <span className='analysis-tool__val alt'>{stats.fall_pct}%</span>
                        </div>
                        <div className='analysis-tool__bar-split'>
                            <div style={{ width: `${stats.rise_pct}%`, background: '#16A34A' }} />
                            <div style={{ width: `${stats.fall_pct}%`, background: '#EF4444' }} />
                        </div>
                    </div>

                    <div className='analysis-tool__stat-card'>
                        <div className='analysis-tool__label'>Current streak</div>
                        <div className='analysis-tool__streak'>
                            <span className='analysis-tool__arrow'>
                                {stats.streak_direction === 'fall' ? '▼' : '▲'}
                            </span>
                            <span className='analysis-tool__count'>{stats.streak_count}</span>
                            <span className='analysis-tool__streak-label'>
                                {stats.streak_direction === 'fall' ? 'falls in a row' : 'rises in a row'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className='analysis-tool__panel'>
                <h2>Digit frequency by window — and ticks since last seen</h2>
                <div className='analysis-tool__compare-table'>
                    <div className='analysis-tool__compare-row analysis-tool__compare-row--head'>
                        <div>Digit</div>
                        {stats.window_counts.map(w => (
                            <div key={w.label}>{w.label}</div>
                        ))}
                        <div>Last seen</div>
                    </div>
                    {Array.from({ length: 10 }, (_, d) => (
                        <div className='analysis-tool__compare-row' key={d}>
                            <div className='analysis-tool__compare-digit'>{d}</div>
                            {stats.window_counts.map(w => {
                                const win_total = w.counts.reduce((a, b) => a + b, 0) || 1;
                                const pct = ((w.counts[d] / win_total) * 100).toFixed(1);
                                return <div key={w.label}>{pct}%</div>;
                            })}
                            <div className='analysis-tool__compare-lastseen'>
                                {stats.ticks_since_last_seen[d] === -1
                                    ? '—'
                                    : `${stats.ticks_since_last_seen[d]} ago`}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className='analysis-tool__panel analysis-tool__panel--matches'>
                <div className='analysis-tool__chart-header'>
                    <h2>Digit Matches</h2>
                    <span className='analysis-tool__matches-hint'>Tap a digit in the chart below to target it</span>
                </div>
                {selectedDigit === null ? (
                    <div className='analysis-tool__chart-empty'>Waiting for data…</div>
                ) : (
                    <div className='analysis-tool__matches-body'>
                        <div className='analysis-tool__matches-digit'>{selectedDigit}</div>
                        <div className='analysis-tool__matches-stats'>
                            <div className='analysis-tool__matches-stat'>
                                <span className='analysis-tool__matches-stat-val'>{matchStats.match_pct}%</span>
                                <span className='analysis-tool__matches-stat-label'>Match rate</span>
                            </div>
                            <div className='analysis-tool__matches-stat'>
                                <span className='analysis-tool__matches-stat-val'>{matchStats.count}</span>
                                <span className='analysis-tool__matches-stat-label'>Matches seen</span>
                            </div>
                            <div className='analysis-tool__matches-stat'>
                                <span className='analysis-tool__matches-stat-val'>
                                    {matchStats.since_last === -1 ? '—' : matchStats.since_last}
                                </span>
                                <span className='analysis-tool__matches-stat-label'>Ticks since last</span>
                            </div>
                            <div className='analysis-tool__matches-stat'>
                                <span className='analysis-tool__matches-stat-val'>{matchStats.avg_gap || '—'}</span>
                                <span className='analysis-tool__matches-stat-label'>Avg gap</span>
                            </div>
                            <div className='analysis-tool__matches-stat'>
                                <span className='analysis-tool__matches-stat-val'>{matchStats.max_gap || '—'}</span>
                                <span className='analysis-tool__matches-stat-label'>Longest gap</span>
                            </div>
                        </div>
                        <div className={`analysis-tool__matches-flag ${is_overdue ? 'due' : ''}`}>
                            {is_overdue
                                ? `Overdue — it's gone ${matchStats.since_last} ticks without a match vs an average gap of ${matchStats.avg_gap}`
                                : `On pace — average gap for this digit is ${matchStats.avg_gap || '—'} ticks`}
                        </div>
                    </div>
                )}
            </div>

            <div className='analysis-tool__panel'>
                <h2>Even / Odd — last {stats.recent_digits_100.length} ticks</h2>
                <div className='analysis-tool__eo-row'>
                    {stats.recent_digits_100.map((d, i) => (
                        <div
                            key={i}
                            className={`analysis-tool__eo-dot ${d % 2 === 0 ? 'even' : 'odd'}`}
                            title={`${d} (${d % 2 === 0 ? 'even' : 'odd'})`}
                        />
                    ))}
                </div>
                <div className='analysis-tool__legend'>
                    <span>
                        <span className='analysis-tool__sw' style={{ background: '#22C55E' }} />
                        Even
                    </span>
                    <span>
                        <span className='analysis-tool__sw' style={{ background: '#EF4444' }} />
                        Odd
                    </span>
                </div>
            </div>
        </div>
    );
});

export default AnalysisTool;
