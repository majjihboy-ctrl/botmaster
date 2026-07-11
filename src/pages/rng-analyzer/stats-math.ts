// Pure statistical math for randomness testing. No placeholders — every
// function here is a complete, real implementation.

// ---------------------------------------------------------------------------
// Regularized incomplete gamma function (needed for an accurate chi-square
// p-value). This is the standard Numerical-Recipes approach: a series
// expansion for the lower branch when x < a+1, and a continued-fraction
// expansion for the upper branch otherwise, switching between them for
// numerical stability. Implemented from scratch — no lookup table.
// ---------------------------------------------------------------------------

// log(Gamma(x)) via the Lanczos approximation (g=7, n=9 coefficients).
function logGamma(x: number): number {
    const g = 7;
    const coeffs = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
        12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    if (x < 0.5) {
        // Reflection formula
        return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    }
    x -= 1;
    let a = coeffs[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) {
        a += coeffs[i] / (x + i);
    }
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Lower regularized incomplete gamma P(a, x) via series expansion.
// Valid/stable for x < a + 1.
function gammaIncLowerSeries(a: number, x: number): number {
    if (x === 0) return 0;
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n++) {
        term *= x / (a + n);
        sum += term;
        if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

// Upper regularized incomplete gamma Q(a, x) via a continued fraction.
// Valid/stable for x >= a + 1.
function gammaIncUpperContinuedFraction(a: number, x: number): number {
    const FPMIN = 1e-300;
    let b = x + 1 - a;
    let c = 1 / FPMIN;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 500; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < FPMIN) d = FPMIN;
        c = b + an / c;
        if (Math.abs(c) < FPMIN) c = FPMIN;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-15) break;
    }
    return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

// Upper regularized incomplete gamma Q(a, x) = 1 - P(a, x). This IS the
// chi-square survival function (p-value) once called with a = df/2, x = chi2/2.
function regularizedGammaQ(a: number, x: number): number {
    if (x < 0 || a <= 0) return NaN;
    if (x === 0) return 1;
    if (x < a + 1) {
        return 1 - gammaIncLowerSeries(a, x);
    }
    return gammaIncUpperContinuedFraction(a, x);
}

/** p-value for a chi-square statistic with the given degrees of freedom. */
export function chiSquarePValue(chiSquare: number, df: number): number {
    return regularizedGammaQ(df / 2, chiSquare / 2);
}

// ---------------------------------------------------------------------------
// Module 1a: Frequency analysis (Chi-Square Test)
// ---------------------------------------------------------------------------

export type TFrequencyResult = {
    observed: number[]; // counts for digits 0-9
    expected: number; // total/10
    chiSquare: number;
    pValue: number;
    df: number;
    passed: boolean; // true = "looks random" (fails to reject at alpha 0.05)
};

export function frequencyAnalysis(ticks: number[]): TFrequencyResult {
    const observed = new Array(10).fill(0);
    ticks.forEach(d => {
        if (d >= 0 && d <= 9) observed[d] += 1;
    });
    const total = ticks.length;
    const expected = total / 10;
    const chiSquare = observed.reduce((sum, o) => sum + (o - expected) ** 2 / (expected || 1), 0);
    const df = 9; // 10 categories - 1
    const pValue = total > 0 ? chiSquarePValue(chiSquare, df) : 1;
    return { observed, expected, chiSquare, pValue, df, passed: pValue >= 0.05 };
}

// ---------------------------------------------------------------------------
// Module 1b: Autocorrelation Test
// ---------------------------------------------------------------------------

export type TAutocorrelationPoint = { lag: number; correlation: number; isAnomaly: boolean };

export function autocorrelationAnalysis(ticks: number[], maxLag = 10): TAutocorrelationPoint[] {
    const n = ticks.length;
    if (n < 2) return [];
    const mean = ticks.reduce((s, v) => s + v, 0) / n;
    const variance = ticks.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    if (variance === 0) {
        return Array.from({ length: maxLag }, (_, i) => ({ lag: i + 1, correlation: 0, isAnomaly: false }));
    }

    const results: TAutocorrelationPoint[] = [];
    for (let lag = 1; lag <= maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i < n - lag; i++) {
            sum += (ticks[i] - mean) * (ticks[i + lag] - mean);
        }
        const correlation = sum / (n * variance);
        results.push({ lag, correlation, isAnomaly: Math.abs(correlation) > 0.05 });
    }
    return results;
}

// ---------------------------------------------------------------------------
// Module 1c: The Runs Test (Wald-Wolfowitz)
// ---------------------------------------------------------------------------

export type TRunsTestResult = {
    median: number;
    binarySequence: number[];
    n1: number; // count above median
    n0: number; // count at/below median
    observedRuns: number;
    expectedRuns: number;
    variance: number;
    zScore: number;
    rejectRandomness: boolean; // true if |Z| > 1.96
    log: string[]; // step-by-step math log for the terminal display
};

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function runsTest(ticks: number[]): TRunsTestResult {
    const log: string[] = [];
    const n = ticks.length;
    const med = median(ticks);
    log.push(`> median(sequence) = ${med}`);

    const binarySequence = ticks.map(v => (v > med ? 1 : 0));
    log.push(`> binary[i] = 1 if tick[i] > median else 0`);

    let observedRuns = binarySequence.length > 0 ? 1 : 0;
    for (let i = 1; i < binarySequence.length; i++) {
        if (binarySequence[i] !== binarySequence[i - 1]) observedRuns += 1;
    }
    log.push(`> observed_runs = ${observedRuns}`);

    const n1 = binarySequence.filter(b => b === 1).length;
    const n0 = binarySequence.filter(b => b === 0).length;
    log.push(`> n1 (above median) = ${n1}, n0 (at/below median) = ${n0}`);

    const expectedRuns = n > 0 ? (2 * n1 * n0) / n + 1 : 0;
    log.push(`> expected_runs = (2 * ${n1} * ${n0}) / ${n} + 1 = ${expectedRuns.toFixed(4)}`);

    const variance =
        n > 1 ? (2 * n1 * n0 * (2 * n1 * n0 - n)) / (n * n * (n - 1)) : 0;
    log.push(`> variance = ${variance.toFixed(4)}`);

    const stdDev = Math.sqrt(Math.max(variance, 0));
    const zScore = stdDev > 0 ? (observedRuns - expectedRuns) / stdDev : 0;
    log.push(`> Z = (${observedRuns} - ${expectedRuns.toFixed(4)}) / sqrt(${variance.toFixed(4)}) = ${zScore.toFixed(4)}`);

    const rejectRandomness = Math.abs(zScore) > 1.96;
    log.push(`> |Z| ${rejectRandomness ? '>' : '<='} 1.96 → ${rejectRandomness ? 'REJECT randomness' : 'fail to reject (looks random)'}`);

    return { median: med, binarySequence, n1, n0, observedRuns, expectedRuns, variance, zScore, rejectRandomness, log };
}
