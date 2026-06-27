// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import { observer } from 'mobx-react-lite';
import { FREE_BOTS, TFreeBot } from '@/constants/free-bots';
import { DBOT_TABS } from '@/constants/bot-contents';
import { NOTIFICATION_TYPE } from '@/components/bot-notification/bot-notification-utils';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './free-bots-tab.scss';

const FreeBotsTab = observer(() => {
    const [loading_id, setLoadingId] = React.useState<string | null>(null);
    const { load_modal, dashboard } = useStore();
    const { loadFreeBotDirect } = load_modal;
    const { setActiveTab, setOpenSettings } = dashboard;

    const handleLoad = async (bot: TFreeBot) => {
        if (loading_id) return;
        setLoadingId(bot.id);
        try {
            await loadFreeBotDirect(bot);
            setActiveTab(DBOT_TABS.BOT_BUILDER);
            setOpenSettings(NOTIFICATION_TYPE.BOT_IMPORT);
        } finally {
            setLoadingId(null);
        }
    };

    return (
        <div className='free-bots-tab'>
            {FREE_BOTS.length === 0 ? (
                <div className='free-bots-tab__empty'>
                    <div className='free-bots-tab__empty-title'>{localize('New bots coming soon')}</div>
                    <div className='free-bots-tab__empty-text'>
                        {localize("We're refreshing this collection — check back shortly.")}
                    </div>
                </div>
            ) : (
                <div className='free-bots-tab__grid'>
                    {FREE_BOTS.map(bot => (
                        <div key={bot.id} className='free-bots-tab__card'>
                            <div className='free-bots-tab__card-title'>{bot.title}</div>
                            <div className='free-bots-tab__card-description'>{bot.description}</div>
                            <button
                                type='button'
                                className='free-bots-tab__card-load'
                                data-testid={`dt_free-bots-tab__load-${bot.id}`}
                                disabled={loading_id === bot.id}
                                onClick={() => handleLoad(bot)}
                            >
                                {loading_id === bot.id ? localize('Loading...') : localize('Load')}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

export default FreeBotsTab;
