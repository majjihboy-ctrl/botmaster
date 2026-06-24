// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import { observer } from 'mobx-react-lite';
import { FREE_BOTS } from '@/constants/free-bots';
import { useStore } from '@/hooks/useStore';
import { LegacyClose1pxIcon } from '@deriv/quill-icons/Legacy';
import { useDevice } from '@deriv-com/ui';
import FreeBotsFooter from './free-bots-footer';
import WorkspaceControl from './workspace-control';

const FreeBots = observer(() => {
    const { load_modal, blockly_store } = useStore();
    const { selected_free_bot, setSelectedFreeBot, loadFreeBotPreview } = load_modal;
    const { is_loading } = blockly_store;
    const { isDesktop } = useDevice();

    if (selected_free_bot) {
        return (
            <div className='load-strategy__container load-strategy__container--has-footer'>
                <div className='load-strategy__local-preview load-strategy__local-preview--active'>
                    <div className='load-strategy__title'>{selected_free_bot.title}</div>
                    <div className='load-strategy__preview-workspace'>
                        <div id='load-strategy__blockly-container' style={{ height: '100%' }}>
                            <div className='load-strategy__local-preview-close'>
                                <LegacyClose1pxIcon
                                    onClick={() => setSelectedFreeBot(null)}
                                    data-testid='dt_free-bots__preview-close'
                                    height='20px'
                                    width='20px'
                                />
                            </div>
                            <WorkspaceControl />
                        </div>
                    </div>
                </div>
                {!isDesktop && (
                    <div className='load-strategy__local-footer'>
                        <FreeBotsFooter />
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className='load-strategy__container'>
            <div className='load-strategy__free-bots-grid'>
                {FREE_BOTS.map(bot => (
                    <button
                        key={bot.id}
                        type='button'
                        className='load-strategy__free-bots-card'
                        data-testid={`dt_free-bots__card-${bot.id}`}
                        disabled={is_loading}
                        onClick={() => loadFreeBotPreview(bot)}
                    >
                        <div className='load-strategy__free-bots-card-title'>{bot.title}</div>
                        <div className='load-strategy__free-bots-card-description'>{bot.description}</div>
                    </button>
                ))}
            </div>
        </div>
    );
});

export default FreeBots;
