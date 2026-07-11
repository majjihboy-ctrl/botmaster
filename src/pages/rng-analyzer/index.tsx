import React, { useEffect, useState } from 'react';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import LCGCracker from './lcg-cracker';
import LSTMPredictor from './lstm-predictor';
import StatisticalAnalysis from './statistical-analysis';
import { generateCryptoRandomDigits, generateFlawedLCGDigits, TickDataProvider, useTickData } from './tick-data-context';
import TimeSyncPredictor from './time-sync-predictor';
import { useLiveDerivTicks } from './use-live-deriv-ticks';
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
    const symbol_options = useSyntheticSymbols();
    const [liveSymbol, setLiveSymbol] = useState('1HZ100V');

    const { state: liveState, start: startLive, stop: stopLive } = useLiveDerivTicks(digit => addTicks([digit], 'live-deriv'));

    // Tear down the live subscription if the whole tab unmounts while connected.
    useEffect(() => stopLive, [stopLive]);

    const handleGenerateCryptoRandom = () => {
        stopLive();
        setTicks(generateCryptoRandomDigits(1000), 'crypto-random');
    };

    const handleGenerateFlawedLCG = () => {
        stopLive();
        setTicks(generateFlawedLCGDigits(1000), 'flawed-lcg');
    };

    const handleToggleLive = () => {
        if (liveState.isConnected || liveState.isConnecting) {
            stopLive();
        } else {
            setTicks([], 'live-deriv');
            startLive(liveSymbol);
        }
    };

    const handleLiveSymbolChange = (newSymbol: string) => {
        setLiveSymbol(newSymbol);
        if (liveState.isConnected || liveState.isConnecting) {
            setTicks([], 'live-deriv');
            startLive(newSymbol);
        }
    };

    const handlePasteAdd = () => {
        stopLive();
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
                <button
                    type='button'
                    className='rng__btn danger'
                    onClick={() => {
                        stopLive();
                        clearTicks();
                    }}
                    disabled={ticks.length === 0}
                >
                    Clear
                </button>
                <div className='rng__ingestion-status'>
                    <span className='rng__stat-label'>loaded</span>
                    <span className='rng__stat-value'>{ticks.length} ticks</span>
                    {source !== 'none' && <span className='rng__source-tag'>{source}</span>}
                </div>
            </div>
            <div className='rng__ingestion-row'>
                <select
                    className='rng__select'
                    value={liveSymbol}
                    onChange={e => handleLiveSymbolChange(e.target.value)}
                    disabled={liveState.isConnecting}
                >
                    {symbol_options.map(s => (
                        <option key={s.symbol} value={s.symbol}>
                            {s.display_name}
                        </option>
                    ))}
                </select>
                <button
                    type='button'
                    className={`rng__btn ${liveState.isConnected ? 'danger' : 'primary'}`}
                    onClick={handleToggleLive}
                    disabled={liveState.isConnecting}
                >
                    {liveState.isConnecting
                        ? 'Connecting…'
                        : liveState.isConnected
                          ? 'Stop Live Feed'
                          : 'Start Live Deriv Ticks'}
                </button>
                {liveState.isConnected && (
                    <div className='rng__ingestion-status'>
                        <span className='rng__live-dot' />
                        <span className='rng__stat-label'>last digit</span>
                        <span className='rng__stat-value'>{liveState.lastDigit ?? '—'}</span>
                        <span className='rng__stat-label'>received</span>
                        <span className='rng__stat-value'>{liveState.tickCount}</span>
                    </div>
                )}
                {liveState.error && <div className='rng__error'>{liveState.error}</div>}
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
