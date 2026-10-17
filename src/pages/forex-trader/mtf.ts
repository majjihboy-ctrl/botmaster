/**
 * Multi-timeframe analysis (M15 direction + M5 entry): pure calculation, no React, no network.
 *
 * ADDITIONAL feature next to the H1 sweep strategies in engine.ts (which it does not change).
 *
 *  1. M15 decides the BIAS from market structure: higher highs + higher lows = bullish,
 *     lower highs + lower lows = bearish, anything else = unclear (no trade).
 *  2. M5 must then CONFIRM an entry in the same direction. The confirmation is one fixed rule:
 *     a pullback against the bias formed an M5 swing low (BUY) / swing high (SELL), and a CLOSED M5 candle
 *     then closed beyond the last M5 swing high / low before that pullback (an M5 break of structure).
 *  3. Only closed candles are used. If anything is missing, old, contradicting or unclear: WAIT.
 *
 * Mirror trick: a SELL is calculated by flipping the prices (x -> -x) and running the BUY rule,
 * so both directions use exactly the same code and cannot drift apart.
 */
import { atr, type Candle } from './engine';

export type MtfSignal = 'BUY' | 'SELL' | 'WAIT';
export type Bias = 'bullish' | 'bearish' | 'unclear';
export type M5Status = 'confirmed' | 'waiting' | 'against' | 'stale' | 'no_data';

export const M15_SEC = 900;
export const M5_SEC = 300;

/** Swing point = a candle whose high/low beats this many candles on each side. */
const M15_PIVOT_SIDE = 3;
const M5_PIVOT_SIDE = 2;
/** Minimum number of closed candles needed on each timeframe. */
export const MIN_M15_CANDLES = 60;
export const MIN_M5_CANDLES = 60;
/** The M5 pullback low/high must have formed within this many M5 candles (3 hours). */
const M5_WINDOW = 36;
/** The M5 swing high before the pullback must be at most this many candles before it. */
const M5_LEG_LOOKBACK = 30;
/** The confirming candle must be one of the last (FRESH + 1) closed M5 candles, otherwise the entry has passed. */
const FRESH_CANDLES = 2;
/** Same minimum reward:risk as the H1 tool (1 : 2). */
export const MTF_MIN_RR = 2;
/** The pullback leg must be at least this many M5 ATR (otherwise it is just noise). */
const MIN_LEG_ATR = 0.5;
/** Price may not have run further than this many M5 ATR beyond the broken level (do not chase). */
const MAX_CHASE_ATR = 1.5;
/** Stop loss sits this many M5 ATR beyond the pullback extreme. */
export const SL_BUFFER_ATR = 0.25;
/** Stop distance must be between these many M5 ATR (too tight = noise, too wide = undefined). */
export const MIN_RISK_ATR = 0.5;
export const MAX_RISK_ATR = 4;
/** Data older than this many candle-lengths is treated as not fresh. */
export const M5_STALE_AFTER = 3;
export const M15_STALE_AFTER = 2;
/** Two swing points closer than this many M15 ATR count as "equal" (a liquidity pool). */
const EQUAL_LEVEL_ATR = 0.15;

export interface Pivot {
    index: number;
    time: number;
    price: number;
}

export interface MtfLevels {
    support: number | null;
    resistance: number | null;
    prevDayHigh: number | null;
    prevDayLow: number | null;
    /** The swing the bias depends on: if price closes beyond it the M15 structure is broken. */
    invalidation: number | null;
    equalHighs: number | null;
    equalLows: number | null;
}

export interface MtfPlan {
    side: 'BUY' | 'SELL';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    rr: number;
    risk: number;
}

export interface MtfResult {
    signal: MtfSignal;
    bias: Bias;
    /** One sentence about the M15 market structure. */
    m15Text: string;
    m5Status: M5Status;
    /** One sentence about the M5 confirmation. */
    m5Text: string;
    levels: MtfLevels;
    plan: MtfPlan | null;
    /** Short explanation, one point per line. */
    reasons: string[];
    /** Identifies one confirmed setup (side + pullback extreme + broken level): stays the same while the same setup is still valid, so it is sent once. */
    setupId: string | null;
    /** Time of the signal: the close of the confirming M5 candle (WAIT: the last closed M5 candle). Seconds, UTC. */
    signalTime: number | null;
    lastPrice: number | null;
    /** Changes only when the situation really changes (used to avoid redrawing/recomputing for nothing). */
    key: string;
}

// ---------------------------------------------------------------------------------------------
// helpers

/** Closed candles only, oldest first, one per time, no broken values. */
export function cleanClosed(candles: Candle[], period: number, now: number): Candle[] {
    const byTime = new Map<number, Candle>();
    for (const c of candles) {
        if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) continue;
        if (c.high < c.low) continue;
        if (c.time + period > now) continue; // still forming
        byTime.set(c.time, c);
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function pivots(candles: Candle[], kind: 'high' | 'low', side: number): Pivot[] {
    const out: Pivot[] = [];
    for (let i = side; i < candles.length - side; i++) {
        const v = kind === 'high' ? candles[i].high : candles[i].low;
        let ok = true;
        for (let k = 1; k <= side && ok; k++) {
            const a = kind === 'high' ? candles[i - k].high : candles[i - k].low;
            const b = kind === 'high' ? candles[i + k].high : candles[i + k].low;
            // strictly beyond the left side, at least equal on the right (a flat top/bottom counts once, at its first candle)
            ok = kind === 'high' ? v > a && v >= b : v < a && v <= b;
        }
        if (ok) out.push({ index: i, time: candles[i].time, price: v });
    }
    return out;
}

export const mirror = (c: Candle): Candle => ({ time: c.time, open: -c.open, high: -c.low, low: -c.high, close: -c.close });

const dayStart = (t: number) => Math.floor(t / 86400) * 86400;

export const fmt = (n: number) => String(Number(n.toPrecision(8)));

// ---------------------------------------------------------------------------------------------
// M15: direction and levels

export interface M15Read {
    bias: Bias;
    text: string;
    levels: MtfLevels;
    atr15: number | null;
}

export function analyseM15(m15: Candle[]): M15Read {
    const empty: MtfLevels = { support: null, resistance: null, prevDayHigh: null, prevDayLow: null, invalidation: null, equalHighs: null, equalLows: null };
    const atr15 = atr(m15, 14);
    const highs = pivots(m15, 'high', M15_PIVOT_SIDE);
    const lows = pivots(m15, 'low', M15_PIVOT_SIDE);
    const price = m15[m15.length - 1].close;

    // support / resistance: nearest swing low below price, nearest swing high above price
    const recentHighs = highs.slice(-12).map(p => p.price);
    const recentLows = lows.slice(-12).map(p => p.price);

    // previous UTC day high/low (only when that day is well covered by candles)
    const today = dayStart(m15[m15.length - 1].time);
    const prevDay = m15.filter(c => dayStart(c.time) === today - 86400);
    const prevDayHigh = prevDay.length >= 40 ? Math.max(...prevDay.map(c => c.high)) : null;
    const prevDayLow = prevDay.length >= 40 ? Math.min(...prevDay.map(c => c.low)) : null;

    const above = [...recentHighs, ...(prevDayHigh !== null ? [prevDayHigh] : [])].filter(v => v > price);
    const below = [...recentLows, ...(prevDayLow !== null ? [prevDayLow] : [])].filter(v => v < price);
    const resistance = above.length ? Math.min(...above) : null;
    const support = below.length ? Math.max(...below) : null;

    // equal highs / lows (liquidity pools): two of the last swing points almost at the same price
    const tol = atr15 ? atr15 * EQUAL_LEVEL_ATR : 0;
    const equal = (list: Pivot[]): number | null => {
        const l = list.slice(-6);
        for (let i = l.length - 1; i > 0; i--) for (let j = i - 1; j >= 0; j--) if (Math.abs(l[i].price - l[j].price) <= tol) return Math.max(l[i].price, l[j].price);
        return null;
    };
    const equalHighs = tol ? equal(highs) : null;
    const equalLows = tol ? equal(lows) : null;

    const levels: MtfLevels = { ...empty, support, resistance, prevDayHigh, prevDayLow, equalHighs, equalLows };

    if (highs.length < 2 || lows.length < 2) {
        return { bias: 'unclear', text: 'M15: not enough swing points to read the structure.', levels, atr15 };
    }
    const [h0, h1] = highs.slice(-2);
    const [l0, l1] = lows.slice(-2);
    if (h1.price > h0.price && l1.price > l0.price) {
        if (price > l1.price) {
            return {
                bias: 'bullish',
                text: `M15 bullish: higher highs (${fmt(h0.price)} → ${fmt(h1.price)}) and higher lows (${fmt(l0.price)} → ${fmt(l1.price)}).`,
                levels: { ...levels, invalidation: l1.price },
                atr15,
            };
        }
        return { bias: 'unclear', text: `M15 unclear: the last higher low ${fmt(l1.price)} was broken by price.`, levels, atr15 };
    }
    if (h1.price < h0.price && l1.price < l0.price) {
        if (price < h1.price) {
            return {
                bias: 'bearish',
                text: `M15 bearish: lower highs (${fmt(h0.price)} → ${fmt(h1.price)}) and lower lows (${fmt(l0.price)} → ${fmt(l1.price)}).`,
                levels: { ...levels, invalidation: h1.price },
                atr15,
            };
        }
        return { bias: 'unclear', text: `M15 unclear: the last lower high ${fmt(h1.price)} was broken by price.`, levels, atr15 };
    }
    return { bias: 'unclear', text: 'M15 unclear: the highs and lows do not make a clean higher-high/higher-low or lower-high/lower-low sequence.', levels, atr15 };
}

// ---------------------------------------------------------------------------------------------
// M5: entry confirmation (BUY rule; SELL runs on mirrored candles)

interface BuyConfirm {
    status: M5Status;
    text: string;
    /** Confirming candle index, pullback extreme and the broken level (only when status is "confirmed" or "stale"). */
    confirmIndex?: number;
    extreme?: number;
    breakLevel?: number;
}

export function confirmBuy(c5: Candle[], atr5: number, invalidation: number | null, wording: { low: string; high: string; up: string }, show: (n: number) => string): BuyConfirm {
    const n = c5.length;
    const lows = pivots(c5, 'low', M5_PIVOT_SIDE).filter(p => p.index >= n - M5_WINDOW);
    const highs = pivots(c5, 'high', M5_PIVOT_SIDE);
    const P = lows[lows.length - 1];
    if (!P) return { status: 'waiting', text: `M5: no pullback ${wording.low} has formed yet (still pulling back, or no pullback).` };

    if (invalidation !== null && P.price <= invalidation) {
        return { status: 'against', text: `M5: the pullback went through the M15 level ${show(invalidation)}, so the M15 direction is in doubt.` };
    }
    const lowerLow = c5.slice(P.index + 1).some(c => c.low < P.price);
    if (lowerLow) return { status: 'against', text: `M5: price made a new ${wording.low} after the pullback and is still moving against the M15 direction.` };

    const H = [...highs].reverse().find(h => h.index < P.index && h.index >= P.index - M5_LEG_LOOKBACK);
    if (!H) return { status: 'waiting', text: `M5: no swing ${wording.high} found before the pullback to break.` };
    if (H.price - P.price < MIN_LEG_ATR * atr5) return { status: 'waiting', text: 'M5: the pullback is too small to be a real pullback.' };

    let ci = -1;
    for (let i = P.index + 1; i < n; i++) {
        if (c5[i].close > H.price) {
            ci = i;
            break;
        }
    }
    if (ci < 0) return { status: 'waiting', text: `M5: pullback ${wording.low} ${show(P.price)} found. Waiting for an M5 candle to close ${wording.up} ${show(H.price)}.`, extreme: P.price, breakLevel: H.price };
    if (n - 1 - ci > FRESH_CANDLES) return { status: 'stale', text: `M5: the break of ${show(H.price)} happened ${n - 1 - ci} candles ago, the entry has already passed.`, confirmIndex: ci, extreme: P.price, breakLevel: H.price };
    if (c5[n - 1].close - H.price > MAX_CHASE_ATR * atr5) {
        return { status: 'stale', text: `M5: price already ran too far ${wording.up} the broken level ${show(H.price)}, chasing is not allowed.`, confirmIndex: ci, extreme: P.price, breakLevel: H.price };
    }
    return {
        status: 'confirmed',
        text: `M5 confirmed: pullback ${wording.low} ${show(P.price)}, then an M5 candle closed ${wording.up} the swing ${wording.high} ${show(H.price)}.`,
        confirmIndex: ci,
        extreme: P.price,
        breakLevel: H.price,
    };
}

// ---------------------------------------------------------------------------------------------
// the full analysis

export function result(partial: Partial<MtfResult> & { reasons: string[]; m15Text: string; m5Text: string }): MtfResult {
    const r: MtfResult = {
        signal: 'WAIT',
        bias: 'unclear',
        m5Status: 'no_data',
        levels: { support: null, resistance: null, prevDayHigh: null, prevDayLow: null, invalidation: null, equalHighs: null, equalLows: null },
        plan: null,
        setupId: null,
        signalTime: null,
        lastPrice: null,
        key: '',
        ...partial,
    };
    r.key = [r.signal, r.bias, r.m5Status, r.signalTime ?? '', r.plan ? `${r.plan.entry}|${r.plan.stopLoss}|${r.plan.takeProfit}` : ''].join('|');
    return r;
}

/**
 * @param m15 raw M15 candles (closed or forming; forming ones are ignored)
 * @param m5  raw M5 candles
 * @param now seconds since epoch
 */
export function analyseMtf(m15Raw: Candle[], m5Raw: Candle[], now: number): MtfResult {
    const m15 = cleanClosed(m15Raw, M15_SEC, now);
    const m5 = cleanClosed(m5Raw, M5_SEC, now);

    if (m15.length < MIN_M15_CANDLES || m5.length < MIN_M5_CANDLES) {
        return result({
            m15Text: m15.length < MIN_M15_CANDLES ? `M15: only ${m15.length} closed candles available (need ${MIN_M15_CANDLES}).` : 'M15: data available.',
            m5Text: m5.length < MIN_M5_CANDLES ? `M5: only ${m5.length} closed candles available (need ${MIN_M5_CANDLES}).` : 'M5: data available.',
            reasons: ['Not enough real candle data to analyse reliably. No signal.'],
        });
    }
    const last5 = m5[m5.length - 1];
    const last15 = m15[m15.length - 1];
    const lastPrice = last5.close;
    if (now - (last5.time + M5_SEC) > M5_STALE_AFTER * M5_SEC || now - (last15.time + M15_SEC) > M15_STALE_AFTER * M15_SEC) {
        return result({
            m15Text: 'M15: data is not fresh.',
            m5Text: 'M5: data is not fresh (market closed or the price feed is delayed).',
            reasons: ['The newest closed candles are too old. No signal until fresh data arrives.'],
            lastPrice,
        });
    }

    const read = analyseM15(m15);
    const atr5 = atr(m5, 14);
    const base = { levels: read.levels, lastPrice, bias: read.bias, m15Text: read.text };
    if (!atr5 || atr5 <= 0) return result({ ...base, m5Text: 'M5: cannot measure the normal candle size.', reasons: ['M5 volatility could not be measured. No signal.'] });

    if (read.bias === 'unclear') {
        return result({ ...base, m5Status: 'waiting', m5Text: 'M5: not checked because M15 has no clear direction.', signalTime: last5.time + M5_SEC, reasons: [read.text, 'No clear M15 direction, so no trade. WAIT.'] });
    }

    const buy = read.bias === 'bullish';
    const series = buy ? m5 : m5.map(mirror);
    const inval = read.levels.invalidation === null ? null : buy ? read.levels.invalidation : -read.levels.invalidation;
    const sgn = buy ? 1 : -1;
    // the SELL run works on flipped prices, so numbers in its text are flipped back before they are shown
    const conf = confirmBuy(series, atr5, inval, buy ? { low: 'low', high: 'high', up: 'above' } : { low: 'high', high: 'low', up: 'below' }, n => fmt(sgn * n));
    const m5Text = conf.text;

    if (conf.status !== 'confirmed') {
        return result({
            ...base,
            m5Status: conf.status,
            m5Text,
            signalTime: last5.time + M5_SEC,
            reasons: [read.text, m5Text, conf.status === 'against' ? 'M5 contradicts M15. WAIT.' : 'No confirmed M5 entry yet. WAIT.'],
        });
    }

    // plan: enter at the latest closed candle, stop beyond the pullback, target at the next M15 level or 1:2
    const entry = lastPrice;
    const extreme = sgn * (conf.extreme as number);
    const stopLoss = extreme - sgn * SL_BUFFER_ATR * atr5;
    const risk = Math.abs(entry - stopLoss);
    if (!(risk > 0) || risk < MIN_RISK_ATR * atr5 || risk > MAX_RISK_ATR * atr5 || (buy ? stopLoss >= entry : stopLoss <= entry)) {
        return result({
            ...base,
            m5Status: 'waiting',
            m5Text,
            signalTime: last5.time + M5_SEC,
            reasons: [read.text, m5Text, `The stop distance (${fmt(risk)}) is outside the safe range of ${MIN_RISK_ATR}-${MAX_RISK_ATR} M5 ATR. WAIT.`],
        });
    }
    const target = buy ? read.levels.resistance : read.levels.support;
    let takeProfit: number;
    let tpNote: string;
    if (target !== null && (buy ? target > entry : target < entry)) {
        const room = Math.abs(target - entry) / risk;
        if (room < MTF_MIN_RR) {
            return result({
                ...base,
                m5Status: 'waiting',
                m5Text,
                signalTime: last5.time + M5_SEC,
                reasons: [read.text, m5Text, `Not enough room: the next M15 ${buy ? 'resistance' : 'support'} ${fmt(target)} is only 1 : ${room.toFixed(2)} away (minimum 1 : ${MTF_MIN_RR}). WAIT.`],
            });
        }
        takeProfit = target;
        tpNote = `Take profit at the next M15 ${buy ? 'resistance' : 'support'} ${fmt(target)}.`;
    } else {
        takeProfit = entry + sgn * MTF_MIN_RR * risk;
        tpNote = `No M15 ${buy ? 'resistance' : 'support'} in the way, take profit at 1 : ${MTF_MIN_RR}.`;
    }
    const rr = Math.abs(takeProfit - entry) / risk;
    const plan: MtfPlan = { side: buy ? 'BUY' : 'SELL', entry, stopLoss, takeProfit, rr, risk };
    return result({
        ...base,
        signal: plan.side,
        setupId: `${plan.side}|${fmt(extreme)}|${fmt(sgn * (conf.breakLevel as number))}`,
        m5Status: 'confirmed',
        m5Text,
        plan,
        signalTime: last5.time + M5_SEC,
        reasons: [read.text, m5Text, `Stop loss ${fmt(stopLoss)} (beyond the pullback ${buy ? 'low' : 'high'} + ${SL_BUFFER_ATR} ATR). ${tpNote}`],
    });
}
