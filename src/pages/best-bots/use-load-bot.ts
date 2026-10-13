import { useCallback, useState } from 'react';
import { NOTIFICATION_TYPE } from '@/components/bot-notification/bot-notification-utils';
import { DBOT_TABS } from '@/constants/bot-contents';
import { TFreeBot } from '@/constants/free-bots';
import { useStore } from '@/hooks/useStore';

const RECENT_KEY = 'bm_recent_bots';
const RECENT_MAX = 5;

export const readRecentBotIds = (): string[] => {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((id: unknown) => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

const rememberBot = (id: string) => {
    try {
        const next = [id, ...readRecentBotIds().filter(existing => existing !== id)].slice(0, RECENT_MAX);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
        // Storage can be unavailable (private mode); recents are a convenience only.
    }
};

/**
 * Loads a bundled bot into Bot Builder, same behaviour as the Free Bots tab:
 * `auto_run` bots start immediately, others open for review first.
 */
export const useLoadBot = () => {
    const [loading_id, setLoadingId] = useState<string | null>(null);
    const store = useStore();

    const loadBot = useCallback(
        async (bot: TFreeBot): Promise<string[]> => {
            if (loading_id || !store) return readRecentBotIds();
            const { load_modal, dashboard, run_panel } = store;
            setLoadingId(bot.id);
            try {
                if (bot.auto_run) {
                    // Register the wait BEFORE loading: loading fires the trade_definition
                    // BLOCK_CREATE event, so a listener attached afterwards would miss it.
                    const blockly = (window as any).Blockly;
                    const run_promise = blockly?.derivWorkspace
                        ?.waitForBlockEvent({
                            block_type: 'trade_definition',
                            event_type: blockly.Events.BLOCK_CREATE,
                            timeout: 8000,
                        })
                        .then(() => run_panel.onRunButtonClick())
                        .catch(() => dashboard.setOpenSettings(NOTIFICATION_TYPE.BOT_IMPORT));

                    await load_modal.loadFreeBotDirect(bot);
                    dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
                    await run_promise;
                } else {
                    await load_modal.loadFreeBotDirect(bot);
                    dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
                    dashboard.setOpenSettings(NOTIFICATION_TYPE.BOT_IMPORT);
                }
                rememberBot(bot.id);
            } finally {
                setLoadingId(null);
            }
            return readRecentBotIds();
        },
        [loading_id, store]
    );

    return { loadBot, loading_id };
};
