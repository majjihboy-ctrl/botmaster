/**
 * Pure calculation for the Forex Trader tool: no React, no network.
 * Every number the chart draws and every number sent to Gemini comes from here,
 * so the levels are exact. The AI only judges quality and explains.
 *
 * Strategies 1-5 are all "liquidity sweeps": a reference range (Asian session,
 * yesterday, last week, London, New York) has one side broken, price closes
 * back inside, and the trade goes back across the range.
 */

export interface Candle {
    /** Candle open time, seconds since epoch (UTC). */
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

export type SweepStrategyId = 1 | 2 | 3 | 4 | 5;
export type MarketKind = 'forex' | 'synthetic' | 'other';
export type Side = 'BUY' | 'SELL';

export type SetupState =
    | 'no_data'
    | 'stale'
    | 'poor_market'
    | 'no_range'
    | 'waiting_bos'
    | 'waiting_for_sweep'
    | 'sweep_in_progress'
    | 'ready'
    | 'invalidated'
    | 'target_reached'
    | 'expired';

export interface RefRange {
    label: string; // e.g. "Asian"
    high: number;
    low: number;
    startTime: number;
    endTime: number; // exclusive end of the range window
    note?: string;
}

export interface Sweep {
    side: 'high' | 'low'; // which side of the range was swept
    firstBreakTime: number;
    confirmTime: number; // candle that closed back inside
    extreme: number; // highest high (high sweep) / lowest low (low sweep) during the sweep
    extremeTime: number;
}

/** Break of structure: the swing before the sweep that price must close through to confirm the reversal. */
export interface Bos {
    side: Side;
    level: number;
    swingTime: number;
    /** Candle that closed through the level; null while still waiting. */
    bosTime: number | null;
}

/** Fair value gap left by the move away from the sweep. */
export interface Fvg {
    top: number;
    bottom: number;
    startTime: number;
    endTime: number;
}

export interface Stage {
    label: string;
    state: 'done' | 'now' | 'todo';
    note?: string;
}

export interface TradePlan {
    /** true = the trade is only planned: BOS has not happened yet. */
    planned?: boolean;
    side: Side;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    midpoint: number;
    risk: number;
    reward: number;
    rr: number;
}

/** A trade that does not exist yet: what the plan would be IF that side of the range gets swept. */
export interface Scenario {
    side: Side;
    /** The range edge price has to push through and then close back inside. */
    trigger: number;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    rr: number;
    /** 'rule' = fixed rule (edge +/- 1 x ATR + small pad); 'sweep' = real sweep extreme + pad. */
    slBasis: 'rule' | 'sweep';
    /** Distance from the last price to the trigger edge. */
    distance: number;
    distanceAtr: number | null;
}

export interface WatchPlan {
    /** If the HIGH is swept -> SELL. */
    sell: Scenario;
    /** If the LOW is swept -> BUY. */
    buy: Scenario;
    /** Which edge price is closer to right now. */
    nearest: 'sell' | 'buy';
}

export interface Analysis {
    strategyId: SweepStrategyId;
    strategyName: string;
    state: SetupState;
    /** Short status shown to the person. */
    statusText: string;
    range: RefRange | null;
    sweep: Sweep | null;
    plan: TradePlan | null;
    lastPrice: number | null;
    atr: number | null;
    warnings: string[];
    candlesAnalysed: number;
    /** Planned (not active) trades, filled while waiting for or during a sweep. */
    watch: WatchPlan | null;
    /** Candles since the sweep closed back inside (confirmed setups only). */
    candlesSince: number | null;
    /** Candles left before a confirmed setup is treated as expired. */
    candlesLeft: number | null;
    /** UTC session names covering the last candle, e.g. "Asian". */
    sessionNow: string;
    lastCandleTime: number | null;
    bos: Bos | null;
    fvg: Fvg | null;
    /** Candle where price pulled back to the entry; null if not yet. */
    entryTime: number | null;
    /** The six stages of the setup, for the checklist. */
    stages: Stage[];
}

const DAY = 86400;
const WEEK = 7 * DAY;
/** After the first break, how many candles price may take to close back inside. */
const MAX_CANDLES_TO_CLOSE_BACK = 6;
/** Minimum reward:risk for a setup to count as ready (owner's rule: 1 : 2). */
export const MIN_RR = 2;
/** Candle data older than this many candle-lengths is treated as stale. */
const STALE_AFTER_CANDLES = 3;
/** Efficiency ratio (net move / total path) over the last 20 candles below this = choppy. */
const CHOPPY_BELOW = 0.1;
/** A confirmed setup older than this many candles is treated as expired. */
const SETUP_LIFETIME_CANDLES = 24;

const NAMES: Record<SweepStrategyId, string> = {
    1: 'Asian High/Low sweep',
    2: 'Previous day high/low sweep',
    3: 'Previous week high/low sweep',
    4: 'London session high/low sweep',
    5: 'New York session high/low sweep',
};
const LABELS: Record<SweepStrategyId, string> = {
    1: 'Asian',
    2: 'Prev Day',
    3: 'Prev Week',
    4: 'London',
    5: 'New York',
};
export const strategyLabel = (id: SweepStrategyId) => LABELS[id];

export function marketKind(market: string | undefined): MarketKind {
    const m = (market ?? '').toLowerCase();
    if (m === 'forex' || m === 'commodities') return 'forex';
    if (m === 'synthetic_index' || m === 'derived') return 'synthetic';
    return 'other';
}

export function startOfUtcDay(t: number): number {
    return Math.floor(t / DAY) * DAY;
}
/** Monday 00:00 UTC of the week containing t. (1970-01-01 was a Thursday.) */
export function startOfUtcWeek(t: number): number {
    const d = startOfUtcDay(t);
    const dow = (Math.floor(d / DAY) + 3) % 7; // 0 = Monday
    return d - dow * DAY;
}

export function atr(candles: Candle[], period = 14): number | null {
    if (candles.length < period + 1) return null;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const c = candles[i];
        const prevClose = candles[i - 1].close;
        sum += Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    }
    return sum / period;
}

export function sessionAt(t: number): string {
    const h = new Date(t * 1000).getUTCHours();
    if (h >= 0 && h < 7) return 'Asian';
    if (h >= 7 && h < 12) return 'London';
    if (h >= 12 && h < 16) return 'London / New York overlap';
    if (h >= 16 && h < 21) return 'New York';
    return 'Late New York / rollover';
}

function buildWatch(
    range: RefRange,
    lastPrice: number,
    atrValue: number,
    highExtreme?: number,
    lowExtreme?: number
): WatchPlan {
    // No guessing: until a side really sweeps, the stop loss follows one fixed rule
    // (edge +/- 1 x ATR(14) + a quarter ATR of room). The moment price does sweep,
    // it is replaced by the real sweep extreme + the same room.
    const pad = atrValue * 0.25;
    const sellStop = (highExtreme ?? range.high + atrValue) + pad;
    const buyStop = (lowExtreme ?? range.low - atrValue) - pad;
    const mk = (side: Side): Scenario => {
        const sell = side === 'SELL';
        const entry = sell ? range.high : range.low;
        const stopLoss = sell ? sellStop : buyStop;
        const takeProfit = sell ? range.low : range.high;
        const risk = Math.abs(stopLoss - entry);
        const distance = Math.abs(lastPrice - entry);
        const real = sell ? highExtreme !== undefined : lowExtreme !== undefined;
        return {
            side,
            trigger: entry,
            entry,
            stopLoss,
            takeProfit,
            rr: risk > 0 ? Math.abs(entry - takeProfit) / risk : 0,
            slBasis: real ? 'sweep' : 'rule',
            distance,
            distanceAtr: distance / atrValue,
        };
    };
    const sell = mk('SELL');
    const buy = mk('BUY');
    return { sell, buy, nearest: sell.distance <= buy.distance ? 'sell' : 'buy' };
}

function rangeFromWindow(
    candles: Candle[],
    start: number,
    end: number,
    label: string,
    note?: string
): RefRange | null {
    let high = -Infinity;
    let low = Infinity;
    let n = 0;
    for (const c of candles) {
        if (c.time >= start && c.time < end) {
            if (c.high > high) high = c.high;
            if (c.low < low) low = c.low;
            n++;
        }
    }
    if (n === 0 || !isFinite(high) || !isFinite(low)) return null;
    return { label, high, low, startTime: start, endTime: end, note };
}

/** Build the reference range for a strategy from the candles available. */
export function buildRange(
    strategyId: SweepStrategyId,
    candles: Candle[],
    kind: MarketKind
): { range: RefRange | null; reason?: string } {
    if (candles.length === 0) return { range: null, reason: 'No candles loaded.' };
    const last = candles[candles.length - 1];
    const lastT = last.time;
    const day = startOfUtcDay(lastT);
    const label = LABELS[strategyId];

    if (strategyId === 1) {
        if (kind === 'synthetic') {
            // Derived indices have no Asian session: use a rolling 6-hour block that
            // ended 3 hours ago, so there is room afterwards for a sweep to happen.
            const end = lastT - 3 * 3600;
            const start = end - 6 * 3600;
            const r = rangeFromWindow(candles, start, end, label, 'Derived index: no Asian session, using the 6h block that ended 3h ago');
            return r ? { range: r } : { range: null, reason: 'Not enough history for the 6-hour reference block.' };
        }
        // Forex/commodities: 00:00-06:00 GMT. If today's Asian session has not
        // finished yet, use the previous day's.
        let start = day;
        if (lastT < day + 6 * 3600) start = day - DAY;
        const r = rangeFromWindow(candles, start, start + 6 * 3600, label, 'Asian session 00:00-06:00 GMT');
        return r ? { range: r } : { range: null, reason: 'No candles inside the Asian session (00:00-06:00 GMT) yet.' };
    }

    if (strategyId === 2) {
        const r = rangeFromWindow(candles, day - DAY, day, label, "Yesterday's high and low (UTC day)");
        return r ? { range: r } : { range: null, reason: "Yesterday's candles are not in the loaded history." };
    }

    if (strategyId === 3) {
        const week = startOfUtcWeek(lastT);
        const r = rangeFromWindow(candles, week - WEEK, week, label, "Last week's high and low (Mon-Sun UTC)");
        const firstT = candles[0].time;
        if (!r || firstT > week - WEEK + DAY)
            return { range: null, reason: "Last week isn't fully in the loaded history. Use the 5m, 15m or 1h timeframe." };
        return { range: r };
    }

    if (strategyId === 4 || strategyId === 5) {
        const [h1, h2] = strategyId === 4 ? [8, 12] : [13, 17];
        const name = strategyId === 4 ? 'London 08:00-12:00 GMT' : 'New York 13:00-17:00 GMT';
        let start = day + h1 * 3600;
        // Use today's session once it has finished; otherwise the previous day's.
        if (lastT < day + h2 * 3600) start -= DAY;
        const r = rangeFromWindow(candles, start, start + (h2 - h1) * 3600, label, name);
        return r ? { range: r } : { range: null, reason: `No candles inside the ${name} window in the loaded history.` };
    }
    return { range: null, reason: 'Unknown strategy.' };
}

interface SweepScan {
    /** Every confirmed sweep after the range, oldest first. */
    all: Sweep[];
    /** A side is currently broken but price has not yet closed back inside. */
    inProgress: { side: 'high' | 'low'; extreme: number } | null;
}

/** Scan candles after the range for sweeps (break + close back inside). */
export function scanSweeps(candles: Candle[], range: RefRange): SweepScan {
    const all: Sweep[] = [];
    let open: { side: 'high' | 'low'; firstBreakTime: number; extreme: number; extremeTime: number; count: number } | null = null;

    for (const c of candles) {
        if (c.time < range.endTime) continue;
        const brokeHigh = c.high > range.high;
        const brokeLow = c.low < range.low;

        if (open) {
            // update the extreme of the running break (a later, higher wick must
            // replace the earlier one -- the stop goes beyond the true extreme)
            if (open.side === 'high' && c.high > open.extreme) {
                open.extreme = c.high;
                open.extremeTime = c.time;
            }
            if (open.side === 'low' && c.low < open.extreme) {
                open.extreme = c.low;
                open.extremeTime = c.time;
            }
            open.count++;
            const closedInside = c.close <= range.high && c.close >= range.low;
            if (closedInside) {
                all.push({
                    side: open.side,
                    firstBreakTime: open.firstBreakTime,
                    confirmTime: c.time,
                    extreme: open.extreme,
                    extremeTime: open.extremeTime,
                });
                open = null;
            } else if (open.count > MAX_CANDLES_TO_CLOSE_BACK) {
                // Price kept going: that was a real breakout, not a sweep.
                open = null;
            }
            continue;
        }

        if (brokeHigh && brokeLow) continue; // outside bar on both sides: ambiguous, skip
        if (brokeHigh || brokeLow) {
            const side = brokeHigh ? 'high' : 'low';
            const extreme = brokeHigh ? c.high : c.low;
            const closedInside = c.close <= range.high && c.close >= range.low;
            if (closedInside) {
                // wick-only sweep inside a single candle
                all.push({ side, firstBreakTime: c.time, confirmTime: c.time, extreme, extremeTime: c.time });
            } else {
                open = { side, firstBreakTime: c.time, extreme, extremeTime: c.time, count: 1 };
            }
        }
    }
    return { all, inProgress: open ? { side: open.side, extreme: open.extreme } : null };
}

/** Kaufman efficiency ratio of the last `n` closes: 1 = straight line, 0 = pure chop. */
export function efficiencyRatio(candles: Candle[], n = 20): number | null {
    if (candles.length < n + 1) return null;
    const seg = candles.slice(-(n + 1));
    let path = 0;
    for (let i = 1; i < seg.length; i++) path += Math.abs(seg[i].close - seg[i - 1].close);
    if (path === 0) return 0;
    return Math.abs(seg[seg.length - 1].close - seg[0].close) / path;
}

function candleLength(candles: Candle[]): number | null {
    if (candles.length < 2) return null;
    let best = Infinity;
    for (let i = candles.length - 1; i > 0 && i > candles.length - 10; i--) {
        const d = candles[i].time - candles[i - 1].time;
        if (d > 0 && d < best) best = d;
    }
    return isFinite(best) ? best : null;
}

type Outcome = 'live' | 'invalidated' | 'target_reached' | 'expired';

interface Evaluated {
    sweep: Sweep;
    plan: TradePlan;
    outcome: Outcome;
    candlesSince: number;
    /** What ended it, for the message. */
    why: string;
    bos: Bos;
    fvg: Fvg | null;
    entryTime: number | null;
}

/** Price without floating-point noise, for messages. */
export const px = (n: number) => String(Number(n.toPrecision(8)));

/** The most recent swing low (for a SELL) / swing high (for a BUY) before the sweep candle. */
function findSwing(candles: Candle[], idx: number, side: Side): { level: number; time: number } | null {
    const lo = Math.max(2, idx - 40);
    for (let i = idx - 3; i >= lo; i--) {
        const c = candles[i];
        const n = [candles[i - 1], candles[i - 2], candles[i + 1], candles[i + 2]];
        if (side === 'SELL' ? n.every(x => c.low < x.low) : n.every(x => c.high > x.high)) {
            return { level: side === 'SELL' ? c.low : c.high, time: c.time };
        }
    }
    const seg = candles.slice(Math.max(0, idx - 10), idx);
    if (seg.length === 0) return null;
    const pick = seg.reduce((a, b) => (side === 'SELL' ? (b.low < a.low ? b : a) : b.high > a.high ? b : a));
    return { level: side === 'SELL' ? pick.low : pick.high, time: pick.time };
}

/** First three-candle gap in the direction of the trade, from the sweep onwards. */
function findFvg(candles: Candle[], idx: number, side: Side): Fvg | null {
    for (let k = Math.max(1, idx); k < candles.length - 1; k++) {
        const a = candles[k - 1];
        const c = candles[k + 1];
        if (side === 'SELL' && a.low > c.high) return { top: a.low, bottom: c.high, startTime: a.time, endTime: c.time };
        if (side === 'BUY' && a.high < c.low) return { top: c.low, bottom: a.high, startTime: a.time, endTime: c.time };
    }
    return null;
}

/**
 * Build the trade for one sweep and say what price has done since.
 * Entry is NOT the sweep candle's close: the trade waits for confirmation (a close through the
 * swing before the sweep = break of structure) and enters on the pullback to that level.
 */
function evaluateSweep(
    range: RefRange,
    sweep: Sweep,
    candles: Candle[],
    atrValue: number,
    forming?: Candle | null
): Evaluated {
    const pad = atrValue * 0.25;
    const side: Side = sweep.side === 'high' ? 'SELL' : 'BUY';
    const sell = side === 'SELL';
    const idxExt = candles.findIndex(c => c.time === sweep.extremeTime);
    const confirmCandle = candles.find(c => c.time === sweep.confirmTime)!;
    const swing = idxExt >= 3 ? findSwing(candles, idxExt, side) : null;
    const level = swing ? swing.level : confirmCandle.close;
    const stopLoss = sell ? sweep.extreme + pad : sweep.extreme - pad;
    const takeProfit = sell ? range.low : range.high;
    const risk = Math.abs(stopLoss - level);
    const reward = Math.abs(level - takeProfit);
    const plan: TradePlan = {
        side,
        entry: level,
        stopLoss,
        takeProfit,
        midpoint: (range.high + range.low) / 2,
        risk,
        reward,
        rr: risk > 0 ? reward / risk : 0,
    };
    const bos: Bos = { side, level, swingTime: swing ? swing.time : confirmCandle.time, bosTime: swing ? null : confirmCandle.time };

    const seq = candles.filter(c => c.time >= sweep.extremeTime);
    if (forming && forming.time > sweep.extremeTime) seq.push(forming);

    let entryTime: number | null = null;
    let candlesSince = 0;
    const done = (outcome: Outcome, why: string): Evaluated => ({
        sweep,
        plan: { ...plan, planned: bos.bosTime === null },
        outcome,
        candlesSince,
        why,
        bos,
        fvg: findFvg(candles, idxExt, side),
        entryTime,
    });

    for (const c of seq) {
        const isForming = c === forming;
        if (c.time <= sweep.confirmTime) {
            // candles inside the sweep itself: a close through the swing here already confirms the BOS
            if (!isForming && bos.bosTime === null && (sell ? c.close < level : c.close > level) && c.time === sweep.confirmTime) {
                bos.bosTime = c.time;
            }
            continue;
        }
        if (!isForming) candlesSince++;
        // Breaking the sweep point (its high/low) means it was a real breakout, not a sweep.
        const brokeSweepPoint = sell ? c.high > sweep.extreme : c.low < sweep.extreme;
        const hitSL = sell ? c.high >= plan.stopLoss : c.low <= plan.stopLoss;
        if (brokeSweepPoint || hitSL) {
            return done('invalidated', `price broke the sweep ${sweep.side} at ${px(sweep.extreme)}: a real breakout, not a sweep`);
        }
        const hitTP = sell ? c.low <= plan.takeProfit : c.high >= plan.takeProfit;
        if (bos.bosTime === null) {
            if (!isForming && (sell ? c.close < level : c.close > level)) bos.bosTime = c.time;
            else if (hitTP) return done('target_reached', 'price reached the target without a break of structure');
            continue;
        }
        if (entryTime === null && c.time > bos.bosTime) {
            if (sell ? c.high >= level : c.low <= level) entryTime = c.time;
            else if (hitTP) return done('target_reached', 'price went straight to the target without a pullback: the entry was missed');
        }
        if (entryTime !== null && hitTP) return done('target_reached', 'target reached');
    }
    if (candlesSince > SETUP_LIFETIME_CANDLES) {
        return done('expired', bos.bosTime === null ? 'no break of structure came in time' : 'the sweep is too old to act on');
    }
    return done('live', '');
}

function buildStages(out: Analysis, inProgressNow: boolean): Stage[] {
    const r = out.range;
    const sw = out.sweep;
    const bos = out.bos;
    const dir = sw ? (sw.side === 'high' ? 'below' : 'above') : '';
    const st = (done: boolean, now: boolean): Stage['state'] => (done ? 'done' : now ? 'now' : 'todo');
    const swept = !!sw;
    const bosDone = !!bos && bos.bosTime !== null;
    const entered = out.entryTime !== null;
    const finished = ['invalidated', 'target_reached', 'expired'].includes(out.state);
    return [
        { label: r ? `Range marked (${r.label}: ${px(r.low)} to ${px(r.high)})` : 'Range marked', state: st(!!r, !r) },
        { label: 'Liquidity sweep wick (high or low taken)', state: st(swept, !swept && inProgressNow) },
        { label: 'A candle closes back inside the range', state: st(swept, false) },
        {
            label: bos ? `Break of structure (a close ${dir} ${px(bos.level)})` : 'Break of structure (BOS)',
            state: st(bosDone, swept && !bosDone && !finished),
        },
        {
            label: out.plan ? `Pullback to the entry (${px(out.plan.entry)})` : 'Pullback to the entry',
            state: st(entered, bosDone && !entered && !finished),
        },
        {
            label: finished ? `Result: ${out.statusText}` : 'Stop loss and target in play',
            state: finished ? 'done' : entered ? 'now' : 'todo',
        },
    ];
}

export function analyse(
    strategyId: SweepStrategyId,
    candles: Candle[],
    kind: MarketKind,
    /** The candle still forming right now (not closed yet). Used only for live price and to
     *  show a break in progress; a sweep is never confirmed until a candle has closed. */
    forming?: Candle | null,
    /** Current time in seconds (for the stale-data check). Omit to skip that check. */
    now?: number
): Analysis {
    const base: Analysis = {
        strategyId,
        strategyName: NAMES[strategyId],
        state: 'no_data',
        statusText: 'No candle data yet',
        range: null,
        sweep: null,
        plan: null,
        lastPrice: forming ? forming.close : candles.length ? candles[candles.length - 1].close : null,
        atr: atr(candles),
        warnings: [],
        candlesAnalysed: candles.length,
        watch: null,
        candlesSince: null,
        candlesLeft: null,
        sessionNow: candles.length ? sessionAt(candles[candles.length - 1].time) : '',
        lastCandleTime: candles.length ? candles[candles.length - 1].time : null,
        bos: null,
        fvg: null,
        entryTime: null,
        stages: [],
    };
    if (candles.length < 20) {
        base.warnings.push('Fewer than 20 candles loaded: not enough to analyse.');
        return base;
    }

    // Stale data: the newest candle should be at most a few candle-lengths old.
    const len = candleLength(candles);
    const lastT = candles[candles.length - 1].time;
    if (now !== undefined && len && now - (lastT + len) > STALE_AFTER_CANDLES * len) {
        const ageMin = Math.round((now - (lastT + len)) / 60);
        return {
            ...base,
            state: 'stale',
            statusText: `Waiting for fresh data: the newest candle is ${ageMin} min old`,
            warnings: ['The market feed is not delivering new candles (market closed or feed problem). Nothing is analysed on old data.'],
        };
    }

    const { range, reason } = buildRange(strategyId, candles, kind);
    if (!range) {
        return { ...base, state: 'no_range', statusText: 'No reference range yet', warnings: [reason ?? 'No range.'] };
    }
    const out: Analysis = { ...base, range };
    const atrValue = base.atr as number;
    const rangeSize = range.high - range.low;

    const scan = scanSweeps(candles, range);
    let inProgress = scan.inProgress;
    if (!inProgress && forming && forming.time >= range.endTime) {
        // Live: the forming candle is already beyond one edge of the range.
        const hi = forming.high > range.high;
        const lo = forming.low < range.low;
        if (hi !== lo) {
            inProgress = hi ? { side: 'high', extreme: forming.high } : { side: 'low', extreme: forming.low };
        }
    }
    const lastC = candles[candles.length - 1];
    const priceNow = forming ? forming.close : lastC.close;

    // Walk the sweeps oldest to newest. A side whose sweep point was later broken is "dead":
    // price went through it, so a later close back inside is NOT a fresh setup.
    const dead = new Set<'high' | 'low'>();
    let current: Evaluated | null = null;
    for (const sw of scan.all) {
        if (dead.has(sw.side)) continue;
        const ev = evaluateSweep(range, sw, candles, atrValue, forming);
        if (ev.outcome === 'invalidated') dead.add(sw.side);
        current = ev;
    }

    if (!current) {
        out.watch = buildWatch(
            range,
            priceNow,
            atrValue,
            inProgress?.side === 'high' ? inProgress.extreme : undefined,
            inProgress?.side === 'low' ? inProgress.extreme : undefined
        );
        if (inProgress) {
            out.state = 'sweep_in_progress';
            out.statusText = `${range.label} ${inProgress.side === 'high' ? 'High' : 'Low'} is being swept: waiting for a candle to close back inside`;
            out.stages = buildStages(out, true);
            return out;
        }
        out.state = 'waiting_for_sweep';
        out.statusText = 'Waiting for the point of view: no sweep of the range yet';
        out.stages = buildStages(out, false);
        return out;
    }

    out.sweep = current.sweep;
    out.plan = current.plan;
    out.bos = current.bos;
    out.fvg = current.fvg;
    out.entryTime = current.entryTime;
    out.candlesSince = current.candlesSince;
    out.candlesLeft = Math.max(0, SETUP_LIFETIME_CANDLES - current.candlesSince);
    const plan = current.plan;
    const sell = plan.side === 'SELL';

    const finish = (state: SetupState, text: string): Analysis => {
        out.state = state;
        out.statusText = text;
        out.stages = buildStages(out, false);
        return out;
    };

    if (current.outcome === 'invalidated') return finish('invalidated', `Setup invalidated: ${current.why}`);
    if (current.outcome === 'target_reached') return finish('target_reached', `Setup finished: ${current.why}`);
    if (current.outcome === 'expired') return finish('expired', `Setup expired: ${current.why}`);

    if (current.bos.bosTime === null) {
        out.warnings.push('Not a trade yet: wait for a candle to close through the BOS level before placing anything.');
        return finish(
            'waiting_bos',
            `${range.label} ${current.sweep.side === 'high' ? 'High' : 'Low'} swept and price closed back inside: waiting for a break of structure (a candle closing ${sell ? 'below' : 'above'} ${px(current.bos.level)})`
        );
    }

    // BOS confirmed. Before calling it ready it must pass the market-quality rules.
    const reasons: string[] = [];
    if (plan.rr < MIN_RR) reasons.push(`reward is only 1 : ${plan.rr.toFixed(2)} (minimum is 1 : ${MIN_RR})`);
    if (rangeSize < atrValue) reasons.push('the reference range is narrower than one average candle (ATR)');
    const er = efficiencyRatio(candles);
    if (er !== null && er < CHOPPY_BELOW) reasons.push(`the market is choppy (efficiency ${er.toFixed(2)}, needs ${CHOPPY_BELOW} or more)`);
    if (current.entryTime === null) {
        const ran = sell ? (plan.entry - priceNow) / (plan.reward || 1) : (priceNow - plan.entry) / (plan.reward || 1);
        if (ran > 0.5) reasons.push('price already ran over half-way to the target without pulling back, so the entry is late');
    }
    if (reasons.length > 0) {
        out.warnings.push(...reasons.map(r => r.charAt(0).toUpperCase() + r.slice(1) + '.'));
        return finish('poor_market', `Waiting for the market to be good: ${reasons.join('; ')}`);
    }
    return finish(
        'ready',
        current.entryTime !== null
            ? `${plan.side} entry reached at ${px(plan.entry)}: the trade is live`
            : `${plan.side} setup ready: enter ${plan.side} when price pulls back to ${px(plan.entry)} (the BOS level)`
    );
}
