import React, { useCallback, useRef, useState } from 'react';
import { useTickData } from './tick-data-context';

const SEQUENCE_LENGTH = 10;
const EPOCHS = 15;

type TEpochLog = { epoch: number; loss: number; acc: number };
type TPrediction = { digit: number; confidence: number; patternDetected: boolean; probabilities: number[] };

const LSTMPredictor: React.FC = () => {
    const { ticks } = useTickData();
    const [isTraining, setIsTraining] = useState(false);
    const [progress, setProgress] = useState(0);
    const [epochLogs, setEpochLogs] = useState<TEpochLog[]>([]);
    const [prediction, setPrediction] = useState<TPrediction | null>(null);
    const [error, setError] = useState<string | null>(null);
    const cancelRef = useRef(false);

    const minRequired = SEQUENCE_LENGTH + 1;

    const handleTrain = useCallback(async () => {
        setError(null);
        setPrediction(null);
        setEpochLogs([]);
        setProgress(0);

        if (ticks.length < minRequired) {
            setError(`Need at least ${minRequired} ticks to build one training window (currently have ${ticks.length}).`);
            return;
        }

        setIsTraining(true);
        cancelRef.current = false;

        // Lazy-loaded: tfjs is a heavy dependency, only pull it into the
        // bundle when someone actually opens this module.
        const tf = await import('@tensorflow/tfjs');

        let model: import('@tensorflow/tfjs').Sequential | null = null;
        let xs: import('@tensorflow/tfjs').Tensor | null = null;
        let ys: import('@tensorflow/tfjs').Tensor | null = null;
        let inputTensor: import('@tensorflow/tfjs').Tensor | null = null;
        let outputTensor: import('@tensorflow/tfjs').Tensor | null = null;

        try {
            // --- Data prep: sliding windows of size SEQUENCE_LENGTH ---
            const windows: number[][] = [];
            const targets: number[] = [];
            for (let i = 0; i + SEQUENCE_LENGTH < ticks.length; i++) {
                windows.push(ticks.slice(i, i + SEQUENCE_LENGTH));
                targets.push(ticks[i + SEQUENCE_LENGTH]);
            }

            if (windows.length < 8) {
                setError(
                    `Only ${windows.length} training windows available — need more tick data for a meaningful training run.`
                );
                setIsTraining(false);
                return;
            }

            // Normalize inputs to [0,1], one-hot encode targets (10 classes).
            // tf.tensor3d wants either nested [][][], or a flat array plus an
            // explicit shape — flat is used here to keep the TS types simple.
            const flatInputs = windows.flat().map(d => d / 9);
            xs = tf.tensor3d(flatInputs, [windows.length, SEQUENCE_LENGTH, 1]);
            ys = tf.oneHot(tf.tensor1d(targets, 'int32'), 10);

            // --- Model ---
            model = tf.sequential();
            model.add(
                tf.layers.lstm({ units: 64, returnSequences: true, inputShape: [SEQUENCE_LENGTH, 1] })
            );
            model.add(tf.layers.dropout({ rate: 0.2 }));
            model.add(tf.layers.lstm({ units: 32 }));
            model.add(tf.layers.dense({ units: 10, activation: 'softmax' }));
            model.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

            await model.fit(xs, ys, {
                epochs: EPOCHS,
                batchSize: 32,
                shuffle: true,
                callbacks: {
                    onEpochEnd: async (epoch, logs) => {
                        if (cancelRef.current) return;
                        setProgress(Math.round(((epoch + 1) / EPOCHS) * 100));
                        setEpochLogs(prev => [
                            ...prev,
                            { epoch: epoch + 1, loss: logs?.loss ?? 0, acc: (logs as Record<string, number>)?.acc ?? 0 },
                        ]);
                        // Yield to the browser so the progress bar actually paints between epochs.
                        await new Promise(resolve => setTimeout(resolve, 0));
                    },
                },
            });

            if (cancelRef.current) return;

            // --- Predict on the most recent window ---
            const lastWindow = ticks.slice(-SEQUENCE_LENGTH).map(d => d / 9);
            inputTensor = tf.tensor3d(lastWindow, [1, SEQUENCE_LENGTH, 1]);
            outputTensor = model.predict(inputTensor) as import('@tensorflow/tfjs').Tensor;
            const probabilities = Array.from(await outputTensor.data());

            let maxProb = -1;
            let maxDigit = 0;
            probabilities.forEach((p, digit) => {
                if (p > maxProb) {
                    maxProb = p;
                    maxDigit = digit;
                }
            });

            setPrediction({
                digit: maxDigit,
                confidence: maxProb,
                patternDetected: maxProb > 0.12,
                probabilities,
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Training failed — see console for details.');
            // eslint-disable-next-line no-console
            console.error('[RNG Analyzer] LSTM training error:', e);
        } finally {
            // Always dispose tensors/model — tfjs does not garbage-collect
            // GPU/WASM-backed memory on its own.
            xs?.dispose();
            ys?.dispose();
            inputTensor?.dispose();
            outputTensor?.dispose();
            model?.dispose();
            setIsTraining(false);
        }
    }, [ticks, minRequired]);

    return (
        <div className='rng__module'>
            <div className='rng__panel'>
                <div className='rng__panel-header'>
                    <h3>LSTM Neural Network</h3>
                </div>
                <p className='rng__panel-desc'>
                    Trains a 2-layer LSTM ({SEQUENCE_LENGTH}-step windows, {EPOCHS} epochs) to look for non-linear
                    patterns. On genuinely random data, there is nothing to learn &mdash; a reported &quot;confidence&quot; here
                    is not proof of a pattern; it&apos;s the softmax output for whichever digit the model landed on.
                    Treat this as an exploratory signal, not a trading input.
                </p>

                {ticks.length < minRequired && (
                    <div className='rng__error'>
                        Need at least {minRequired} ticks loaded (currently {ticks.length}).
                    </div>
                )}

                <button type='button' className='rng__btn primary' onClick={handleTrain} disabled={isTraining}>
                    {isTraining ? 'Training…' : 'Train & Predict'}
                </button>

                {isTraining && (
                    <div className='rng__progress-wrap'>
                        <div className='rng__progress-bar'>
                            <div className='rng__progress-fill' style={{ width: `${progress}%` }} />
                        </div>
                        <span className='rng__progress-label'>{progress}%</span>
                    </div>
                )}

                {epochLogs.length > 0 && (
                    <div className='rng__log rng__log--scroll'>
                        {epochLogs.map(l => (
                            <div className='rng__log-line' key={l.epoch}>
                                epoch {l.epoch}/{EPOCHS} — loss: {l.loss.toFixed(4)}
                                {typeof l.acc === 'number' ? ` — acc: ${(l.acc * 100).toFixed(1)}%` : ''}
                            </div>
                        ))}
                    </div>
                )}

                {error && <div className='rng__error'>{error}</div>}
            </div>

            {prediction && (
                <div className='rng__panel'>
                    <div className='rng__panel-header'>
                        <h3>Prediction</h3>
                        <span className={`rng__badge ${prediction.patternDetected ? 'fail' : 'pass'}`}>
                            {prediction.patternDetected ? 'PATTERN DETECTED' : 'No significant pattern'}
                        </span>
                    </div>
                    <div className='rng__glow-grid'>
                        <div className='rng__glow-card'>
                            <span className='rng__glow-label'>predicted digit</span>
                            <span className='rng__glow-value'>{prediction.digit}</span>
                        </div>
                        <div className='rng__glow-card'>
                            <span className='rng__glow-label'>confidence</span>
                            <span className='rng__glow-value'>{(prediction.confidence * 100).toFixed(1)}%</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LSTMPredictor;
