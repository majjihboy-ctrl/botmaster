import React, { useState } from 'react';
import { crackLCG, TLCGCrackResult } from './lcg-cracker-math';

const LCGCracker: React.FC = () => {
    const [input, setInput] = useState('');
    const [result, setResult] = useState<TLCGCrackResult | null>(null);
    const [parseError, setParseError] = useState<string | null>(null);

    const handleCrack = () => {
        setParseError(null);
        const parts = input
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        if (parts.length < 4) {
            setParseError('Enter at least 4 comma-separated known outputs.');
            setResult(null);
            return;
        }

        let rawOutputs: bigint[];
        try {
            rawOutputs = parts.map(p => {
                if (!/^-?\d+$/.test(p)) throw new Error(`"${p}" is not an integer`);
                return BigInt(p);
            });
        } catch (e) {
            setParseError(e instanceof Error ? e.message : 'Invalid input — use comma-separated integers.');
            setResult(null);
            return;
        }

        setResult(crackLCG(rawOutputs, 5));
    };

    return (
        <div className='rng__module'>
            <div className='rng__panel'>
                <div className='rng__panel-header'>
                    <h3>LCG Cracker — Reverse-Engineer X_next = (a·X + c) mod m</h3>
                </div>
                <p className='rng__panel-desc'>
                    Paste at least 4 known raw outputs from a suspected Linear Congruential Generator (comma-separated
                    integers). 6 or more gives a materially more reliable modulus guess.
                </p>
                <textarea
                    className='rng__textarea'
                    placeholder='e.g. 12345, 89234123, 55123987, 10394821, 77012394, 33921044'
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    rows={3}
                />
                <button type='button' className='rng__btn primary' onClick={handleCrack}>
                    Crack Generator
                </button>
                {parseError && <div className='rng__error'>{parseError}</div>}
            </div>

            {result && result.success === false && (
                <div className='rng__panel'>
                    <div className='rng__error'>{result.error}</div>
                    <div className='rng__log'>
                        {result.log.map((line, i) => (
                            <div className='rng__log-line' key={i}>
                                {line}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {result && result.success && (
                <>
                    <div className='rng__panel'>
                        <div className='rng__panel-header'>
                            <h3>Cracked Parameters</h3>
                        </div>
                        <div className='rng__glow-grid'>
                            <div className='rng__glow-card'>
                                <span className='rng__glow-label'>modulus (m)</span>
                                <span className='rng__glow-value'>{result.m.toString()}</span>
                            </div>
                            <div className='rng__glow-card'>
                                <span className='rng__glow-label'>multiplier (a)</span>
                                <span className='rng__glow-value'>{result.a.toString()}</span>
                            </div>
                            <div className='rng__glow-card'>
                                <span className='rng__glow-label'>increment (c)</span>
                                <span className='rng__glow-value'>{result.c.toString()}</span>
                            </div>
                        </div>
                    </div>

                    <div className='rng__panel'>
                        <div className='rng__panel-header'>
                            <h3>Predicted Next 5 Outputs</h3>
                        </div>
                        <div className='rng__log'>
                            {result.predicted.map((p, i) => (
                                <div className='rng__log-line predict' key={i}>
                                    X[{i + 1}] = {p.toString()}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className='rng__panel'>
                        <div className='rng__panel-header'>
                            <h3>Full Working</h3>
                        </div>
                        <div className='rng__log'>
                            {result.log.map((line, i) => (
                                <div className='rng__log-line' key={i}>
                                    {line}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default LCGCracker;
