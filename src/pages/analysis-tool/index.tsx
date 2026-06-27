import React from 'react';
import { observer } from 'mobx-react-lite';
import { useDigitStats, useSyntheticSymbols } from './use-digit-stats';
import './analysis-tool.scss';

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
                                        style={{ height: `${(count / maxCount) * 100}%` }}
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
        </div>
    );
});

export default AnalysisTool;
