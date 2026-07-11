// Cracks a Linear Congruential Generator: X_next = (a * X + c) % m
// All arithmetic uses BigInt — real LCG moduli (e.g. 2^31-1, 2^32) overflow
// JS's safe-integer range the moment you multiply two of them, so plain
// `number` math here would silently corrupt results.

function absBig(n: bigint): bigint {
    return n < 0n ? -n : n;
}

/** Euclidean algorithm, GCD of two BigInts (always returns a non-negative value). */
export function gcdBig(a: bigint, b: bigint): bigint {
    a = absBig(a);
    b = absBig(b);
    while (b !== 0n) {
        [a, b] = [b, a % b];
    }
    return a;
}

/** GCD across an arbitrary list of BigInts. */
function gcdList(values: bigint[]): bigint {
    return values.reduce((acc, v) => gcdBig(acc, v), 0n);
}

/**
 * Extended Euclidean algorithm. Returns [g, x, y] such that a*x + b*y = g = gcd(a, b).
 * Used here to compute the modular inverse of the multiplier's coefficient.
 */
function extendedGcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
    if (b === 0n) return [a, 1n, 0n];
    const [g, x1, y1] = extendedGcd(b, a % b);
    return [g, y1, x1 - (a / b) * y1];
}

/** Proper mathematical mod (always returns a non-negative result for a positive modulus). */
function mod(n: bigint, m: bigint): bigint {
    const r = n % m;
    return r < 0n ? r + m : r;
}

/** Modular inverse of `a` modulo `m`, or null if it doesn't exist (gcd(a, m) !== 1). */
function modInverse(a: bigint, m: bigint): bigint | null {
    const [g, x] = extendedGcd(mod(a, m), m);
    if (g !== 1n) return null;
    return mod(x, m);
}

export type TLCGCrackResult =
    | {
          success: true;
          m: bigint;
          a: bigint;
          c: bigint;
          predicted: bigint[];
          log: string[];
      }
    | {
          success: false;
          error: string;
          log: string[];
      };

/**
 * Cracks the LCG parameters (m, a, c) from a sequence of known raw outputs
 * and predicts the next `predictCount` values.
 *
 * Needs at least 4 known outputs (the theoretical minimum — gives exactly one
 * `u` value to seed the modulus guess). 6+ is meaningfully more reliable,
 * since combining multiple `u[i]` via GCD cancels out spurious common factors
 * that a single difference-of-differences can carry.
 */
export function crackLCG(rawOutputs: bigint[], predictCount = 5): TLCGCrackResult {
    const log: string[] = [];
    const X = rawOutputs;
    const n = X.length;

    if (n < 4) {
        return { success: false, error: 'Need at least 4 known outputs to crack an LCG.', log };
    }

    // Step 1 — differences: t[i] = X[i+1] - X[i]
    const t: bigint[] = [];
    for (let i = 0; i < n - 1; i++) t.push(X[i + 1] - X[i]);
    log.push(`> t[i] = X[i+1] - X[i]  →  [${t.join(', ')}]`);

    // Step 2 — second-order differences: u[i] = t[i+1]*t[i-1] - t[i]^2
    const u: bigint[] = [];
    for (let i = 1; i < t.length - 1; i++) {
        u.push(t[i + 1] * t[i - 1] - t[i] * t[i]);
    }
    if (u.length === 0) {
        return { success: false, error: 'Not enough data points to compute u[i] — provide at least 4 outputs.', log };
    }
    log.push(`> u[i] = t[i+1]*t[i-1] - t[i]^2  →  [${u.join(', ')}]`);

    // Step 3 — modulus m = gcd of all u[i]
    const m = gcdList(u);
    log.push(`> m = gcd(${u.join(', ')}) = ${m}`);
    if (m <= 1n) {
        return {
            success: false,
            error: `GCD collapsed to ${m} — the modulus could not be determined from this data. Try more known outputs.`,
            log,
        };
    }

    // Step 4 — multiplier: a = t[1] * modInverse(t[0], m) mod m
    const t0Inv = modInverse(t[0], m);
    if (t0Inv === null) {
        return {
            success: false,
            error: 't[0] has no modular inverse mod m (gcd(t[0], m) != 1) — cracking failed for this data.',
            log,
        };
    }
    log.push(`> t0_inv = modInverse(${t[0]}, ${m}) = ${t0Inv}`);
    const a = mod(t[1] * t0Inv, m);
    log.push(`> a = (t[1] * t0_inv) mod m = ${a}`);

    // Step 5 — increment: c = (X[1] - a*X[0]) mod m
    const c = mod(X[1] - a * X[0], m);
    log.push(`> c = (X[1] - a*X[0]) mod m = ${c}`);

    // Step 6 — sanity check: does (a, c, m) reproduce the known sequence?
    let check = X[0];
    let matches = 0;
    for (let i = 1; i < n; i++) {
        check = mod(a * check + c, m);
        if (check === X[i]) matches += 1;
    }
    log.push(`> verification: reproduced ${matches}/${n - 1} known transitions`);
    if (matches < n - 1) {
        log.push(
            `> WARNING: cracked parameters do not fully reproduce the known sequence — this generator may not be a plain LCG, or more known outputs are needed.`
        );
    }

    // Step 7 — predict the next values
    const predicted: bigint[] = [];
    let cur = X[n - 1];
    for (let i = 0; i < predictCount; i++) {
        cur = mod(a * cur + c, m);
        predicted.push(cur);
    }
    log.push(`> predicted next ${predictCount}: [${predicted.join(', ')}]`);

    return { success: true, m, a, c, predicted, log };
}
