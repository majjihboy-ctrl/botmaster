// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import { observer } from 'mobx-react-lite';
import { FREE_BOTS, TFreeBot } from '@/constants/free-bots';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { useDevice } from '@deriv-com/ui';
import './free-bots-tab.scss';

const FreeBotsTab = observer(() => {
    const { load_modal, dashboard } = useStore();
    const { toggleLoadModal, setActiveTabIndex, loadFreeBotPreview } = load_modal;
    const { setActiveTab } = dashboard;
    const { isDesktop } = useDevice();

    const openFreeBot = (bot: TFreeBot) => {
        const free_bots_tab_index = isDesktop ? 3 : 2;
        toggleLoadModal();
        setActiveTabIndex(free_bots_tab_index);
        loadFreeBotPreview(bot);
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    return (
        <div className='free-bots-tab'>
            <div className='free-bots-tab__grid'>
                {FREE_BOTS.map(bot => (
                    <button
                        key={bot.id}
                        type='button'
                        className='free-bots-tab__card'
                        data-testid={`dt_free-bots-tab__card-${bot.id}`}
                        onClick={() => openFreeBot(bot)}
                    >
                        <div className='free-bots-tab__card-title'>{bot.title}</div>
                        <div className='free-bots-tab__card-description'>{bot.description}</div>
                    </button>
                ))}
            </div>
        </div>
    );
});

export default FreeBotsTab;
