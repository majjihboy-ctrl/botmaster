import { useMemo, type KeyboardEvent } from 'react';
import { useEpmTickSnapshot, type EpmTickStore } from './use-epm-tick-stats';
import './digit-stats-widget.scss';

interface DigitStatsWidgetProps {
    /** Live tick store (see use-epm-tick-stats.ts). Subscribed to directly here,
     *  so only this widget redraws on every tick -- not the whole page. */
    store: EpmTickStore;
    /** Digits to show with the filled blue "selected" circle (e.g. the barriers). */
    highlightDigits?: number[];
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Length of the bottom arc (degrees) for a given percentage. */
const arcDegrees = (pct: number) => {
    if (pct <= 0) return 0;
    return Math.min(350, Math.max(16, pct * 30 - 180));
};

export interface DigitStatsViewProps {
    /** Share of ticks (0-100) for each digit 0-9. */
    percentages: number[];
    /** Digit with the biggest share (teal arc), or -1 when there is no data yet. */
    highest: number;
    /** Digit with the smallest share (red arc), or -1 when there is no data yet. */
    lowest: number;
    /** Digit of the latest tick (enlarged, red pointer), or -1 when unknown. */
    currentDigit: number;
    /** Digits to show with the filled blue "selected" circle. */
    highlightDigits?: number[];
    /** When given, every circle becomes tappable and calls this with its digit. */
    onSelect?: (digit: number) => void;
    /** Lay all ten circles out in ONE row instead of two rows of five. */
    singleRow?: boolean;
}

/**
 * The circles themselves, with no data source attached: give it percentages
 * and it draws them. Shared by the Analysis Tool (two rows of five, fed by its
 * tick store) and the Dtrader chart (one row of ten, fed by Dtrader's own live
 * tick store) so both always look exactly the same.
 */
export function DigitStatsView({
    percentages,
    highest,
    lowest,
    currentDigit,
    highlightDigits = [],
    onSelect,
    singleRow = false,
}: DigitStatsViewProps) {
    return (
        <div
            className={singleRow ? 'digit-stats digit-stats--row' : 'digit-stats'}
            aria-label='Live last digit statistics'
        >
            <div className='digit-stats__grid'>
                {DIGITS.map(d => {
                    const pct = percentages[d] ?? 0;
                    const deg = arcDegrees(pct);
                    const isCurrent = d === currentDigit;
                    const isSelected = highlightDigits.includes(d);
                    const arcClass =
                        d === highest ? 'digit-stats__arc--high' : d === lowest ? 'digit-stats__arc--low' : '';
                    const tapProps = onSelect
                        ? {
                              role: 'button' as const,
                              tabIndex: 0,
                              'aria-label': `Select digit ${d}`,
                              onClick: () => onSelect(d),
                              onKeyDown: (e: KeyboardEvent) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      onSelect(d);
                                  }
                              },
                          }
                        : {};
                    return (
                        <div
                            className={onSelect ? 'digit-stats__cell digit-stats__cell--tap' : 'digit-stats__cell'}
                            key={d}
                            {...tapProps}
                        >
                            <div
                                className={[
                                    'digit-stats__circle',
                                    isCurrent ? 'digit-stats__circle--current' : '',
                                    isSelected ? 'digit-stats__circle--selected' : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                            >
                                <svg className='digit-stats__svg' viewBox='0 0 100 100' aria-hidden='true'>
                                    <circle className='digit-stats__ring' cx='50' cy='50' r='44' />
                                    <circle
                                        className={`digit-stats__arc ${arcClass}`}
                                        cx='50'
                                        cy='50'
                                        r='44'
                                        pathLength={360}
                                        strokeDasharray={`${deg} ${360 - deg}`}
                                        style={{ transform: `rotate(${90 - deg / 2}deg)` }}
                                    />
                                </svg>
                                <div className='digit-stats__label'>
                                    <span className='digit-stats__digit'>{d}</span>
                                    <span className='digit-stats__pct'>{pct.toFixed(1)}%</span>
                                </div>
                                {isCurrent && <i className='digit-stats__pointer' />}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * Live last-digit distribution: ten circles (0-9) showing each digit's share of
 * the buffered ticks. Most frequent digit = teal arc, least frequent = red arc,
 * the latest tick's digit is enlarged with a red pointer.
 */
function DigitStatsWidget({ store, highlightDigits = [] }: DigitStatsWidgetProps) {
    const { ticks } = useEpmTickSnapshot(store);

    const { percentages, highest, lowest } = useMemo(() => {
        const counts = new Array(10).fill(0) as number[];
        ticks.forEach(t => {
            if (t.digit >= 0 && t.digit <= 9) counts[t.digit] += 1;
        });
        const total = counts.reduce((a, b) => a + b, 0);
        const pcts = counts.map(c => (total ? (c / total) * 100 : 0));
        if (!total) return { percentages: pcts, highest: -1, lowest: -1 };
        return {
            percentages: pcts,
            highest: pcts.indexOf(Math.max(...pcts)),
            lowest: pcts.indexOf(Math.min(...pcts)),
        };
    }, [ticks]);

    const currentDigit = ticks.length ? ticks[ticks.length - 1].digit : -1;

    return (
        <DigitStatsView
            percentages={percentages}
            highest={highest}
            lowest={lowest}
            currentDigit={currentDigit}
            highlightDigits={highlightDigits}
        />
    );
}

export default DigitStatsWidget;
