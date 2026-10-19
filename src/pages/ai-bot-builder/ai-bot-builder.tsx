import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { NOTIFICATION_TYPE } from '@/components/bot-notification/bot-notification-utils';
import { DBOT_TABS } from '@/constants/bot-contents';
import { getAuthInfo } from '@/external/deriv-core';
import { useStore } from '@/hooks/useStore';
import { localize, Localize } from '@deriv-com/translations';
import './ai-bot-builder.scss';

type TSummaryRow = [string, string];

interface GeneratedBot {
    xml: string;
    strategy: string;
    params: Record<string, unknown> & { symbol: string };
    summary?: TSummaryRow[];
    // Plain-English list of anything the server had to adjust (out-of-range digit, minimum stake, ...).
    notes?: string[];
}

interface Version extends GeneratedBot {
    request: string;
}

const EXAMPLES: { tag: string; text: string }[] = [
    {
        tag: 'Entry search',
        text: 'Over 1 on Volatility 10 (1s). After a loss wait until the last digit is 1 before trading again. x2 martingale, stop at $10 profit or $20 loss',
    },
    {
        tag: 'Recovery',
        text: 'Trade over 2 on Volatility 100 (1s). After a loss trade under 6 then over 4 in turns until I win. $1 stake, x2 martingale',
    },
    {
        tag: 'Two digits',
        text: 'Trade under 7 only when the last 2 digits are both below 4, Volatility 50, $0.50 stake, stop after 5 losses in a row',
    },
    {
        tag: 'Digit stats',
        text: 'Even digits on Volatility 75 only when at least 60% of the last 100 digits are even. Fibonacci stakes, max stake $20',
    },
    {
        tag: 'Indicator',
        text: "Rise on Volatility 100 (1s) when RSI(14) is below 30. 5 ticks, D'Alembert with $0.50 steps, stop at $10 profit or loss",
    },
    { tag: 'Accumulator', text: 'Volatility 100 index, 2% growth rate, stop at $20 profit or $15 loss' },
];

const REFINE_IDEAS = [
    'Lower the stake to $0.50',
    'Stop after 3 losses in a row',
    'Cap the stake at $10',
    'Use the 1s Volatility 75 market',
    'Trade only after a loss',
];

const STAGES = ['Understanding your request', 'Choosing modules', 'Building and checking the bot'];

const SPARKLE = (
    <svg viewBox='0 0 24 24' width='18' height='18' fill='currentColor' aria-hidden='true'>
        <path d='M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zM5 14l.7 2 2 .7-2 .7L5 19.4l-.7-2-2-.7 2-.7L5 14z' />
    </svg>
);

const AiBotBuilder = observer(() => {
    const { load_modal, dashboard } = useStore();
    const [description, setDescription] = useState('');
    const [refinement, setRefinement] = useState('');
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [versions, setVersions] = useState<Version[]>([]);
    const [active, setActive] = useState(0);
    const [copied, setCopied] = useState(false);
    const [loadingBuilder, setLoadingBuilder] = useState(false);
    const resultRef = useRef<HTMLDivElement>(null);

    const result: Version | undefined = versions[active];

    // Cosmetic progress while the request is in flight.
    useEffect(() => {
        if (!loading) return undefined;
        setStage(0);
        const timer = window.setInterval(() => setStage(s => Math.min(s + 1, STAGES.length - 1)), 1600);
        return () => window.clearInterval(timer);
    }, [loading]);

    const request = async (text: string, previous?: GeneratedBot) => {
        if (!text.trim() || loading) return;
        // The server only answers verified, allowed Deriv accounts, so the login token goes with the request.
        const access_token = getAuthInfo()?.access_token;
        if (!access_token) {
            setError(localize('Log in to use the AI Bot Builder.'));
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/generate-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
                body: JSON.stringify({
                    description: text,
                    previous: previous && { strategy: previous.strategy, params: previous.params },
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || localize('Something went wrong generating the bot'));

            const next: Version = { ...data, request: text };
            setVersions(prev => (previous ? [...prev.slice(0, active + 1), next] : [next]));
            setActive(previous ? active + 1 : 0);
            setRefinement('');
            window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        } catch (err) {
            setError((err as Error)?.message || localize('Something went wrong generating the bot'));
        } finally {
            setLoading(false);
        }
    };

    const handleGenerate = () => request(description);
    const handleRefine = () => result && request(refinement, result);

    const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            action();
        }
    };

    const handleDownload = () => {
        if (!result) return;
        const url = URL.createObjectURL(new Blob([result.xml], { type: 'application/xml' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-bot-${result.params.symbol}-${Date.now()}.xml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const handleCopy = async () => {
        if (!result) return;
        try {
            await navigator.clipboard.writeText(result.xml);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            setError(localize('Could not copy. Use Download instead.'));
        }
    };

    const handleLoadInBuilder = async () => {
        if (!result || loadingBuilder) return;
        setLoadingBuilder(true);
        try {
            const title = `${result.summary?.[0]?.[1] ?? 'AI bot'} · AI`;
            await load_modal.loadGeneratedBot(result.xml, title);
            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            dashboard.setOpenSettings(NOTIFICATION_TYPE.BOT_IMPORT);
        } catch {
            setError(localize('Could not load the bot into Bot Builder. Download the file and import it instead.'));
        } finally {
            setLoadingBuilder(false);
        }
    };

    const strategyLabel = result?.summary?.find(([k]) => k === 'Strategy')?.[1] ?? '';
    const tiles = (result?.summary ?? []).filter(([k]) => k !== 'Strategy' && k !== 'Symbol');

    return (
        <div className='ai-bot-builder'>
            <div className='ai-bot-builder__inner'>
                <header className='ai-bot-builder__hero'>
                    <span className='ai-bot-builder__badge'>
                        {SPARKLE}
                        <Localize i18n_default_text='AI Bot Builder' />
                    </span>
                    <h1 className='ai-bot-builder__title'>
                        <Localize i18n_default_text='Describe a bot. Get one that loads and runs.' />
                    </h1>
                    <p className='ai-bot-builder__subtitle'>
                        <Localize i18n_default_text='Entry filters, recovery contracts, stake systems and risk stops. The AI only picks the settings; every bot is built from tested blocks and checked before you see it.' />
                    </p>
                    <ul className='ai-bot-builder__capabilities'>
                        {['Entry filters', 'Recovery legs', 'Stake systems', 'Risk stops'].map(c => (
                            <li key={c}>{localize(c)}</li>
                        ))}
                    </ul>
                </header>

                <section className='ai-bot-builder__composer' aria-label={localize('Describe your bot')}>
                    <label className='ai-bot-builder__label' htmlFor='ai-bot-description'>
                        <Localize i18n_default_text='What should the bot do?' />
                    </label>
                    <textarea
                        id='ai-bot-description'
                        className='ai-bot-builder__textarea'
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        onKeyDown={e => handleKeyDown(e, handleGenerate)}
                        placeholder={localize(
                            'e.g. Over 1 on Volatility 10 (1s). After a loss wait until the last digit is 1, x2 martingale, stop at $10 profit or $20 loss'
                        )}
                        rows={4}
                        maxLength={2000}
                    />
                    <div className='ai-bot-builder__composer-bar'>
                        <span className='ai-bot-builder__hint'>
                            {description.length}/2000 · <Localize i18n_default_text='Ctrl/⌘ + Enter to generate' />
                        </span>
                        <button
                            type='button'
                            className='ai-bot-builder__primary'
                            disabled={loading || !description.trim()}
                            onClick={handleGenerate}
                        >
                            {loading ? (
                                <>
                                    <span className='ai-bot-builder__spinner' aria-hidden='true' />
                                    <Localize i18n_default_text='Building…' />
                                </>
                            ) : (
                                <>
                                    {SPARKLE}
                                    <Localize i18n_default_text='Generate bot' />
                                </>
                            )}
                        </button>
                    </div>

                    <div className='ai-bot-builder__examples' role='list' aria-label={localize('Examples')}>
                        {EXAMPLES.map(example => (
                            <button
                                key={example.text}
                                type='button'
                                role='listitem'
                                className='ai-bot-builder__example'
                                onClick={() => setDescription(example.text)}
                            >
                                <span className='ai-bot-builder__example-tag'>{localize(example.tag)}</span>
                                <span className='ai-bot-builder__example-text'>{example.text}</span>
                            </button>
                        ))}
                    </div>
                </section>

                {loading && (
                    <section className='ai-bot-builder__progress' aria-live='polite'>
                        {STAGES.map((label, i) => (
                            <div
                                key={label}
                                className={`ai-bot-builder__step${i < stage ? ' is-done' : ''}${i === stage ? ' is-active' : ''}`}
                            >
                                <span className='ai-bot-builder__step-dot' />
                                {localize(label)}
                            </div>
                        ))}
                        <div className='ai-bot-builder__skeleton' />
                    </section>
                )}

                {error && !loading && (
                    <div className='ai-bot-builder__error' role='alert'>
                        <strong>
                            <Localize i18n_default_text='That did not work' />
                        </strong>
                        <span>{error}</span>
                    </div>
                )}

                {result && !loading && (
                    <section className='ai-bot-builder__result' ref={resultRef}>
                        <div className='ai-bot-builder__result-head'>
                            <div>
                                <span className='ai-bot-builder__eyebrow'>
                                    <Localize i18n_default_text='Your bot' />
                                </span>
                                <h2 className='ai-bot-builder__result-title'>{strategyLabel}</h2>
                            </div>
                            <div className='ai-bot-builder__pills'>
                                <span className='ai-bot-builder__pill'>{result.params.symbol}</span>
                                <span className='ai-bot-builder__pill ai-bot-builder__pill--ok'>
                                    ✓ <Localize i18n_default_text='Structure checked' />
                                </span>
                            </div>
                        </div>

                        {versions.length > 1 && (
                            <div className='ai-bot-builder__versions' role='tablist' aria-label={localize('Versions')}>
                                {versions.map((v, i) => (
                                    <button
                                        key={`${v.request}-${i}`}
                                        type='button'
                                        role='tab'
                                        aria-selected={i === active}
                                        className={`ai-bot-builder__version${i === active ? ' is-active' : ''}`}
                                        title={v.request}
                                        onClick={() => setActive(i)}
                                    >
                                        v{i + 1}
                                    </button>
                                ))}
                            </div>
                        )}

                        <dl className='ai-bot-builder__tiles'>
                            {tiles.map(([label, value]) => (
                                <div key={label} className='ai-bot-builder__tile'>
                                    <dt>{localize(label)}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                        </dl>

                        {!!result.notes?.length && (
                            <div className='ai-bot-builder__notes'>
                                <strong>
                                    <Localize i18n_default_text='Adjusted for you' />
                                </strong>
                                <ul>
                                    {result.notes.map(n => (
                                        <li key={n}>{n}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className='ai-bot-builder__actions'>
                            <button
                                type='button'
                                className='ai-bot-builder__primary'
                                disabled={loadingBuilder}
                                onClick={handleLoadInBuilder}
                            >
                                {loadingBuilder ? (
                                    <span className='ai-bot-builder__spinner' aria-hidden='true' />
                                ) : null}
                                <Localize i18n_default_text='Load into Bot Builder' />
                            </button>
                            <button type='button' className='ai-bot-builder__secondary' onClick={handleDownload}>
                                <Localize i18n_default_text='Download XML' />
                            </button>
                            <button type='button' className='ai-bot-builder__secondary' onClick={handleCopy}>
                                {copied ? (
                                    <Localize i18n_default_text='Copied' />
                                ) : (
                                    <Localize i18n_default_text='Copy XML' />
                                )}
                            </button>
                        </div>

                        <div className='ai-bot-builder__refine'>
                            <label className='ai-bot-builder__label' htmlFor='ai-bot-refine'>
                                <Localize i18n_default_text='Tweak it' />
                            </label>
                            <div className='ai-bot-builder__refine-row'>
                                <input
                                    id='ai-bot-refine'
                                    className='ai-bot-builder__input'
                                    value={refinement}
                                    onChange={e => setRefinement(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleRefine();
                                        }
                                    }}
                                    placeholder={localize('e.g. lower the stake and stop after 3 losses in a row')}
                                    maxLength={500}
                                />
                                <button
                                    type='button'
                                    className='ai-bot-builder__secondary'
                                    disabled={!refinement.trim()}
                                    onClick={handleRefine}
                                >
                                    <Localize i18n_default_text='Apply' />
                                </button>
                            </div>
                            <div className='ai-bot-builder__chips'>
                                {REFINE_IDEAS.map(idea => (
                                    <button
                                        key={idea}
                                        type='button'
                                        className='ai-bot-builder__chip'
                                        onClick={() => setRefinement(idea)}
                                    >
                                        {localize(idea)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <p className='ai-bot-builder__note'>
                            <Localize i18n_default_text='Nothing trades automatically. Review the bot in Bot Builder and press Run yourself. No strategy is guaranteed to be profitable.' />
                        </p>
                    </section>
                )}
            </div>
        </div>
    );
});

export default AiBotBuilder;
