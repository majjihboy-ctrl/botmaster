import React, { useMemo } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { autocorrelationAnalysis, frequencyAnalysis, runsTest } from './stats-math';
import { useTickData } from './tick-data-context';

const StatisticalAnalysis: React.FC = () => {
    const { ticks } = useTickData();

    const freq = useMemo(() => frequencyAnalysis(ticks), [ticks]);
    const autocorr = useMemo(() => autocorrelationAnalysis(ticks), [ticks]);
    const runs = useMemo(() => runsTest(ticks), [ticks]);

    const freqChartData = freq.observed.map((count, digit) => ({
        digit: String(digit),
        observed: count,
        expected: Math.round(freq.expected * 100) / 100,
    }));

    const anomalyLags = autocorr.filter(p => p.isAnomaly);

    if (ticks.length === 0) {
        return <div className='rng__empty'>No tick data loaded. Generate or paste data above to run analysis.</div>;
    }

    return (
        <div className='rng__module'>
            {/* --- Frequency Analysis (Chi-Square) --- */}
            <div className='rng__panel'>
                <div className='rng__panel-header'>
                    <h3>Frequency Analysis — Chi-Square Test</h3>
                    <span className={`rng__badge ${freq.passed ? 'pass' : 'fail'}`}>
                        {freq.passed ? 'PASS — looks random' : 'FAIL — deviation detected'}
                    </span>
                </div>
                <div className='rng__chart-wrap'>
                    <ResponsiveContainer width='100%' height={260}>
                        <BarChart data={freqChartData}>
                            <CartesianGrid strokeDasharray='3 3' stroke='#1e2937' />
                            <XAxis dataKey='digit' stroke='#5eead4' tick={{ fill: '#8fa3b8', fontSize: 12 }} />
                            <YAxis stroke='#5eead4' tick={{ fill: '#8fa3b8', fontSize: 12 }} />
                            <Tooltip
                                contentStyle={{ background: '#0b1220', border: '1px solid #1e2937', color: '#e2e8f0' }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12, color: '#8fa3b8' }} />
                            <Bar dataKey='observed' fill='#22d3ee' name='Observed' radius={[3, 3, 0, 0]} />
                            <Bar dataKey='expected' fill='#3f4b5c' name='Expected' radius={[3, 3, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                <div className='rng__stats-row'>
                    <div className='rng__stat'>
                        <span className='rng__stat-label'>χ² statistic</span>
                        <span className='rng__stat-value'>{freq.chiSquare.toFixed(4)}</span>
                    </div>
                    <div className='rng__stat'>
                        <span className='rng__stat-label'>p-value</span>
                        <span className='rng__stat-value'>{freq.pValue.toFixed(4)}</span>
                    </div>
                    <div className='rng__stat'>
                        <span className='rng__stat-label'>df</span>
                        <span className='rng__stat-value'>{freq.df}</span>
                    </div>
                    <div className='rng__stat'>
                        <span className='rng__stat-label'>n</span>
                        <span className='rng__stat-value'>{ticks.length}</span>
                    </div>
                </div>
            </div>

            {/* --- Autocorrelation --- */}
            <div className='rng__panel'>
                <div className='rng__panel-header'>
                    <h3>Autocorrelation Test</h3>
                    <span className={`rng__badge ${anomalyLags.length === 0 ? 'pass' : 'fail'}`}>
                        {anomalyLags.length === 0 ? 'PASS — no lag anomalies' : `${anomalyLags.length} ANOMALY LAG(S)`}
                    </span>
                </div>
                <div className='rng__chart-wrap'>
                    <ResponsiveContainer width='100%' height={220}>
                        <LineChart data={autocorr}>
                            <CartesianGrid strokeDasharray='3 3' stroke='#1e2937' />
                            <XAxis
                                dataKey='lag'
                                stroke='#5eead4'
                                tick={{ fill: '#8fa3b8', fontSize: 12 }}
                                label={{ value: 'Lag', position: 'insideBottom', offset: -5, fill: '#8fa3b8' }}
                            />
                            <YAxis stroke='#5eead4' tick={{ fill: '#8fa3b8', fontSize: 12 }} domain={[-0.2, 0.2]} />
                            <Tooltip
                                contentStyle={{ background: '#0b1220', border: '1px solid #1e2937', color: '#e2e8f0' }}
                                formatter={(value: number) => value.toFixed(4)}
                            />
                            <ReferenceLine y={0.05} stroke='#f87171' strokeDasharray='4 4' />
                            <ReferenceLine y={-0.05} stroke='#f87171' strokeDasharray='4 4' />
                            <ReferenceLine y={0} stroke='#3f4b5c' />
                            <Line
                                type='monotone'
                                dataKey='correlation'
                                stroke='#22d3ee'
                                strokeWidth={2}
                                dot={{ r: 3, fill: '#22d3ee' }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                {anomalyLags.length > 0 && (
                    <div className='rng__log'>
                        {anomalyLags.map(a => (
                            <div className='rng__log-line warn' key={a.lag}>
                                lag {a.lag}: correlation = {a.correlation.toFixed(4)} — ANOMALY (|r| &gt; 0.05)
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* --- Runs Test --- */}
            <div className='rng__panel'>
                <div className='rng__panel-header'>
                    <h3>The Runs Test — Wald-Wolfowitz</h3>
                    <span className={`rng__badge ${!runs.rejectRandomness ? 'pass' : 'fail'}`}>
                        {!runs.rejectRandomness ? 'PASS — looks random' : 'FAIL — reject randomness'}
                    </span>
                </div>
                <div className='rng__log'>
                    {runs.log.map((line, i) => (
                        <div className='rng__log-line' key={i}>
                            {line}
                        </div>
                    ))}
                </div>
                <div className='rng__stats-row'>
                    <div className='rng__stat'>
                        <span className='rng__stat-label'>Z-score</span>
                        <span className='rng__stat-value'>{runs.zScore.toFixed(4)}</span>
                    </div>
                    <div className='rng__stat'>
                        <span className='rng__stat-label'>observed runs</span>
                        <span className='rng__stat-value'>{runs.observedRuns}</span>
                    </div>
                    <div className='rng__stat'>
                        <span className='rng__stat-label'>expected runs</span>
                        <span className='rng__stat-value'>{runs.expectedRuns.toFixed(2)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StatisticalAnalysis;
