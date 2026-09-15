import { api_base } from '@/external/bot-skeleton';
import { TSignalDirection } from '@/pages/signals/use-signal-streak';
import { opposite, resolveTradeDirection, TTradeStrategy } from '@/pages/digit-pattern/launch-xml-bot';

const CONTRACT_BY_DIRECTION: Record<TSignalDirection, string> = {
    even: 'DIGITEVEN',
    odd: 'DIGITODD',
    over: 'DIGITOVER',
    under: 'DIGITUNDER',
};

export type TPlaceDirectTradeParams = {
    mode: 'evenodd' | 'overunder';
    symbol: string;
    digit: number;
    direction: TSignalDirection;
    strategy: TTradeStrategy;
    threshold_digit: number;
    stake: number;
    currency?: string;
};

/**
 * Place a single trade immediately via the Deriv WebSocket API.
 * Used by Digit Pattern / Signals when the user selects "Custom Engine".
 * This is the fast path that does not go through Blockly and therefore
 * almost never misses the entry.
 */
export const placeDirectTrade = async (params: TPlaceDirectTradeParams): Promise<{ ok: boolean; error?: string; contract_id?: number }> => {
    if (!api_base.api || api_base.api.connection?.readyState !== 1) {
        return { ok: false, error: 'Connection is not ready' };
    }

    // For zigzag/mixed we still need a concrete first direction.
    // Use continuation logic for the first leg; the user can re-click for the next.
    const effectiveStrategy: TTradeStrategy =
        params.strategy === 'zigzag' || params.strategy === 'mixed' ? 'continuation' : params.strategy;

    const trade_direction = resolveTradeDirection(params.direction, effectiveStrategy);
    const contract_type = CONTRACT_BY_DIRECTION[trade_direction];
    const stake = Math.max(0.35, Math.round(params.stake * 100) / 100);

    try {
        const proposal_request: Record<string, unknown> = {
            proposal: 1,
            amount: stake,
            basis: 'stake',
            contract_type,
            currency: params.currency || 'USD',
            duration: 1,
            duration_unit: 't',
            underlying_symbol: params.symbol,
        };
        if (params.mode === 'overunder') {
            proposal_request.barrier = params.threshold_digit;
        }

        const proposal_res = await api_base.api.send(proposal_request);
        if (proposal_res?.error) {
            return { ok: false, error: proposal_res.error.message || 'Proposal failed' };
        }
        const proposal_id = proposal_res?.proposal?.id;
        if (!proposal_id) {
            return { ok: false, error: 'No proposal returned' };
        }

        const buy_res = await api_base.api.send({ buy: proposal_id, price: stake });
        if (buy_res?.error) {
            return { ok: false, error: buy_res.error.message || 'Buy was rejected' };
        }
        const contract_id = buy_res?.buy?.contract_id;
        if (!contract_id) {
            return { ok: false, error: 'No contract id returned' };
        }

        return { ok: true, contract_id };
    } catch (err: any) {
        return { ok: false, error: err?.message || 'Trade failed' };
    }
};
