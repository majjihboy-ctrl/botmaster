import React from 'react';
import { observer } from 'mobx-react-lite';
import { useDigitStats, useSyntheticSymbols } from './use-digit-stats';
import './analysis-tool.scss';

const CHART_HEIGHT_PX = 140; // matches .analysis-tool__chart { height: 14rem } at the app's 62.5% root font-size

const AnalysisTool = observer(() => {
    const symbol_options = useSyntheticSymbols();
    const [symbol, setSymbol] = React.useState('R_100');
    const [tickCount, setTickCount] = React.useState(1000);
    const [overUnderDigit, setOverUnderDigit] = React.useState(5);

    const stats = useDigitStats(symbol, tickCount, overUnderDigit);
    const maxCount = Math.max(...stats.digit_counts, 1);
    const totalCount = stats.digit_counts.reduce((a, b) => a + b, 0) || 1;

    return (
        <div className='analysis-tool'>
            <div className='analysis-tool__topbar'>
                <div className='analysis-tool__title'>
                    <h1>Analysis Tool</h1>
                    <span className='analysis-tool__live'>
                        <span className='analysis-tool__pulse' />
                        {stats.is_loading ? 'CONNECTING' : 'LIVE'}
                    </span>
                </div>
                <div className='analysis-tool__controls'>
                    <span className='analysis-tool__field-label'>Symbol</span>
                    <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                        {symbol_options.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                                {s.display_name}
                            </option>
                        ))}
                    </select>
                    <span className='analysis-tool__field-label'>Ticks</span>
                    <input
                        type='number'
                        min={50}
                        max={5000}
                        step={50}
                        value={tickCount}
                        onChange={e => setTickCount(Math.max(50, Math.min(5000, Number(e.target.value) || 1000)))}
                    />
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
                            return (
                                <div className='analysis-tool__digit-col' key={i}>
                                    <div className='analysis-tool__digit-pct'>{pct}%</div>
                                    <div
                                        className={`analysis-tool__digit-bar ${cls}`}
                                        style={{ height: `${Math.max(4, (count / maxCount) * CHART_HEIGHT_PX)}px` }}
                                    />
                                    <div className='analysis-tool__digit-label'>{i}</div>
                                </div>
                            );
                        })}
                    </div>
                    <div className='analysis-tool__legend'>
                        <span>
                            <span className='analysis-tool__sw' style={{ background: '#22C55E' }} />
                            Most appearing
                        </span>
                        <span>
                            <span className='analysis-tool__sw' style={{ background: '#3B82F6' }} />
                            2nd most appearing
                        </span>
                        <span>
                            <span className='analysis-tool__sw' style={{ background: '#EF4444' }} />
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
                            <div style={{ width: `${stats.even_pct}%`, background: '#3B82F6' }} />
                            <div style={{ width: `${stats.odd_pct}%`, background: '#C7D2E0' }} />
                        </div>
                    </div>

                    <div className='analysis-tool__stat-card'>
                        <div className='analysis-tool__label'>Over / Under — editable digit</div>
                        <div className='analysis-tool__ou-row'>
                            <select value={overUnderDigit} onChange={e => setOverUnderDigit(Number(e.target.value))}>
                                {Array.from({ length: 10 }, (_, i) => (
                                    <option key={i} value={i}>
                                        {i}
                                    </option>
                                ))}
                            </select>
                            <span className='analysis-tool__ou-text'>
                                Over {overUnderDigit} / Under {overUnderDigit}
                            </span>
                        </div>
                        <div className='analysis-tool__stat-row'>
                            <span className='analysis-tool__val'>{stats.over_pct}%</span>
                            <span className='analysis-tool__val alt'>{stats.under_pct}%</span>
                        </div>
                        <div className='analysis-tool__bar-split'>
                            <div style={{ width: `${stats.over_pct}%`, background: '#3B82F6' }} />
                            <div style={{ width: `${stats.under_pct}%`, background: '#C7D2E0' }} />
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

            <div className='analysis-tool__panel analysis-tool__panel--chart'>
                <div className='analysis-tool__chart-header'>
                    <h2>Price movement — last {stats.recent_quotes.length} ticks</h2>
                    {stats.current_quote !== null && (
                        <div className='analysis-tool__price-readout'>
                            <span className='analysis-tool__price-value'>{stats.current_quote}</span>
                            <span
                                className={`analysis-tool__price-change ${stats.quote_change_pct >= 0 ? 'up' : 'down'}`}
                            >
                                {stats.quote_change_pct >= 0 ? '▲' : '▼'} {Math.abs(stats.quote_change_pct).toFixed(3)}%
                            </span>
                        </div>
                    )}
                </div>
                <PriceSparkline quotes={stats.recent_quotes} />
            </div>
        </div>
    );
});

const PriceSparkline = ({ quotes }: { quotes: number[] }) => {
    if (quotes.length < 2) {
        return <div className='analysis-tool__chart-empty'>Waiting for ticks…</div>;
    }
    const width = 1000;
    const height = 160;
    const min = Math.min(...quotes);
    const max = Math.max(...quotes);
    const range = max - min || 1;
    const points = quotes.map((q, i) => {
        const x = (i / (quotes.length - 1)) * width;
        const y = height - ((q - min) / range) * height;
        return [x, y];
    });
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
    const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
    const is_up = quotes[quotes.length - 1] >= quotes[0];

    return (
        <svg
            className='analysis-tool__sparkline'
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio='none'
        >
            <path d={areaPath} fill={is_up ? 'rgba(22,163,74,0.08)' : 'rgba(239,68,68,0.08)'} stroke='none' />
            <path d={linePath} fill='none' stroke={is_up ? '#16A34A' : '#EF4444'} strokeWidth={2} />
        </svg>
    );
};

export default AnalysisTool;
