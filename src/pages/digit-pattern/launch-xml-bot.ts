// @ts-nocheck — window.Blockly runtime API has known upstream type gaps (waitForBlockEvent, Events.BLOCK_CREATE), same as free-bots-tab.tsx
import { FREE_BOTS } from '@/constants/free-bots';
import { DBOT_TABS } from '@/constants/bot-contents';
import { NOTIFICATION_TYPE } from '@/components/bot-notification/bot-notification-utils';
import { TSignalDirection } from '@/pages/signals/use-signal-streak';

export type TLaunchXmlBotParams = {
    mode: 'evenodd' | 'overunder';
    symbol: string;
    digit: number;
    direction: TSignalDirection;
    threshold_digit: number; // over/under barrier — ignored in evenodd mode
    initial_stake: number;
    martingale_mult: number;
    max_martingale_steps: number;
    stop_loss: number;
    take_profit: number;
};

const opposite = (dir: TSignalDirection): TSignalDirection => {
    if (dir === 'even') return 'odd';
    if (dir === 'odd') return 'even';
    if (dir === 'over') return 'under';
    return 'over';
};

const BOT_ID_BY_MODE: Record<TLaunchXmlBotParams['mode'], string> = {
    evenodd: 'even-odd-v2',
    overunder: 'over-under-v2',
};

const PURCHASE_BY_DIRECTION: Record<TSignalDirection, string> = {
    even: 'DIGITEVEN',
    odd: 'DIGITODD',
    over: 'DIGITOVER',
    under: 'DIGITUNDER',
};

/**
 * The single real-money execution path in the app. Every entry point —
 * Signals' "Trade this", Digit Pattern's scanner "Enter" — funnels through
 * here. There is no separate custom trading engine: this patches the
 * matching XML bot (digit, reversal contract, symbol, and risk settings)
 * and hands off to Deriv's own Bot Builder + Run Panel to actually place
 * and track trades.
 */
export const launchXmlBot = async (
    stores: { load_modal: any; dashboard: any; run_panel: any },
    params: TLaunchXmlBotParams
) => {
    const { load_modal, dashboard, run_panel } = stores;
    const bot = FREE_BOTS.find(b => b.id === BOT_ID_BY_MODE[params.mode]);
    if (!bot) return false;

    const reversal = opposite(params.direction);
    const purchase = PURCHASE_BY_DIRECTION[reversal];

    await load_modal.loadFreeBotWithOverrides(bot, {
        digit_to_use: params.digit,
        purchase,
        symbol: params.symbol,
        initial_stake: params.initial_stake,
        martingale_mult: params.martingale_mult,
        max_steps: params.max_martingale_steps,
        stop_loss: params.stop_loss,
        take_profit: params.take_profit,
        ...(params.mode === 'overunder' ? { prediction: params.threshold_digit } : {}),
    });

    dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);

    window.Blockly?.derivWorkspace
        ?.waitForBlockEvent({
            block_type: 'trade_definition',
            event_type: window.Blockly.Events.BLOCK_CREATE,
            timeout: 5000,
        })
        .then(() => {
            run_panel.onRunButtonClick();
        })
        .catch(() => {
            dashboard.setOpenSettings(NOTIFICATION_TYPE.BOT_IMPORT);
        });

    return true;
};
