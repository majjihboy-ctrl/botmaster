import React, { useState } from 'react';
import { localize, Localize } from '@deriv-com/translations';
import './ai-bot-builder.scss';

interface GeneratedBot {
    xml: string;
    strategy?: string;
    params: { symbol: string };
    // Label/value rows to show for the generated bot (built by the server for every strategy).
    summary?: [string, string][];
}

const EXAMPLE_PROMPTS = [
    'Volatility 100 index, 2% growth rate, stop at $20 profit or $15 loss',
    'Rise on Volatility 75, 5 ticks, $2 stake, double after a loss, stop at $30 profit or $20 loss',
    'Even digits on Volatility 10 (1s), $1 stake, x2 martingale',
    'Digit over 3 on Volatility 100, $0.50 stake, stop at $5 profit',
    'Differs 7 on Volatility 50, no martingale',
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
                    <Localize i18n_default_text='Describe the bot you want in plain English. Pick Accumulator, Rise/Fall, Even/Odd, Over/Under or Matches/Differs, with stake, martingale, take profit and stop loss — then download the file and import it into Bot Builder like any other bot.' />
                </p>
            </div>

            <div className='ai-bot-builder__card'>
                <textarea
                    className='ai-bot-builder__textarea'
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={localize('e.g. Even digits on Volatility 10, $1 stake, double after a loss, stop at $20 profit or $10 loss')}
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
                        {(result.summary || []).map(([label, value]) => (
                            <React.Fragment key={label}>
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                            </React.Fragment>
                        ))}
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
