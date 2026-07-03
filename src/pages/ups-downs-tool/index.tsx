import React from 'react';
import { observer } from 'mobx-react-lite';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { localize } from '@deriv-com/translations';
import { useUpDownStats } from './use-updown-stats';
import './ups-downs-tool.scss';

const UpsDownsTool = observer(() => {
    const symbol_options = useSyntheticSymbols();
    const [symbol, setSymbol] = React.useState('R_100');
    const [tick_window, setTickWindow] = React.useState(500);
    const [reset_key, setResetKey] = React.useState(0);

    const stats = useUpDownStats(symbol, tick_window, reset_key);

    const up_hist_entries = Object.entries(stats.up_streak_histogram)
        .map(([len, count]) => ({ len: Number(len), count }))
        .sort((a, b) => a.len - b.len);
    const down_hist_entries = Object.entries(stats.down_streak_histogram)
        .map(([len, count]) => ({ len: Number(len), count }))
        .sort((a, b) => a.len - b.len);
    const hist_max = Math.max(1, ...up_hist_entries.map(e => e.count), ...down_hist_entries.map(e => e.count));

    return (
        <div className='updown-tool'>
            <div className='updown-tool__topbar'>
                <div className='updown-tool__title'>
                    <h1>{localize('Only Ups / Only Downs')}</h1>
                    <span className='updown-tool__live'>
                        <span className='updown-tool__pulse' />
                        {stats.is_loading ? localize('CONNECTING') : localize('LIVE')}
                    </span>
                </div>
                <div className='updown-tool__controls'>
                    <span className='updown-tool__field-label'>{localize('Symbol')}</span>
                    <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                        {symbol_options.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                                {s.display_name}
                            </option>
                        ))}
                    </select>
                    <span className='updown-tool__field-label'>{localize('Window')}</span>
                    <input
                        type='number'
                        min={50}
                        max={5000}
                        step={50}
                        value={tick_window}
                        onChange={e => setTickWindow(Math.max(50, Math.min(5000, Number(e.target.value) || 500)))}
                    />
                    <button
                        type='button'
                        className='updown-tool__reset-btn'
                        onClick={() => setResetKey(k => k + 1)}
                        title={localize('Reset streak history for this session')}
                    >
                        {localize('Reset session')}
                    </button>
                </div>
            </div>

            <div className='updown-tool__grid'>
                <div className='updown-tool__panel'>
                    <h2>
                        {localize('Up / Down ratio — last')} {tick_window} {localize('ticks')}
                    </h2>
                    <div className='updown-tool__ratio-row'>
                        <div className='updown-tool__ratio-block up'>
                            <span className='updown-tool__ratio-arrow'>▲</span>
                            <span className='updown-tool__ratio-value'>{stats.window_up_pct}%</span>
                            <span className='updown-tool__ratio-label'>{localize('Up')}</span>
                        </div>
                        <div className='updown-tool__ratio-block down'>
                            <span className='updown-tool__ratio-arrow'>▼</span>
                            <span className='updown-tool__ratio-value'>{stats.window_down_pct}%</span>
                            <span className='updown-tool__ratio-label'>{localize('Down')}</span>
                        </div>
                    </div>
                    <div className='updown-tool__bar-split'>
                        <div style={{ width: `${stats.window_up_pct}%` }} className='up' />
                        <div style={{ width: `${stats.window_down_pct}%` }} className='down' />
                    </div>
                </div>

                <div className='updown-tool__stat-stack'>
                    <div className='updown-tool__stat-card'>
                        <div className='updown-tool__label'>{localize('Current streak')}</div>
                        <div className='updown-tool__streak'>
                            <span className={`updown-tool__streak-arrow ${stats.current_streak_dir ?? ''}`}>
                                {stats.current_streak_dir === 'down' ? '▼' : '▲'}
                            </span>
                            <span className='updown-tool__streak-count'>{stats.current_streak_count}</span>
                            <span className='updown-tool__streak-label'>
                                {stats.current_streak_dir === 'down'
                                    ? localize('downs in a row')
                                    : stats.current_streak_dir === 'up'
                                      ? localize('ups in a row')
                                      : localize('no streak yet')}
                            </span>
                        </div>
                    </div>

                    <div className='updown-tool__stat-card'>
                        <div className='updown-tool__label'>{localize('Ticks since last')}</div>
                        <div className='updown-tool__since-row'>
                            <div>
                                <span className='updown-tool__since-arrow up'>▲</span>
                                <span className='updown-tool__since-value'>
                                    {stats.ticks_since_up === -1 ? '—' : stats.ticks_since_up}
                                </span>
                            </div>
                            <div>
                                <span className='updown-tool__since-arrow down'>▼</span>
                                <span className='updown-tool__since-value'>
                                    {stats.ticks_since_down === -1 ? '—' : stats.ticks_since_down}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className='updown-tool__panel'>
                <h2>
                    {localize('Multi-window comparison')} — {localize('this session')}
                </h2>
                <div className='updown-tool__compare-table'>
                    <div className='updown-tool__compare-row updown-tool__compare-row--head'>
                        <div>{localize('Window')}</div>
                        <div>{localize('Up %')}</div>
                        <div>{localize('Down %')}</div>
                    </div>
                    {stats.window_counts.map(w => (
                        <div className='updown-tool__compare-row' key={w.label}>
                            <div>{w.label}</div>
                            <div className='up'>{w.up_pct}%</div>
                            <div className='down'>{w.down_pct}%</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className='updown-tool__panel'>
                <h2>
                    {localize('Streak length histogram')} — {stats.total_ticks_seen} {localize('ticks this session')}
                </h2>
                <div className='updown-tool__hist-cols'>
                    <div className='updown-tool__hist-col'>
                        <div className='updown-tool__hist-col-title up'>{localize('Up streaks')}</div>
                        {up_hist_entries.length === 0 && (
                            <div className='updown-tool__hist-empty'>{localize('No completed streaks yet')}</div>
                        )}
                        {up_hist_entries.map(e => (
                            <div className='updown-tool__hist-row' key={e.len}>
                                <span className='updown-tool__hist-len'>{e.len}</span>
                                <div className='updown-tool__hist-bar-track'>
                                    <div
                                        className='updown-tool__hist-bar up'
                                        style={{ width: `${(e.count / hist_max) * 100}%` }}
                                    />
                                </div>
                                <span className='updown-tool__hist-count'>{e.count}</span>
                            </div>
                        ))}
                    </div>
                    <div className='updown-tool__hist-col'>
                        <div className='updown-tool__hist-col-title down'>{localize('Down streaks')}</div>
                        {down_hist_entries.length === 0 && (
                            <div className='updown-tool__hist-empty'>{localize('No completed streaks yet')}</div>
                        )}
                        {down_hist_entries.map(e => (
                            <div className='updown-tool__hist-row' key={e.len}>
                                <span className='updown-tool__hist-len'>{e.len}</span>
                                <div className='updown-tool__hist-bar-track'>
                                    <div
                                        className='updown-tool__hist-bar down'
                                        style={{ width: `${(e.count / hist_max) * 100}%` }}
                                    />
                                </div>
                                <span className='updown-tool__hist-count'>{e.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className='updown-tool__panel'>
                <h2>{localize('Recent ticks')}</h2>
                <div className='updown-tool__chip-row'>
                    {stats.recent_directions.map((d, i) => (
                        <div
                            key={i}
                            className={`updown-tool__chip ${d === 1 ? 'up' : d === -1 ? 'down' : 'flat'}`}
                            title={d === 1 ? 'Up' : d === -1 ? 'Down' : 'Flat'}
                        >
                            {d === 1 ? '▲' : d === -1 ? '▼' : '•'}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

export default UpsDownsTool;
