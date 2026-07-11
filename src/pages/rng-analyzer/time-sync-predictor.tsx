import React, { useState } from 'react';
import { measureAndPredict, TTimeSyncResult } from './time-sync-math';

const TimeSyncPredictor: React.FC = () => {
    const [isPinging, setIsPinging] = useState(false);
    const [result, setResult] = useState<TTimeSyncResult | null>(null);

    const handleRun = async () => {
        setIsPinging(true);
        setResult(null);
        const res = await measureAndPredict(10);
        setResult(res);
        setIsPinging(false);
    };

    return (
        <div className='rng__module'>
            <div className='rng__panel'>
                <div className='rng__panel-header'>
                    <h3>Time Sync Predictor</h3>
                </div>
                <p className='rng__panel-desc'>
                    Tests whether a generator could be predictable if it seeds itself from server wall-clock time.
                    Measures round-trip latency to estimate the server&apos;s clock, then seeds a demonstration PRNG
                    (mulberry32) with that estimate.
                </p>
                <button type='button' className='rng__btn primary' onClick={handleRun} disabled={isPinging}>
                    {isPinging ? 'Pinging…' : 'Run Time Sync'}
                </button>

                {isPinging && (
                    <div className='rng__log'>
                        <div className='rng__log-line pulse'>&gt; sending probe request…</div>
                    </div>
                )}

                {result && !isPinging && (
                    <>
                        <div className='rng__stats-row'>
                            <div className='rng__stat'>
                                <span className='rng__stat-label'>round-trip time</span>
                                <span className='rng__stat-value'>
                                    {result.rttMs}ms{result.usedFallback ? ' (simulated)' : ''}
                                </span>
                            </div>
                            <div className='rng__stat'>
                                <span className='rng__stat-label'>estimated server time</span>
                                <span className='rng__stat-value'>
                                    {new Date(result.estimatedServerTimeMs).toISOString()}
                                </span>
                            </div>
                            <div className='rng__stat'>
                                <span className='rng__stat-label'>derived seed</span>
                                <span className='rng__stat-value'>{result.seed}</span>
                            </div>
                        </div>
                        <div className='rng__log'>
                            <div className='rng__log-line predict'>
                                &gt; generated sequence: [{result.digits.join(', ')}]
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default TimeSyncPredictor;
