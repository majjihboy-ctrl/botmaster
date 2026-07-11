import React, { useState } from 'react';
import LCGCracker from './lcg-cracker';
import LSTMPredictor from './lstm-predictor';
import StatisticalAnalysis from './statistical-analysis';
import { generateCryptoRandomDigits, generateFlawedLCGDigits, TickDataProvider, useTickData } from './tick-data-context';
import TimeSyncPredictor from './time-sync-predictor';
import './rng-analyzer.scss';

type TModuleId = 'stats' | 'lcg' | 'time-sync' | 'lstm';

const MODULES: { id: TModuleId; label: string; hint: string }[] = [
    { id: 'stats', label: 'Statistical Analysis', hint: 'Chi-square, autocorrelation, runs test' },
    { id: 'lcg', label: 'LCG Cracker', hint: 'Reverse-engineer a weak seed' },
    { id: 'time-sync', label: 'Time Sync Predictor', hint: 'Server-clock seed guessing' },
    { id: 'lstm', label: 'LSTM Neural Network', hint: 'Non-linear pattern search' },
];

const DataIngestion: React.FC = () => {
    const { ticks, source, setTicks, addTicks, clearTicks } = useTickData();
    const [pasteText, setPasteText] = useState('');
    const [pasteError, setPasteError] = useState<string | null>(null);

    const handleGenerateCryptoRandom = () => {
        setTicks(generateCryptoRandomDigits(1000), 'crypto-random');
    };

    const handleGenerateFlawedLCG = () => {
        setTicks(generateFlawedLCGDigits(1000), 'flawed-lcg');
    };

    const handlePasteAdd = () => {
        setPasteError(null);
        const parsed = pasteText
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(Number);

        if (parsed.length === 0) {
            setPasteError('Enter comma-separated digits, e.g. 1,4,9,2,7');
            return;
        }
        if (parsed.some(n => !Number.isInteger(n) || n < 0 || n > 9)) {
            setPasteError('All values must be integers between 0 and 9.');
            return;
        }
        addTicks(parsed, 'pasted');
        setPasteText('');
    };

    return (
        <div className='rng__ingestion'>
            <div className='rng__ingestion-row'>
                <button type='button' className='rng__btn' onClick={handleGenerateCryptoRandom}>
                    Generate 1,000 True Random (crypto)
                </button>
                <button type='button' className='rng__btn' onClick={handleGenerateFlawedLCG}>
                    Generate 1,000 Flawed LCG
                </button>
                <button type='button' className='rng__btn danger' onClick={clearTicks} disabled={ticks.length === 0}>
                    Clear
                </button>
                <div className='rng__ingestion-status'>
                    <span className='rng__stat-label'>loaded</span>
                    <span className='rng__stat-value'>{ticks.length} ticks</span>
                    {source !== 'none' && <span className='rng__source-tag'>{source}</span>}
                </div>
            </div>
            <div className='rng__ingestion-row'>
                <textarea
                    className='rng__textarea rng__textarea--inline'
                    placeholder='Paste your own comma-separated digits, e.g. 1,4,9,2,7,0,3...'
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    rows={2}
                />
                <button type='button' className='rng__btn' onClick={handlePasteAdd}>
                    Add to sequence
                </button>
            </div>
            {pasteError && <div className='rng__error'>{pasteError}</div>}
        </div>
    );
};

const RNGAnalyzerContent: React.FC = () => {
    const [activeModule, setActiveModule] = useState<TModuleId>('stats');

    return (
        <div className='rng-analyzer'>
            <DataIngestion />
            <div className='rng-analyzer__body'>
                <div className='rng-analyzer__sidebar'>
                    {MODULES.map(m => (
                        <button
                            key={m.id}
                            type='button'
                            className={`rng-analyzer__nav-item ${activeModule === m.id ? 'active' : ''}`}
                            onClick={() => setActiveModule(m.id)}
                        >
                            <span className='rng-analyzer__nav-label'>{m.label}</span>
                            <span className='rng-analyzer__nav-hint'>{m.hint}</span>
                        </button>
                    ))}
                </div>
                <div className='rng-analyzer__content'>
                    {activeModule === 'stats' && <StatisticalAnalysis />}
                    {activeModule === 'lcg' && <LCGCracker />}
                    {activeModule === 'time-sync' && <TimeSyncPredictor />}
                    {activeModule === 'lstm' && <LSTMPredictor />}
                </div>
            </div>
        </div>
    );
};

const RNGAnalyzer: React.FC = () => (
    <TickDataProvider>
        <RNGAnalyzerContent />
    </TickDataProvider>
);

export default RNGAnalyzer;
