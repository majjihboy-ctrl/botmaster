import React, { useState } from 'react';
import { localize, Localize } from '@deriv-com/translations';
import './ai-bot-builder.scss';

interface GeneratedBot {
    xml: string;
    params: {
        symbol: string;
        growth_rate: string;
        take_profit: number;
        initial_stake: number;
        martingale_size: number;
        profit_threshold: number;
        loss_threshold: number;
    };
}

const EXAMPLE_PROMPTS = [
    'Volatility 100 index, 2% growth rate, stop at $20 profit or $15 loss',
    'Conservative bot on Volatility 25, small $5 stake, take profit at $8',
    'Aggressive Volatility 75 bot, 3% growth, $15 starting stake',
];

const AiBotBuilder = () => {
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<GeneratedBot | null>(null);

    const handleGenerate = async () => {
        if (!description.trim()) return;
        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const res = await fetch('/api/generate-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description }),
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data?.error || localize('Something went wrong generating the bot'));
            }
            setResult(data);
        } catch (err: any) {
            setError(err?.message || localize('Something went wrong generating the bot'));
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = () => {
        if (!result) return;
        const blob = new Blob([result.xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-bot-${result.params.symbol}-${Date.now()}.xml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    return (
        <div className='ai-bot-builder'>
            <div className='ai-bot-builder__header'>
                <h1 className='ai-bot-builder__title'>
                    <span className='ai-bot-builder__title-icon'>✨</span>
                    <Localize i18n_default_text='AI Bot Builder' />
                </h1>
                <p className='ai-bot-builder__subtitle'>
                    <Localize i18n_default_text='Describe the bot you want in plain English. This generates an Accumulator Martingale strategy — download the file and import it into Bot Builder like any other bot.' />
                </p>
            </div>

            <div className='ai-bot-builder__card'>
                <textarea
                    className='ai-bot-builder__textarea'
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={localize('e.g. Volatility 100 index, 2% growth rate, stop at $20 profit or $15 loss')}
                    rows={4}
                    maxLength={2000}
                />

                <div className='ai-bot-builder__examples'>
                    {EXAMPLE_PROMPTS.map(prompt => (
                        <button
                            key={prompt}
                            type='button'
                            className='ai-bot-builder__example-chip'
                            onClick={() => setDescription(prompt)}
                        >
                            {prompt}
                        </button>
                    ))}
                </div>

                <button
                    type='button'
                    className='ai-bot-builder__generate-btn'
                    disabled={loading || !description.trim()}
                    onClick={handleGenerate}
                >
                    {loading ? <Localize i18n_default_text='Generating...' /> : <Localize i18n_default_text='Generate bot' />}
                </button>
            </div>

            {error && (
                <div className='ai-bot-builder__error'>
                    <span>{error}</span>
                </div>
            )}

            {result && (
                <div className='ai-bot-builder__card ai-bot-builder__result'>
                    <h2 className='ai-bot-builder__result-title'>
                        <Localize i18n_default_text='Bot ready' />
                    </h2>
                    <dl className='ai-bot-builder__params'>
                        <dt><Localize i18n_default_text='Symbol' /></dt>
                        <dd>{result.params.symbol}</dd>
                        <dt><Localize i18n_default_text='Growth rate' /></dt>
                        <dd>{Number(result.params.growth_rate) * 100}%</dd>
                        <dt><Localize i18n_default_text='Initial stake' /></dt>
                        <dd>${result.params.initial_stake}</dd>
                        <dt><Localize i18n_default_text='Stake step' /></dt>
                        <dd>${result.params.martingale_size}</dd>
                        <dt><Localize i18n_default_text='Take profit' /></dt>
                        <dd>${result.params.take_profit}</dd>
                        <dt><Localize i18n_default_text='Stop at profit' /></dt>
                        <dd>${result.params.profit_threshold}</dd>
                        <dt><Localize i18n_default_text='Stop at loss' /></dt>
                        <dd>${result.params.loss_threshold}</dd>
                    </dl>

                    <button type='button' className='ai-bot-builder__download-btn' onClick={handleDownload}>
                        <Localize i18n_default_text='Download bot XML' />
                    </button>

                    <p className='ai-bot-builder__note'>
                        <Localize i18n_default_text='Import this in Bot Builder using the same "Load" flow you use for any other bot file. Nothing runs or trades automatically — you still confirm and run it yourself.' />
                    </p>
                </div>
            )}
        </div>
    );
};

export default AiBotBuilder;
