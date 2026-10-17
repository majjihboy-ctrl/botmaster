/**
 * ICT strategy (additional, next to the H1 strategies and the M15 + M5 mode): pure calculation, no React, no network.
 *
 *  1. M15 decides the BIAS (same rule as the M15 + M5 mode). No clear M15 direction = WAIT.
 *  2. M5 liquidity SWEEP: a candle trades beyond an earlier M5 swing low (BUY) / swing high (SELL), taking the stops resting there,
 *     and closes back inside.
 *  3. Market structure SHIFT: afterwards a CLOSED M5 candle with a strong body closes beyond the last swing high (BUY) / low (SELL) before the sweep.
 *  4. FAIR VALUE GAP: the strong move leaves a three-candle gap (candle 1 high is below candle 3 low for a BUY). The entry is when price
 *     comes back into that gap for the first time. Closing through the far side of the gap cancels the setup.
 *  5. Stop beyond the sweep extreme, target at the next M15 level or 1:2. Closed candles only. Anything missing, old or unclear: WAIT.
 *
 * Like the M15 + M5 mode, a SELL is calculated on flipped prices (x -> -x) with the BUY rule.
 */
import { atr, type Candle } from './engine';
import {
    analyseM15, cleanClosed, pivots, mirror, fmt, result, M15_SEC, M5_SEC, MIN_M15_CANDLES, MIN_M5_CANDLES, MTF_MIN_RR,
    M5_STALE_AFTER, M15_STALE_AFTER, SL_BUFFER_ATR, MIN_RISK_ATR, MAX_RISK_ATR, type MtfResult, type MtfPlan, type M5Status,
} from './mtf';

export const ICT_PIVOT_SIDE = 2;
/** How far back (M5 candles) the sweep may be. */
const SWEEP_WINDOW = 60;
/** The structure shift must close with a body of at least this many ATR (a real push, not a drift). */
const MIN_DISPLACEMENT_ATR = 0.6;
/** The gap must be at least this many ATR tall. */
const MIN_GAP_ATR = 0.1;
/** The first return into the gap must be on the newest closed candle or the one before it. */
const ICT_FRESH_CANDLES = 1;
/** A gap that price has not come back to for this many candles is too old. */
const MAX_WAIT_CANDLES = 36;
/** Price may not already be further than this many ATR beyond the gap (no chasing). */
const MAX_CHASE_ATR = 1.5;
const MIN_SWEEP_LEG_ATR = 0.5;

export interface IctConfirm {
    status: M5Status;
    text: string;
    sweepLevel?: number;
    extreme?: number;
    breakLevel?: number;
    gapBottom?: number;
    gapTop?: number;
}

/** BUY rule on a series (SELL runs on mirrored candles). `show` turns numbers back for display. */
export function confirmIctBuy(c5: Candle[], atr5: number, invalidation: number | null, wording: { low: string; high: string; up: string; down: string }, show: (n: number) => string): IctConfirm {
    const n = c5.length;
    const lows = pivots(c5, 'low', ICT_PIVOT_SIDE);
    const highs = pivots(c5, 'high', ICT_PIVOT_SIDE);

    // 1. most recent liquidity sweep: a candle that goes beyond a still-untouched swing low and closes back above it
    let sweep: { s: number; level: number } | null = null;
    for (let s = n - 2; s >= Math.max(1, n - SWEEP_WINDOW) && !sweep; s--) {
        for (let k = lows.length - 1; k >= 0; k--) {
            const L = lows[k];
            if (L.index >= s) continue;
            if (c5[s].low < L.price && c5[s].close > L.price && c5.slice(L.index + 1, s).every(c => c.low >= L.price)) {
                sweep = { s, level: L.price };
                break;
            }
        }
    }
    if (!sweep) return { status: 'waiting', text: `M5: no liquidity sweep of a swing ${wording.low} yet.` };
    const { s } = sweep;

    // 2. market structure shift: a strong candle closes beyond the last swing high before the sweep
    const H = [...highs].reverse().find(h => h.index < s && h.index >= s - 30);
    if (!H) return { status: 'waiting', text: `M5: swept the ${wording.low} ${show(sweep.level)}, but there is no earlier swing ${wording.high} to break.`, sweepLevel: sweep.level };
    const sweepExtreme = Math.min(...c5.slice(s).map(c => c.low));
    if (H.price - sweepExtreme < MIN_SWEEP_LEG_ATR * atr5) return { status: 'waiting', text: 'M5: the move after the sweep is too small to be a real shift.', sweepLevel: sweep.level };
    let m = -1;
    for (let i = s + 1; i < n; i++) {
        if (c5[i].close > H.price) { m = i; break; }
    }
    if (m < 0) return { status: 'waiting', text: `M5: swept the ${wording.low} ${show(sweep.level)}. Waiting for a candle to close ${wording.up} the swing ${wording.high} ${show(H.price)} (market structure shift).`, sweepLevel: sweep.level, breakLevel: H.price };
    if (c5[m].close - c5[m].open < MIN_DISPLACEMENT_ATR * atr5) {
        return { status: 'waiting', text: `M5: the break of ${show(H.price)} was weak (no strong push), not a real structure shift.`, sweepLevel: sweep.level, breakLevel: H.price };
    }

    // 3. latest fair value gap made by the push (middle candle k between the sweep and the shift, plus one more candle)
    let k = -1;
    for (let i = Math.min(m + 1, n - 2); i >= s + 1; i--) {
        if (c5[i + 1].low - c5[i - 1].high >= MIN_GAP_ATR * atr5) { k = i; break; }
    }
    if (k < 0) return { status: 'waiting', text: `M5: structure shifted ${wording.up} ${show(H.price)} but the push left no fair value gap to enter on.`, sweepLevel: sweep.level, breakLevel: H.price };
    const gapBottom = c5[k - 1].high;
    const gapTop = c5[k + 1].low;
    const extreme0 = sweepExtreme;
    const base = { sweepLevel: sweep.level, breakLevel: H.price, gapBottom, gapTop };
    if (invalidation !== null && extreme0 <= invalidation) {
        return { status: 'against', text: `M5: the sweep went through the M15 level ${show(invalidation)}, so the M15 direction is in doubt.`, ...base, extreme: extreme0 };
    }

    // 4. first return into the gap
    let j = -1;
    for (let i = k + 2; i < n; i++) {
        if (c5[i].close < gapBottom) {
            return { status: 'against', text: `M5: price closed through the fair value gap (${show(gapBottom)} - ${show(gapTop)}), the setup failed.`, ...base, extreme: Math.min(extreme0, ...c5.slice(s).map(c => c.low)) };
        }
        if (c5[i].low <= gapTop) { j = i; break; }
    }
    const gapText = `fair value gap ${show(gapBottom)} - ${show(gapTop)}`;
    if (j < 0) {
        if (n - 1 - m > MAX_WAIT_CANDLES) return { status: 'stale', text: `M5: the ${gapText} is too old, price never came back to it.`, ...base, extreme: extreme0 };
        return { status: 'waiting', text: `M5: swept the ${wording.low} ${show(sweep.level)}, structure shifted ${wording.up} ${show(H.price)}. Waiting for price to come back to the ${gapText}.`, ...base, extreme: extreme0 };
    }
    if (n - 1 - j > ICT_FRESH_CANDLES) return { status: 'stale', text: `M5: price already came back to the ${gapText} ${n - 1 - j} candles ago, the entry has passed.`, ...base, extreme: extreme0 };
    const last = c5[n - 1];
    if (last.close - gapTop > MAX_CHASE_ATR * atr5) return { status: 'stale', text: `M5: price already ran too far ${wording.up} the ${gapText}, chasing is not allowed.`, ...base, extreme: extreme0 };
    const extreme = Math.min(...c5.slice(s).map(c => c.low));
    return {
        status: 'confirmed',
        text: `ICT confirmed: swept the ${wording.low} ${show(sweep.level)}, structure shifted ${wording.up} ${show(H.price)}, and price returned to the ${gapText}.`,
        ...base,
        extreme,
    };
}

/**
 * @param m15Raw raw M15 candles (forming ones are ignored)
 * @param m5Raw  raw M5 candles
 * @param now    seconds since epoch
 */
export function analyseIct(m15Raw: Candle[], m5Raw: Candle[], now: number): MtfResult {
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
        return result({ ...base, m5Status: 'waiting', m5Text: 'M5: not checked because M15 has no clear direction.', signalTime: last5.time + M5_SEC, reasons: [read.text, 'No clear M15 direction, so no ICT trade. WAIT.'] });
    }

    const buy = read.bias === 'bullish';
    const series = buy ? m5 : m5.map(mirror);
    const inval = read.levels.invalidation === null ? null : buy ? read.levels.invalidation : -read.levels.invalidation;
    const sgn = buy ? 1 : -1;
    const conf = confirmIctBuy(series, atr5, inval, buy ? { low: 'low', high: 'high', up: 'above', down: 'below' } : { low: 'high', high: 'low', up: 'below', down: 'above' }, n => fmt(sgn * n));
    const m5Text = conf.text;
    if (conf.status !== 'confirmed') {
        return result({ ...base, m5Status: conf.status, m5Text, signalTime: last5.time + M5_SEC, reasons: [read.text, m5Text, conf.status === 'against' ? 'The ICT setup contradicts M15 or failed. WAIT.' : 'No ICT entry yet. WAIT.'] });
    }

    const entry = lastPrice;
    const extreme = sgn * (conf.extreme as number);
    const stopLoss = extreme - sgn * SL_BUFFER_ATR * atr5;
    const risk = Math.abs(entry - stopLoss);
    const wait = (why: string) => result({ ...base, m5Status: 'waiting', m5Text, signalTime: last5.time + M5_SEC, reasons: [read.text, m5Text, why] });
    if (!(risk > 0) || risk < MIN_RISK_ATR * atr5 || risk > MAX_RISK_ATR * atr5 || (buy ? stopLoss >= entry : stopLoss <= entry)) {
        return wait(`The stop distance (${fmt(risk)}) is outside the safe range of ${MIN_RISK_ATR}-${MAX_RISK_ATR} M5 ATR. WAIT.`);
    }
    const target = buy ? read.levels.resistance : read.levels.support;
    let takeProfit: number;
    let tpNote: string;
    if (target !== null && (buy ? target > entry : target < entry)) {
        const room = Math.abs(target - entry) / risk;
        if (room < MTF_MIN_RR) return wait(`Not enough room: the next M15 ${buy ? 'resistance' : 'support'} ${fmt(target)} is only 1 : ${room.toFixed(2)} away (minimum 1 : ${MTF_MIN_RR}). WAIT.`);
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
        setupId: `ICT|${plan.side}|${fmt(sgn * (conf.sweepLevel as number))}|${fmt(sgn * (conf.breakLevel as number))}`,
        m5Status: 'confirmed',
        m5Text,
        plan,
        signalTime: last5.time + M5_SEC,
        reasons: [read.text, m5Text, `Stop loss ${fmt(stopLoss)} (beyond the sweep ${buy ? 'low' : 'high'} + ${SL_BUFFER_ATR} ATR). ${tpNote}`],
    });
}
