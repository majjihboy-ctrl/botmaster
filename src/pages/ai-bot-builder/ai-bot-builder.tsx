import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { NOTIFICATION_TYPE } from '@/components/bot-notification/bot-notification-utils';
import { DBOT_TABS } from '@/constants/bot-contents';
import { getAuthInfo } from '@/external/deriv-core';
import { useStore } from '@/hooks/useStore';
import { localize, Localize } from '@deriv-com/translations';
import { checkBotXml, looksLikeBotXml, splitSegments } from './chat-utils';
import './ai-bot-builder.scss';

type TMessage = { role: 'user' | 'assistant'; content: string; error?: boolean };

const STORAGE_KEY = 'botmaster_ai_chat_v1';
const MAX_STORED = 40;

const loadStored = (): TMessage[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed)
            ? parsed.filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
            : [];
    } catch {
        return [];
    }
};

// **bold** and `code` inside a line of text.
const renderInline = (text: string) =>
    text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
            return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
            return <code key={i}>{part.slice(1, -1)}</code>;
        return <React.Fragment key={i}>{part}</React.Fragment>;
    });

// Paragraphs, bullet / numbered lists and headings. Everything else is plain text.
const renderProse = (text: string) =>
    text
        .trim()
        .split(/\n{2,}/)
        .map((block, i) => {
            const lines = block.split('\n');
            if (lines.every(l => /^\s*[-*•]\s+/.test(l))) {
                return (
                    <ul key={i}>
                        {lines.map((l, j) => (
                            <li key={j}>{renderInline(l.replace(/^\s*[-*•]\s+/, ''))}</li>
                        ))}
                    </ul>
                );
            }
            if (lines.every(l => /^\s*\d+[.)]\s+/.test(l))) {
                return (
                    <ol key={i}>
                        {lines.map((l, j) => (
                            <li key={j}>{renderInline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>
                        ))}
                    </ol>
                );
            }
            if (/^#{1,4}\s+/.test(lines[0])) {
                return <h4 key={i}>{renderInline(lines[0].replace(/^#{1,4}\s+/, ''))}</h4>;
            }
            return (
                <p key={i}>
                    {lines.map((l, j) => (
                        <React.Fragment key={j}>
                            {j > 0 && <br />}
                            {renderInline(l)}
                        </React.Fragment>
                    ))}
                </p>
            );
        });

const AiBotBuilder = observer(() => {
    const { load_modal, dashboard } = useStore();
    const [messages, setMessages] = useState<TMessage[]>(loadStored);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED)));
        } catch {
            // storage unavailable
        }
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages, sending]);

    // Grow the textarea with its content (up to a limit).
    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    }, [input]);

    const ask = async (history: TMessage[]) => {
        const access_token = getAuthInfo()?.access_token;
        if (!access_token) {
            setMessages([
                ...history,
                { role: 'assistant', content: localize('Log in to use the AI assistant.'), error: true },
            ]);
            return;
        }
        setSending(true);
        try {
            const res = await fetch('/api/ai-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
                body: JSON.stringify({
                    messages: history.filter(m => !m.error).map(({ role, content }) => ({ role, content })),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.reply) throw new Error(data?.error || localize('The AI request failed'));
            setMessages([...history, { role: 'assistant', content: data.reply }]);
        } catch (err) {
            setMessages([...history, { role: 'assistant', content: (err as Error).message, error: true }]);
        } finally {
            setSending(false);
            inputRef.current?.focus();
        }
    };

    const send = () => {
        const text = input.trim();
        if (!text || sending) return;
        setInput('');
        setNotice(null);
        ask([...messages, { role: 'user', content: text }]);
    };

    const retry = () => {
        if (sending) return;
        const history = messages.filter(m => !m.error);
        if (history.length && history[history.length - 1].role === 'user') {
            setMessages(history);
            ask(history);
        }
    };

    const clear = () => {
        if (sending) return;
        setMessages([]);
        setNotice(null);
    };

    const copy = async (key: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            window.setTimeout(() => setCopied(c => (c === key ? null : c)), 1500);
        } catch {
            setNotice(localize('Could not copy to the clipboard.'));
        }
    };

    const download = (xml: string) => {
        const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-bot-${Date.now()}.xml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const loadInBuilder = async (xml: string) => {
        const problem = checkBotXml(xml);
        if (problem) {
            setNotice(problem);
            return;
        }
        try {
            await load_modal.loadGeneratedBot(xml, 'AI bot');
            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            dashboard.setOpenSettings(NOTIFICATION_TYPE.BOT_IMPORT);
        } catch {
            setNotice(localize('Bot Builder could not load this XML. Download it, or ask the AI to fix it.'));
        }
    };

    return (
        <div className='ai-chat'>
            <div className='ai-chat__bar'>
                <span className='ai-chat__title'>
                    <Localize i18n_default_text='AI assistant' />
                </span>
                <button type='button' className='ai-chat__link' onClick={clear} disabled={!messages.length || sending}>
                    <Localize i18n_default_text='Clear chat' />
                </button>
            </div>

            <div className='ai-chat__scroll'>
                <div className='ai-chat__thread'>
                    {messages.length === 0 && (
                        <p className='ai-chat__empty'>
                            <Localize i18n_default_text='Ask me anything: trading, Deriv contracts, bot logic, code. I can also write a bot and load it into Bot Builder.' />
                        </p>
                    )}

                    {messages.map((m, i) => (
                        <div key={i} className={`ai-chat__msg ai-chat__msg--${m.role}${m.error ? ' is-error' : ''}`}>
                            {m.role === 'user' || m.error ? (
                                <div className='ai-chat__bubble'>
                                    {m.content.split('\n').map((line, j) => (
                                        <React.Fragment key={j}>
                                            {j > 0 && <br />}
                                            {line}
                                        </React.Fragment>
                                    ))}
                                    {m.error && i === messages.length - 1 && (
                                        <button type='button' className='ai-chat__link' onClick={retry}>
                                            <Localize i18n_default_text='Try again' />
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className='ai-chat__bubble'>
                                    {splitSegments(m.content).map((seg, j) =>
                                        seg.type === 'text' ? (
                                            <React.Fragment key={j}>{renderProse(seg.text)}</React.Fragment>
                                        ) : (
                                            <div key={j} className='ai-chat__code'>
                                                <div className='ai-chat__code-bar'>
                                                    <span>{seg.lang || 'code'}</span>
                                                    <span className='ai-chat__code-actions'>
                                                        {looksLikeBotXml(seg.code, seg.lang) && (
                                                            <>
                                                                <button
                                                                    type='button'
                                                                    onClick={() => loadInBuilder(seg.code)}
                                                                >
                                                                    <Localize i18n_default_text='Load into Bot Builder' />
                                                                </button>
                                                                <button
                                                                    type='button'
                                                                    onClick={() => download(seg.code)}
                                                                >
                                                                    <Localize i18n_default_text='Download' />
                                                                </button>
                                                            </>
                                                        )}
                                                        <button
                                                            type='button'
                                                            onClick={() => copy(`${i}-${j}`, seg.code)}
                                                        >
                                                            {copied === `${i}-${j}` ? (
                                                                <Localize i18n_default_text='Copied' />
                                                            ) : (
                                                                <Localize i18n_default_text='Copy' />
                                                            )}
                                                        </button>
                                                    </span>
                                                </div>
                                                <pre>
                                                    <code>{seg.code}</code>
                                                </pre>
                                            </div>
                                        )
                                    )}
                                    <div className='ai-chat__msg-actions'>
                                        <button
                                            type='button'
                                            className='ai-chat__link'
                                            onClick={() => copy(`m${i}`, m.content)}
                                        >
                                            {copied === `m${i}` ? (
                                                <Localize i18n_default_text='Copied' />
                                            ) : (
                                                <Localize i18n_default_text='Copy reply' />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}

                    {sending && (
                        <div className='ai-chat__msg ai-chat__msg--assistant' aria-live='polite'>
                            <div className='ai-chat__bubble ai-chat__typing' aria-label={localize('Thinking')}>
                                <span />
                                <span />
                                <span />
                            </div>
                        </div>
                    )}
                    <div ref={endRef} />
                </div>
            </div>

            {notice && (
                <div className='ai-chat__notice' role='alert'>
                    {notice}
                    <button type='button' className='ai-chat__link' onClick={() => setNotice(null)}>
                        ×
                    </button>
                </div>
            )}

            <div className='ai-chat__composer'>
                <textarea
                    ref={inputRef}
                    className='ai-chat__input'
                    rows={1}
                    value={input}
                    maxLength={8000}
                    placeholder={localize('Message the AI…')}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            send();
                        }
                    }}
                />
                <button
                    type='button'
                    className='ai-chat__send'
                    onClick={send}
                    disabled={sending || !input.trim()}
                    aria-label={localize('Send')}
                >
                    <svg viewBox='0 0 24 24' width='20' height='20' fill='currentColor' aria-hidden='true'>
                        <path d='M3.4 20.4l17.5-7.5a1 1 0 000-1.8L3.4 3.6a1 1 0 00-1.4 1.2L4 11l9 1-9 1-2 6.2a1 1 0 001.4 1.2z' />
                    </svg>
                </button>
            </div>
        </div>
    );
});

export default AiBotBuilder;
