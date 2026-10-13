import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FREE_BOTS, TFreeBot } from '@/constants/free-bots';
import { localize } from '@deriv-com/translations';
import { readRecentBotIds, useLoadBot } from './use-load-bot';
import './best-bots.scss';

type TCardProps = {
    bot: TFreeBot;
    loading: boolean;
    disabled: boolean;
    onLoad: (bot: TFreeBot) => void;
};

const BotCard = ({ bot, loading, disabled, onLoad }: TCardProps) => (
    <div className={`best-bots__card${bot.golden ? ' best-bots__card--top' : ''}`}>
        {bot.golden && <span className='best-bots__badge'>{localize('TOP PICK')}</span>}
        <h3 className='best-bots__card-title'>{bot.title}</h3>
        <p className='best-bots__card-desc'>
            {bot.description || localize('Ready-made strategy. Load it, review the settings, then run.')}
        </p>
        <button
            type='button'
            className='best-bots__load'
            disabled={disabled}
            onClick={() => onLoad(bot)}
            data-testid={`dt_best_bots_load_${bot.id}`}
        >
            {loading ? localize('Loading...') : bot.auto_run ? localize('Load & Run') : localize('Load')}
        </button>
    </div>
);

const BestBots = observer(() => {
    const { loadBot, loading_id } = useLoadBot();
    const [query, setQuery] = useState('');
    const [recent_ids, setRecentIds] = useState<string[]>(readRecentBotIds);

    const handleLoad = async (bot: TFreeBot) => {
        setRecentIds(await loadBot(bot));
    };

    const q = query.trim().toLowerCase();
    const matches = useMemo(
        () =>
            FREE_BOTS.filter(
                bot => !q || bot.title.toLowerCase().includes(q) || bot.description.toLowerCase().includes(q)
            ),
        [q]
    );
    const top_picks = matches.filter(bot => bot.golden);
    const recent = recent_ids
        .map(id => FREE_BOTS.find(bot => bot.id === id))
        .filter((bot): bot is TFreeBot => Boolean(bot) && (!q || matches.includes(bot as TFreeBot)));
    const rest = matches.filter(bot => !bot.golden);

    const renderGrid = (list: TFreeBot[]) => (
        <div className='best-bots__grid'>
            {list.map(bot => (
                <BotCard
                    key={bot.id}
                    bot={bot}
                    loading={loading_id === bot.id}
                    disabled={Boolean(loading_id)}
                    onLoad={handleLoad}
                />
            ))}
        </div>
    );

    return (
        <div className='best-bots'>
            <div className='best-bots__toolbar'>
                <div>
                    <h2>{localize('Best Bots')}</h2>
                    <p>{localize('Hand-picked strategies you can load into Bot Builder in one click.')}</p>
                </div>
                <input
                    type='search'
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={localize('Search bots')}
                    aria-label={localize('Search bots')}
                    data-testid='dt_best_bots_search'
                />
            </div>

            {top_picks.length > 0 && (
                <section>
                    <h4 className='best-bots__heading'>{localize('Top picks')}</h4>
                    {renderGrid(top_picks)}
                </section>
            )}

            {recent.length > 0 && (
                <section>
                    <h4 className='best-bots__heading'>{localize('Recently used on this device')}</h4>
                    {renderGrid(recent)}
                </section>
            )}

            {rest.length > 0 && (
                <section>
                    <h4 className='best-bots__heading'>{localize('All bots')}</h4>
                    {renderGrid(rest)}
                </section>
            )}

            {matches.length === 0 && (
                <p className='best-bots__empty'>{localize('No bots match your search.')}</p>
            )}

            <p className='best-bots__footnote'>
                {localize('Bots trade real money on live accounts. Test on a demo account first.')}
            </p>
        </div>
    );
});

export default BestBots;
