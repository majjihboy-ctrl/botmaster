import { roundMoney, TSettings } from '../auto-trades/engine-logic';

export const MAX_MARKETS = 5;

/** A round wins unless EVERY trade in it lost; martingale only steps up on a fully lost round. */
export const roundOutcome = (profits: number[]) => {
    const net = roundMoney(profits.reduce((sum, p) => sum + p, 0));
    const all_lost = profits.length > 0 && profits.every(p => p <= 0);
    return { net, all_lost };
};

/** Total money at risk in one round at the given per-trade stake. */
export const roundExposure = (stake: number, markets: number) => roundMoney(stake * markets);

/** Worst case: every round up to max_steps loses on every market. */
export const worstCaseExposure = (s: TSettings, markets: number) => {
    let total = 0;
    for (let i = 0; i < s.max_steps; i += 1) {
        total += Math.min(s.max_stake, s.stake * Math.pow(s.multiplier, i)) * markets;
    }
    return roundMoney(total);
};
