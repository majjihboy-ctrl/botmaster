import { useMemo } from 'react';
import { localize } from '@deriv-com/translations';
import type { ContractType } from './contract-analysis';
import { useEpmTickSnapshot, type EpmTick, type EpmTickStore } from './use-epm-tick-stats';
import './market-probability-panel.scss';

interface MarketProbabilityPanelProps {
    store: EpmTickStore;
    contractType: ContractType;
    underBarrier: number;
    overBarrier: number;
}

const PATTERN_TICKS_SHOWN = 30;
const BARRIERS = [1, 2, 3, 4, 5, 6, 7, 8];

// Same convention as contract-analysis.ts: Over b -> digit > b, Under b -> digit < b.
const isRiseTick = (t: EpmTick, i: number, arr: EpmTick[]) => i > 0 && t.quote > arr[i - 1].quote;
const isFallTick = (t: EpmTick, i: number, arr: EpmTick[]) => i > 0 && t.quote < arr[i - 1].quote;

/**
 * Compact live price/probability readout for the gap between the scan
 * status and the digit circles. What it shows depends on the selected
 * Market Contract, rather than showing everything at once:
 *  - Current Price: always
 *  - Rise/Fall: tick-direction counts, a recent R/F pattern strip, and
 *    rise/fall probability bars
 *  - Over/Under: a live Over/Under probability table (barriers 1-8) and a
 *    signal-strength legend
 *  - Odd/Even, Match/Differ: just the current price -- nothing else here
 *    maps cleanly to those contract types
 */
function MarketProbabilityPanel({ store, contractType, underBarrier, overBarrier }: MarketProbabilityPanelProps) {
    const { ticks, pipSize } = useEpmTickSnapshot(store);
    const lastTick = ticks[ticks.length - 1];

    const riseFall = useMemo(() => {
        if (contractType !== 'rise_fall' || ticks.length < 2) return null;
        let rises = 0;
        let falls = 0;
        ticks.forEach((t, i) => {
            if (isRiseTick(t, i, ticks)) rises++;
            else if (isFallTick(t, i, ticks)) falls++;
        });
        const total = rises + falls;
        // Last PATTERN_TICKS_SHOWN ticks as R/F, each compared to the tick
        // right before it (so slice from one further back for context).
        const recent = ticks.slice(-(PATTERN_TICKS_SHOWN + 1));
        const pattern = recent
            .slice(1)
            .map((t, i) => (t.quote > recent[i].quote ? 'R' : t.quote < recent[i].quote ? 'F' : null))
            .filter((rf): rf is 'R' | 'F' => rf !== null);
        return {
            rises,
            falls,
            risePct: total ? (rises / total) * 100 : 0,
            fallPct: total ? (falls / total) * 100 : 0,
            pattern,
        };
    }, [ticks, contractType]);

    const overUnder = useMemo(() => {
        if (contractType !== 'over_under' || ticks.length === 0) return null;
        const total = ticks.length;
        const over = BARRIERS.map(b => (ticks.filter(t => t.digit > b).length / total) * 100);
        const under = BARRIERS.map(b => (ticks.filter(t => t.digit < b).length / total) * 100);
        return { over, under };
    }, [ticks, contractType]);

    return (
        <div className='market-probability'>
            <div className='market-probability__price'>
                <span className='market-probability__price-label'>{localize('Current Price')}</span>
                <span className='market-probability__price-value'>{lastTick ? lastTick.quote.toFixed(pipSize) : '—'}</span>
            </div>

            {contractType === 'rise_fall' && riseFall && (
                <>
                    <div className='market-probability__counts'>
                        <span className='market-probability__count market-probability__count--rise'>
                            {localize('Rise')} <b>{riseFall.rises}</b>
                        </span>
                        <span className='market-probability__count market-probability__count--fall'>
                            {localize('Fall')} <b>{riseFall.falls}</b>
                        </span>
                    </div>
                    <div className='market-probability__pattern'>
                        {riseFall.pattern.map((rf, i) => (
                            <span
                                key={i}
                                className={`market-probability__dot market-probability__dot--${rf === 'R' ? 'rise' : 'fall'}`}
                            >
                                {rf}
                            </span>
                        ))}
                    </div>
                    <div className='market-probability__bars'>
                        <div className='market-probability__bar-row'>
                            <span>{localize('Rise')}</span>
                            <div className='market-probability__bar-track'>
                                <div
                                    className='market-probability__bar-fill market-probability__bar-fill--rise'
                                    style={{ width: `${riseFall.risePct}%` }}
                                />
                            </div>
                        </div>
                        <div className='market-probability__bar-row'>
                            <span>{localize('Fall')}</span>
                            <div className='market-probability__bar-track'>
                                <div
                                    className='market-probability__bar-fill market-probability__bar-fill--fall'
                                    style={{ width: `${riseFall.fallPct}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </>
            )}

            {contractType === 'over_under' && overUnder && (
                <>
                    <div className='market-probability__table'>
                        <div className='market-probability__table-row market-probability__table-row--head'>
                            <span />
                            {BARRIERS.map(b => (
                                <span key={b} className={b === overBarrier ? 'market-probability__barrier--active' : ''}>
                                    {b}
                                </span>
                            ))}
                        </div>
                        <div className='market-probability__table-row'>
                            <span className='market-probability__row-label'>{localize('Over')}</span>
                            {overUnder.over.map((pct, i) => (
                                <span key={i} className={BARRIERS[i] === overBarrier ? 'market-probability__barrier--active' : ''}>
                                    {pct.toFixed(0)}%
                                </span>
                            ))}
                        </div>
                        <div className='market-probability__table-row'>
                            <span className='market-probability__row-label'>{localize('Under')}</span>
                            {overUnder.under.map((pct, i) => (
                                <span key={i} className={BARRIERS[i] === underBarrier ? 'market-probability__barrier--active' : ''}>
                                    {pct.toFixed(0)}%
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className='market-probability__legend'>
                        <span className='market-probability__legend-item market-probability__legend-item--strong'>
                            {localize('Strong ≥65%')}
                        </span>
                        <span className='market-probability__legend-item market-probability__legend-item--moderate'>
                            {localize('Moderate 55-65%')}
                        </span>
                        <span className='market-probability__legend-item market-probability__legend-item--weak'>
                            {localize('Weak <55%')}
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}

export default MarketProbabilityPanel;
