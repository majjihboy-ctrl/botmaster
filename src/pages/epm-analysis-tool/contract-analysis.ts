import type { EpmTick } from './use-epm-tick-stats';

export type ContractType = 'over_under' | 'rise_fall' | 'odd_even' | 'match_differ' | 'accumulator' | 'multiplier';

export interface SideResult {
    label: string;
    /** % of the ticks scanned so far that did NOT produce this outcome. */
    failPct: number;
    /** How many ticks have been scanned so far (grows to windowN as the scan runs). */
    sampleSize: number;
    /** Of `sampleSize`, how many were NOT this outcome -- the raw count failPct is built from. */
    failCount: number;
    /** True only once the scan has gone through the full window -- never during a partial reveal. */
    flagged: boolean;
}

const sideResult = (
    window: EpmTick[],
    thresholdPct: number,
    complete: boolean,
    label: string,
    qualifies: (t: EpmTick, i: number, arr: EpmTick[]) => boolean
): SideResult => {
    const qualifyCount = window.reduce((acc, t, i) => acc + (qualifies(t, i, window) ? 1 : 0), 0);
    const failCount = window.length - qualifyCount;
    const failPct = window.length ? (failCount / window.length) * 100 : 0;
    return {
        label,
        failPct,
        sampleSize: window.length,
        failCount,
        // `complete` alone is the gate -- it's only true once the scan has
        // gone through the full N ticks the user asked for.
        flagged: complete && window.length > 0 && failPct >= thresholdPct,
    };
};

/** Direction is relative to the previous tick, so a `window` for Rise/Fall
 *  should include one extra tick before the N being counted -- see
 *  `sourceTicksFor` below, which handles that. */
const isRise = (t: EpmTick, i: number, arr: EpmTick[]) => i > 0 && t.quote > arr[i - 1].quote;
const isFall = (t: EpmTick, i: number, arr: EpmTick[]) => i > 0 && t.quote < arr[i - 1].quote;

/** Under X and Over Y are compared directly against EACH OTHER, not
 *  against the full 0-9 spread: ticks outside both (the middle digits)
 *  are set aside first, so the two shown percentages are complementary
 *  and always add up to 100 -- e.g. Under 2 at 80% means Over 7 is at 20%
 *  of the ticks that were one or the other. */
export function analyzeOverUnder(
    window: EpmTick[],
    thresholdPct: number,
    complete: boolean,
    underBarrier: number,
    overBarrier: number
): SideResult[] {
    const relevant = window.filter(t => t.digit < underBarrier || t.digit > overBarrier);
    return [
        sideResult(relevant, thresholdPct, complete, `Under ${underBarrier}`, t => t.digit < underBarrier),
        sideResult(relevant, thresholdPct, complete, `Over ${overBarrier}`, t => t.digit > overBarrier),
    ];
}

export function analyzeRiseFall(window: EpmTick[], thresholdPct: number, complete: boolean): SideResult[] {
    return [
        sideResult(window, thresholdPct, complete, 'Rise', isRise),
        sideResult(window, thresholdPct, complete, 'Fall', isFall),
    ];
}

export function analyzeOddEven(window: EpmTick[], thresholdPct: number, complete: boolean): SideResult[] {
    return [
        sideResult(window, thresholdPct, complete, 'Even', t => t.digit % 2 === 0),
        sideResult(window, thresholdPct, complete, 'Odd', t => t.digit % 2 !== 0),
    ];
}

export function analyzeMatchDiffer(
    window: EpmTick[],
    thresholdPct: number,
    complete: boolean,
    digit: number
): SideResult[] {
    return [
        sideResult(window, thresholdPct, complete, `Matches ${digit}`, t => t.digit === digit),
        sideResult(window, thresholdPct, complete, `Differs ${digit}`, t => t.digit !== digit),
    ];
}

/** The real tick data a scan will step through, taken once at the moment
 *  Scan Market is pressed. Rise/Fall needs one extra leading tick so its
 *  very first counted tick still has a previous tick to compare against. */
export function sourceTicksFor(ticks: EpmTick[], windowN: number, contractType: ContractType): EpmTick[] {
    return contractType === 'rise_fall' ? ticks.slice(-(windowN + 1)) : ticks.slice(-windowN);
}

