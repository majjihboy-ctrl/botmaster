// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import { observer } from 'mobx-react-lite';
import { FREE_BOTS, TFreeBot } from '@/constants/free-bots';
import { PREMIUM_BOTS } from '@/constants/premium-bots';
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
            <div className='free-bots-tab__main'>
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
                            bot.featured ? (
                                <div key={bot.id} className='free-bots-tab__savior-card'>
                                    <div className='free-bots-tab__savior-glow' />
                                    <div className='free-bots-tab__savior-badge'>⚡ FEATURED</div>
                                    <div className='free-bots-tab__savior-title'>{bot.title}</div>
                                    <div className='free-bots-tab__savior-desc'>{bot.description}</div>
                                    <button
                                        type='button'
                                        className='free-bots-tab__savior-load'
                                        data-testid={`dt_free-bots-tab__load-${bot.id}`}
                                        disabled={loading_id === bot.id}
                                        onClick={() => handleLoad(bot)}
                                    >
                                        {loading_id === bot.id ? localize('Loading...') : localize('⚡ Load Savior Bot')}
                                    </button>
                                </div>
                            ) : (
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
                            )
                        ))}
                    </div>
                )}
            </div>

            <div className='free-bots-tab__sidebar'>
                <div className='free-bots-tab__sidebar-title'>{localize('Premium bots')}</div>
                {PREMIUM_BOTS.map(bot => (
                    <div key={bot.id} className='free-bots-tab__premium-card'>
                        <div className='free-bots-tab__premium-badge'>{localize('PREMIUM')}</div>
                        <div className='free-bots-tab__card-title'>{bot.title}</div>
                        <div className='free-bots-tab__card-description'>{bot.description}</div>
                        <a
                            className='free-bots-tab__premium-cta'
                            href={bot.whatsapp_url}
                            target='_blank'
                            rel='noopener noreferrer'
                            data-testid={`dt_free-bots-tab__premium-${bot.id}`}
                        >
                            {localize('Get access on WhatsApp')}
                        </a>
                    </div>
                ))}
            </div>
        </div>
    );
});

export default FreeBotsTab;
