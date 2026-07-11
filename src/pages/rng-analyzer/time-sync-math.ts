// mulberry32 — a small, fast, real 32-bit PRNG. Used here to simulate a
// "weak" seed-from-time generator (the kind of generator this module tests
// for), not to generate anything used elsewhere in the app.
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Generate `count` digits (0-9) from a mulberry32 stream seeded by `seed`. */
export function generateDigitsFromSeed(seed: number, count: number): number[] {
    const rand = mulberry32(seed);
    return Array.from({ length: count }, () => Math.floor(rand() * 10));
}

export type TTimeSyncResult = {
    rttMs: number;
    estimatedServerTimeMs: number;
    seed: number;
    digits: number[];
    usedFallback: boolean;
};

/**
 * Measures round-trip time to a public time API, estimates the server's
 * current time (local send time + RTT/2, a standard NTP-style estimate),
 * and seeds a weak PRNG from it to show what a time-seeded generator would
 * produce. Falls back to a simulated 20ms RTT if the request fails (CORS,
 * offline, the endpoint being down, etc.) rather than blocking the demo.
 */
export async function measureAndPredict(digitCount = 10): Promise<TTimeSyncResult> {
    const sendTime = Date.now();
    let usedFallback = false;
    let rttMs: number;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timeout);
        rttMs = Date.now() - sendTime;
    } catch {
        usedFallback = true;
        rttMs = 20; // simulated latency, per spec's fallback instruction
        await new Promise(resolve => setTimeout(resolve, rttMs));
    }

    const receiveTime = Date.now();
    const estimatedServerTimeMs = Math.round(sendTime + rttMs / 2);
    const seed = estimatedServerTimeMs >>> 0;
    const digits = generateDigitsFromSeed(seed, digitCount);

    return { rttMs: usedFallback ? rttMs : receiveTime - sendTime, estimatedServerTimeMs, seed, digits, usedFallback };
}
