import { useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { FREE_BOTS } from '@/constants/free-bots';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import type { TBotSummary } from './bot-resolution';

/** Lists this site's Free Bots and loads one into the workspace -- the same load the Free Bots
 *  tab's own "Load" button uses -- but stays on this page so the Run panel here can run it.
 *  Loading never runs the bot. */
export function useBotLoader() {
    const { load_modal } = useStore();
    const [loadingBotId, setLoadingBotId] = useState<string | null>(null);

    const bots: TBotSummary[] = useMemo(() => FREE_BOTS.map(b => ({ id: b.id, name: b.title })), []);

    const loadBot = async (bot: TBotSummary) => {
        const free_bot = FREE_BOTS.find(b => b.id === bot.id);
        if (!free_bot) return;
        setLoadingBotId(bot.id);
        try {
            await load_modal.loadFreeBotDirect(free_bot);
            toast.success(localize('{{name}} loaded. Press Run in the panel', { name: bot.name }));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : localize('Failed to load bot'));
        } finally {
            setLoadingBotId(null);
        }
    };

    return { bots, loadingBotId, loadBot };
}
