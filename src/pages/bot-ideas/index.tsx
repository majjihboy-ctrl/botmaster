import { FormEvent, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import { LIMITS, STATUSES, TBotIdea, TIdeaDraft, TIdeaStatus, useBotIdeas } from './use-bot-ideas';
import './bot-ideas.scss';

const MIN_STRATEGY_LENGTH = 20;

const EMPTY_DRAFT: TIdeaDraft = { title: '', market: '', strategy: '', status: 'idea' };

const statusLabel = (status: TIdeaStatus) => {
    switch (status) {
        case 'testing':
            return localize('Testing');
        case 'working':
            return localize('Working');
        case 'dropped':
            return localize('Dropped');
        default:
            return localize('New idea');
    }
};

const formatDate = (ts: number) => {
    try {
        return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return '';
    }
};

const BotIdeas = observer(() => {
    const { ideas, addIdea, updateIdea, deleteIdea, storage_ok } = useBotIdeas();
    const [draft, setDraft] = useState<TIdeaDraft>(EMPTY_DRAFT);
    const [editing_id, setEditingId] = useState<string | null>(null);
    const [confirm_delete_id, setConfirmDeleteId] = useState<string | null>(null);
    const [error, setError] = useState('');

    const reset = () => {
        setDraft(EMPTY_DRAFT);
        setEditingId(null);
        setError('');
    };

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        const title = draft.title.trim();
        const strategy = draft.strategy.trim();
        if (!title) return setError(localize('Give your idea a title.'));
        if (strategy.length < MIN_STRATEGY_LENGTH) {
            return setError(localize('Describe the strategy in at least {{min}} characters.', { min: MIN_STRATEGY_LENGTH }));
        }
        const clean = { ...draft, title, strategy, market: draft.market.trim() };
        if (editing_id) updateIdea(editing_id, clean);
        else addIdea(clean);
        reset();
    };

    const startEdit = (idea: TBotIdea) => {
        setEditingId(idea.id);
        setDraft({ title: idea.title, market: idea.market, strategy: idea.strategy, status: idea.status });
        setError('');
    };

    const handleExport = () => {
        const blob = new Blob([JSON.stringify(ideas, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'botmaster-bot-ideas.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className='bot-ideas'>
            <div className='bot-ideas__toolbar'>
                <div>
                    <h2>{localize('Bot Ideas')}</h2>
                    <p>{localize('Your private notebook for strategies you want to build or test.')}</p>
                </div>
                <button
                    type='button'
                    className='bot-ideas__secondary'
                    onClick={handleExport}
                    disabled={!ideas.length}
                    data-testid='dt_bot_ideas_export'
                >
                    {localize('Export JSON')}
                </button>
            </div>

            {!storage_ok && (
                <div className='bot-ideas__notice' role='alert'>
                    {localize('Your browser is blocking storage, so ideas will be lost when you leave this page.')}
                </div>
            )}

            <form className='bot-ideas__form' onSubmit={handleSubmit}>
                <h4>{editing_id ? localize('Edit idea') : localize('Add an idea')}</h4>
                <div className='bot-ideas__row'>
                    <label>
                        <span>{localize('Title')}</span>
                        <input
                            value={draft.title}
                            maxLength={LIMITS.title}
                            onChange={e => setDraft({ ...draft, title: e.target.value })}
                            data-testid='dt_bot_ideas_title'
                        />
                    </label>
                    <label>
                        <span>{localize('Market (optional)')}</span>
                        <input
                            value={draft.market}
                            maxLength={LIMITS.market}
                            placeholder='Volatility 100 (1s)'
                            onChange={e => setDraft({ ...draft, market: e.target.value })}
                        />
                    </label>
                    <label>
                        <span>{localize('Status')}</span>
                        <select
                            value={draft.status}
                            onChange={e => setDraft({ ...draft, status: e.target.value as TIdeaStatus })}
                        >
                            {STATUSES.map(s => (
                                <option key={s} value={s}>
                                    {statusLabel(s)}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <label>
                    <span>{localize('Strategy')}</span>
                    <textarea
                        rows={4}
                        value={draft.strategy}
                        maxLength={LIMITS.strategy}
                        placeholder={localize('When does it enter, what does it trade, how does it manage stake and stop?')}
                        onChange={e => setDraft({ ...draft, strategy: e.target.value })}
                        data-testid='dt_bot_ideas_strategy'
                    />
                </label>
                {error && (
                    <p className='bot-ideas__error' role='alert'>
                        {error}
                    </p>
                )}
                <div className='bot-ideas__actions'>
                    <button type='submit' className='bot-ideas__primary' data-testid='dt_bot_ideas_save'>
                        {editing_id ? localize('Save changes') : localize('Add idea')}
                    </button>
                    {editing_id && (
                        <button type='button' className='bot-ideas__secondary' onClick={reset}>
                            {localize('Cancel')}
                        </button>
                    )}
                </div>
            </form>

            <h4 className='bot-ideas__heading'>
                {localize('Saved ideas')} ({ideas.length})
            </h4>
            {ideas.length === 0 ? (
                <p className='bot-ideas__empty'>{localize('Nothing yet. Your first idea will show up here.')}</p>
            ) : (
                <ul className='bot-ideas__list'>
                    {ideas.map(idea => (
                        <li key={idea.id} className='bot-ideas__card' data-testid={`dt_bot_idea_${idea.id}`}>
                            <div className='bot-ideas__card-head'>
                                <h3>{idea.title}</h3>
                                <span className={`bot-ideas__status bot-ideas__status--${idea.status}`}>
                                    {statusLabel(idea.status)}
                                </span>
                            </div>
                            <p className='bot-ideas__meta'>
                                {idea.market && <span>{idea.market} · </span>}
                                {formatDate(idea.updated_at)}
                            </p>
                            <p className='bot-ideas__strategy'>{idea.strategy}</p>
                            <div className='bot-ideas__actions'>
                                <button type='button' className='bot-ideas__secondary' onClick={() => startEdit(idea)}>
                                    {localize('Edit')}
                                </button>
                                {confirm_delete_id === idea.id ? (
                                    <>
                                        <button
                                            type='button'
                                            className='bot-ideas__danger'
                                            onClick={() => {
                                                deleteIdea(idea.id);
                                                setConfirmDeleteId(null);
                                                if (editing_id === idea.id) reset();
                                            }}
                                        >
                                            {localize('Yes, delete')}
                                        </button>
                                        <button
                                            type='button'
                                            className='bot-ideas__secondary'
                                            onClick={() => setConfirmDeleteId(null)}
                                        >
                                            {localize('Keep')}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type='button'
                                        className='bot-ideas__secondary'
                                        onClick={() => setConfirmDeleteId(idea.id)}
                                    >
                                        {localize('Delete')}
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <p className='bot-ideas__footnote'>
                {localize('Ideas are stored only in this browser. Use Export JSON to keep a copy.')}
            </p>
        </div>
    );
});

export default BotIdeas;
