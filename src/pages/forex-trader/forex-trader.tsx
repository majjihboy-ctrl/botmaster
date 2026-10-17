import { useCallback, useEffect, useRef, useState } from 'react';
import { useDerivWS } from './deriv-ws/use-deriv-ws';
import MarketPicker from './market-picker';
import ChartView, { type ChartViewHandle } from './chart-view';
import { analyse, marketKind, MIN_RR, type Analysis, type Candle, type SweepStrategyId } from './engine';
import { STRATEGIES, STRATEGY_CATEGORIES } from './strategies';
import { analyseMtf, M15_SEC, M5_SEC, type MtfResult } from './mtf';
import MtfPanel from './mtf-panel';
import './forex-trader.scss';
import './forex-trader-premium.scss';

interface SymbolInfo {
    underlying_symbol: string;
    underlying_symbol_name: string;
    market: string;
    market_display_name?: string;
    submarket_display_name?: string;
    pip_size: number;
    exchange_is_open: number;
    is_trading_suspended: number;
}

interface AiResult {
    status: 'waiting_for_market' | 'waiting_for_pov' | 'buy_ready' | 'sell_ready' | 'invalidated';
    confidence: number;
    reasoning: string;
    warnings: string[];
    model?: string;
}

interface Outcome {
    analysis: Analysis;
    ai: AiResult | null;
    aiError: string | null;
    /** The analysis state the AI answer belongs to; a different key means the AI answer is out of date. */
    aiKey: string | null;
    /** The state key of the analysis currently shown. */
    key: string;
    at: number;
}

const TIMEFRAMES = [
    { label: '1m', sec: 60 },
    { label: '5m', sec: 300 },
    { label: '15m', sec: 900 },
    { label: '1h', sec: 3600 },
];

const STATUS_TEXT: Record<AiResult['status'], string> = {
    waiting_for_market: 'Waiting for the market to be good',
    waiting_for_pov: 'Waiting for the point of view',
    buy_ready: 'BUY setup ready',
    sell_ready: 'SELL setup ready',
    invalidated: 'Setup invalidated',
};

/** The words shown on the pill/badge: the five agreed statuses, with exact wording for finished or stale setups. */
function statusLabel(status: AiResult['status'], a: Analysis): string {
    if (a.state === 'target_reached') return 'Target reached: setup finished';
    if (a.state === 'expired') return 'Setup expired';
    if (a.state === 'stale') return 'Waiting for fresh data';
    return STATUS_TEXT[status];
}

/** Status shown when the AI is unavailable: based on the code's own result. */
function codeStatus(a: Analysis): AiResult['status'] {
    switch (a.state) {
        case 'ready':
            return a.plan?.side === 'BUY' ? 'buy_ready' : 'sell_ready';
        case 'waiting_for_sweep':
        case 'sweep_in_progress':
        case 'waiting_bos':
            return 'waiting_for_pov';
        case 'invalidated':
        case 'target_reached':
        case 'expired':
            return 'invalidated';
        default:
            return 'waiting_for_market';
    }
}

interface CheckItem {
    label: string;
    state: 'yes' | 'no' | 'wait';
}

function checklist(a: Analysis, marketClosed: boolean): CheckItem[] {
    const items: CheckItem[] = [
        { label: 'Market is open', state: marketClosed ? 'no' : 'yes' },
        { label: 'Data is fresh (new candles are arriving)', state: a.state === 'stale' ? 'no' : 'yes' },
    ];
    if (a.plan) {
        items.push({
            label: `Reward at least 1 : ${MIN_RR} (now 1 : ${a.plan.rr.toFixed(2)})`,
            state: a.plan.rr >= MIN_RR ? 'yes' : 'no',
        });
        items.push({
            label: 'Market is not choppy and the range is wide enough',
            state: a.state === 'poor_market' ? 'no' : 'yes',
        });
        items.push({
            label: 'Setup still valid (sweep point not broken, target not reached, not expired)',
            state: ['invalidated', 'target_reached', 'expired'].includes(a.state) ? 'no' : 'yes',
        });
    } else {
        items.push({ label: 'Entry, stop loss and take profit (they appear after the sweep and the BOS)', state: 'wait' });
    }
    return items;
}

const fmtTime = (t: number) => {
    const d = new Date(t * 1000);
    return `${d.toUTCString().slice(5, 11)} ${d.toISOString().slice(11, 16)} GMT`;
};

/** A planned trade, reported to a page that draws it on its own chart (Forex Live). */
export interface ReportedPlan {
    side: 'BUY' | 'SELL';
    entry: number;
    stopLoss: number;
    takeProfit: number;
}

interface ForexTraderProps {
    variant?: 'page' | 'panel';
    panelWidth?: number;
    /** When given, this market is shown and follows the value (a parent page owns the market choice). */
    controlledSymbol?: string;
    /** Called when the person picks a market inside the tool. */
    onSymbolChange?: (symbol: string) => void;
    /** Called whenever the plan (entry, stop loss, take profit) changes; null when there is none. */
    onPlan?: (plan: ReportedPlan | null, symbol: string) => void;
    /** Start in the M15 analysis + M5 entry mode instead of the H1 strategies. */
    initialMode?: 'h1' | 'mtf';
    /** Keep the tool's own chart out of sight (it still runs, so the analysis is identical). */
    hideChart?: boolean;
}

const ForexTrader = ({ variant = 'page', panelWidth, controlledSymbol, onSymbolChange, onPlan, initialMode, hideChart }: ForexTraderProps) => {
    const { ws, isConnected } = useDerivWS();
    const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
    const [symbol, setSymbol] = useState(controlledSymbol ?? 'R_25');
    const [tf, setTf] = useState(3600);
    const [category, setCategory] = useState(STRATEGY_CATEGORIES[0]);
    const [strategyId, setStrategyId] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [lastPrice, setLastPrice] = useState<number | null>(null);
    const [live, setLive] = useState(true);
    const [aiBusy, setAiBusy] = useState(false);
    // 'h1' = the existing strategies exactly as before; 'mtf' = M15 direction + M5 entry (additional mode)
    const [mode, setMode] = useState<'h1' | 'mtf'>(initialMode ?? 'h1');
    const [mtf, setMtf] = useState<MtfResult | null>(null);
    const [m15Ready, setM15Ready] = useState(false);
    const [m15Error, setM15Error] = useState<string | null>(null);
    const m15Ref = useRef<Candle[]>([]);

    const chartRef = useRef<ChartViewHandle>(null);
    const candlesRef = useRef<Candle[]>([]);
    const wrapRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const [fitHeight, setFitHeight] = useState<number | null>(null);

    // ---- keep the page exactly as tall as the visible area (same approach as the Analysis Tool)
    useEffect(() => {
        const measure = () => {
            const el = rootRef.current;
            if (variant === 'panel' || !el || window.innerWidth > 900) return setFitHeight(null);
            const vh = window.visualViewport?.height ?? window.innerHeight;
            setFitHeight(Math.max(320, Math.floor(vh - el.getBoundingClientRect().top)));
        };
        measure();
        const t = window.setTimeout(measure, 300);
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        window.visualViewport?.addEventListener('resize', measure);
        return () => {
            window.clearTimeout(t);
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
            window.visualViewport?.removeEventListener('resize', measure);
        };
    }, [variant]);

    // ---- a parent page can own the market choice
    useEffect(() => {
        if (controlledSymbol && controlledSymbol !== symbol) setSymbol(controlledSymbol);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [controlledSymbol]);

    // ---- tell a parent page about the current plan (so it can draw it on its chart)
    const onPlanRef = useRef(onPlan);
    onPlanRef.current = onPlan;
    useEffect(() => {
        if (!onPlanRef.current) return;
        const p = mode === 'mtf' ? mtf?.plan : outcome?.analysis.plan;
        const usable = p && Number.isFinite(p.entry) && Number.isFinite(p.stopLoss) && Number.isFinite(p.takeProfit);
        onPlanRef.current(usable ? { side: p.side, entry: p.entry, stopLoss: p.stopLoss, takeProfit: p.takeProfit } : null, symbol);
    }, [mode, mtf, outcome, symbol]);

    // ---- markets list
    useEffect(() => {
        if (!ws || !isConnected) return;
        let off = false;
        ws.send<{ active_symbols?: SymbolInfo[] }>({ active_symbols: 'full' })
            .then(res => {
                if (off) return;
                const list = (res.active_symbols ?? []).filter(s => s.underlying_symbol);
                setSymbols(list);
            })
            .catch(() => {});
        return () => {
            off = true;
        };
    }, [ws, isConnected]);

    const info = symbols.find(s => s.underlying_symbol === symbol);
    const pipSize = info ? Math.max(0, Math.round(-Math.log10(info.pip_size || 0.01))) : 2;
    const kind = marketKind(info?.market);
    const closed = !!info && (info.exchange_is_open === 0 || info.is_trading_suspended === 1);

    // ---- candles (history + live)
    useEffect(() => {
        if (!ws || !isConnected || !symbol) return;
        let off = false;
        let unsub: (() => void) | null = null;
        setLoading(true);
        setLoadError(null);
        setOutcome(null);
        setMtf(null);
        chartRef.current?.drawAnalysis(null, []);
        candlesRef.current = [];
        // M15 + M5 mode draws the M5 chart (the entry timeframe) with about 2 days of history
        const effTf = mode === 'mtf' ? M5_SEC : tf;
        const count = Math.min(5000, Math.ceil(((mode === 'mtf' ? 2 : 15) * 86400) / effTf));

        ws.subscribe(
            { ticks_history: symbol, style: 'candles', granularity: effTf, end: 'latest', count, adjust_start_time: 1 },
            data => {
                if (off) return;
                const d = data as {
                    error?: { message?: string };
                    candles?: Array<{ epoch: number; open: number; high: number; low: number; close: number }>;
                    ohlc?: { open_time: number; open: string | number; high: string | number; low: string | number; close: string | number };
                };
                if (d.error) {
                    setLoadError(d.error.message ?? 'Could not load candles');
                    setLoading(false);
                    return;
                }
                if (d.candles) {
                    const list: Candle[] = d.candles.map(c => ({
                        time: c.epoch,
                        open: Number(c.open),
                        high: Number(c.high),
                        low: Number(c.low),
                        close: Number(c.close),
                    }));
                    candlesRef.current = list;
                    chartRef.current?.setCandles(list);
                    drawKey.current = '';
                    setLastPrice(list.length ? list[list.length - 1].close : null);
                    setLoading(false);
                } else if (d.ohlc) {
                    const c: Candle = {
                        time: Number(d.ohlc.open_time),
                        open: Number(d.ohlc.open),
                        high: Number(d.ohlc.high),
                        low: Number(d.ohlc.low),
                        close: Number(d.ohlc.close),
                    };
                    const arr = candlesRef.current;
                    const last = arr[arr.length - 1];
                    if (last && last.time === c.time) arr[arr.length - 1] = c;
                    else if (!last || c.time > last.time) arr.push(c);
                    chartRef.current?.updateCandle(c);
                    setLastPrice(c.close);
                    liveTick.current();
                }
            }
        )
            .then(sub => {
                if (off) sub.unsubscribe();
                else unsub = sub.unsubscribe;
            })
            .catch(err => {
                if (!off) {
                    setLoadError(err instanceof Error ? err.message : 'Connection error');
                    setLoading(false);
                }
            });

        return () => {
            off = true;
            if (unsub) unsub();
        };
    }, [ws, isConnected, symbol, tf, mode]);

    // ---- M15 candles (only in the M15 + M5 mode): the direction timeframe, with its own live feed
    useEffect(() => {
        if (mode !== 'mtf' || !ws || !isConnected || !symbol) return;
        let off = false;
        let unsub: (() => void) | null = null;
        m15Ref.current = [];
        setM15Ready(false);
        setM15Error(null);
        ws.subscribe(
            { ticks_history: symbol, style: 'candles', granularity: M15_SEC, end: 'latest', count: 400, adjust_start_time: 1 },
            data => {
                if (off) return;
                const d = data as {
                    error?: { message?: string };
                    candles?: Array<{ epoch: number; open: number; high: number; low: number; close: number }>;
                    ohlc?: { open_time: number; open: string | number; high: string | number; low: string | number; close: string | number };
                };
                if (d.error) {
                    setM15Error(d.error.message ?? 'Could not load M15 candles');
                    return;
                }
                if (d.candles) {
                    m15Ref.current = d.candles.map(c => ({ time: c.epoch, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) }));
                    setM15Ready(true);
                    liveTick.current();
                } else if (d.ohlc) {
                    const c: Candle = { time: Number(d.ohlc.open_time), open: Number(d.ohlc.open), high: Number(d.ohlc.high), low: Number(d.ohlc.low), close: Number(d.ohlc.close) };
                    const arr = m15Ref.current;
                    const last = arr[arr.length - 1];
                    if (last && last.time === c.time) arr[arr.length - 1] = c;
                    else if (!last || c.time > last.time) arr.push(c);
                }
            }
        )
            .then(sub => {
                if (off) sub.unsubscribe();
                else unsub = sub.unsubscribe;
            })
            .catch(err => {
                if (!off) setM15Error(err instanceof Error ? err.message : 'Connection error');
            });
        return () => {
            off = true;
            if (unsub) unsub();
        };
    }, [ws, isConnected, symbol, mode]);

    const categoryStrategies = STRATEGIES.filter(s => s.category === category);
    const strategy = STRATEGIES.find(s => s.id === strategyId);
    const canAnalyse = !!strategy?.ready && !loading && !loadError && !closed && !aiBusy && isConnected;

    // ---- live analysis -------------------------------------------------------
    // The latest values, readable from the candle stream callback below without
    // re-subscribing every time something changes.
    const ctx = useRef({ strategy, tf, kind, info, symbol, live, closed, mode });
    ctx.current = { strategy, tf, kind, info, symbol, live, closed, mode };
    const outcomeRef = useRef<Outcome | null>(null);
    outcomeRef.current = outcome;
    const drawKey = useRef('');
    const aiRun = useRef<{ lastCall: number; timer: number | null; lastKey: string }>({ lastCall: 0, timer: null, lastKey: '' });
    const liveTick = useRef<() => void>(() => {});

    const compute = () => {
        const c = ctx.current;
        if (!c.strategy?.ready) return null;
        const now = Math.floor(Date.now() / 1000);
        const all = candlesRef.current;
        const closedCandles = all.filter(x => x.time + c.tf <= now);
        const forming = all.find(x => x.time + c.tf > now) ?? null;
        const analysis = analyse(c.strategy.id as SweepStrategyId, closedCandles, c.kind, forming, now);
        const lastClosed = closedCandles.length ? closedCandles[closedCandles.length - 1].time : 0;
        // changes when the situation really changes: new closed candle, new state, new sweep
        const key = `${c.symbol}|${c.tf}|${c.strategy.id}|${analysis.state}|${analysis.sweep?.confirmTime ?? ''}|${lastClosed}`;
        return { analysis, closedCandles, key };
    };

    const drawIfChanged = (analysis: Analysis, closedCandles: Candle[]) => {
        const n = (v: number | undefined) => (v === undefined ? '' : v.toFixed(8));
        const sig = [
            analysis.state,
            n(analysis.range?.high),
            n(analysis.range?.low),
            analysis.sweep?.confirmTime,
            n(analysis.sweep?.extreme),
            n(analysis.plan?.stopLoss),
            n(analysis.watch?.sell.stopLoss),
            n(analysis.watch?.buy.stopLoss),
            closedCandles.length,
        ].join('|');
        if (sig !== drawKey.current) {
            drawKey.current = sig;
            chartRef.current?.drawAnalysis(analysis, closedCandles);
        }
    };

    const runAi = async () => {
        const r = compute();
        if (!r) return;
        const { analysis, closedCandles, key } = r;
        aiRun.current.lastKey = key;
        aiRun.current.lastCall = Date.now();
        setAiBusy(true);
        try {
            drawIfChanged(analysis, closedCandles);
            await new Promise(res => requestAnimationFrame(() => res(null)));
            const image = chartRef.current?.screenshot() ?? null;
            const c = ctx.current;
            let ai: AiResult | null = null;
            let aiError: string | null = null;
            try {
                const resp = await fetch('/api/forex-analyse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image,
                        // the last 100 closed candles as [time, open, high, low, close]
                        candles: closedCandles.slice(-100).map(k => [k.time, k.open, k.high, k.low, k.close]),
                        meta: {
                            market: c.info?.underlying_symbol_name ?? c.symbol,
                            symbol: c.symbol,
                            timeframe: TIMEFRAMES.find(t => t.sec === c.tf)?.label,
                            marketType: c.kind,
                            utcNow: new Date().toISOString(),
                        },
                        analysis: {
                            strategy: analysis.strategyName,
                            state: analysis.state,
                            status: analysis.statusText,
                            range: analysis.range,
                            sweep: analysis.sweep,
                            plan: analysis.plan,
                            lastPrice: analysis.lastPrice,
                            atr: analysis.atr,
                            warnings: analysis.warnings,
                            plannedTrades: analysis.watch,
                            bos: analysis.bos,
                            fairValueGap: analysis.fvg,
                            entryTime: analysis.entryTime,
                            stages: analysis.stages,
                            session: analysis.sessionNow,
                        },
                    }),
                });
                const json = await resp.json().catch(() => ({}));
                if (resp.ok) ai = json as AiResult;
                else aiError = `${json?.error ?? 'AI review unavailable.'} (code ${json?.code ?? resp.status})`;
            } catch {
                aiError = 'AI review unavailable (no connection to the server).';
            }
            setOutcome(o => (o ? { ...o, ai, aiError, aiKey: key } : o));
        } finally {
            setAiBusy(false);
        }
    };

    const scheduleAi = (force: boolean) => {
        const st = aiRun.current;
        const wait = Math.max(0, (force ? 3000 : 15000) - (Date.now() - st.lastCall));
        if (st.timer) window.clearTimeout(st.timer);
        st.timer = window.setTimeout(() => {
            st.timer = null;
            runAi();
        }, wait);
    };

    /** Recalculate everything from the live candles; ask the AI again only when the situation changed. */
    const refresh = (force: boolean) => {
        const r = compute();
        if (!r) return;
        const { analysis, closedCandles, key } = r;
        drawIfChanged(analysis, closedCandles);
        setOutcome(o => ({
            analysis,
            ai: o?.ai ?? null,
            aiError: o?.aiError ?? null,
            aiKey: o?.aiKey ?? null,
            key,
            at: Date.now(),
        }));
        if (force || key !== aiRun.current.lastKey) {
            aiRun.current.lastKey = key;
            scheduleAi(force);
        }
    };

    // every price update from the feed (at most once a second)
    const lastTickAt = useRef(0);
    const tickTimer = useRef<number | null>(null);
    const mtfCompute = () => {
        if (ctx.current.mode !== 'mtf') return;
        setMtf(analyseMtf(m15Ref.current, candlesRef.current, Math.floor(Date.now() / 1000)));
    };
    liveTick.current = () => {
        const c = ctx.current;
        if (c.mode === 'mtf') {
            // M15 + M5 mode: recalculate from the real closed candles, at most once a second
            if (!c.live || c.closed) return;
            const wait = 1000 - (Date.now() - lastTickAt.current);
            if (wait <= 0) {
                lastTickAt.current = Date.now();
                mtfCompute();
            } else if (!tickTimer.current) {
                tickTimer.current = window.setTimeout(() => {
                    tickTimer.current = null;
                    lastTickAt.current = Date.now();
                    mtfCompute();
                }, wait);
            }
            return;
        }
        if (!c.live || !c.strategy?.ready || c.closed) return;
        const wait = 1000 - (Date.now() - lastTickAt.current);
        if (wait <= 0) {
            lastTickAt.current = Date.now();
            refresh(false);
        } else if (!tickTimer.current) {
            tickTimer.current = window.setTimeout(() => {
                tickTimer.current = null;
                lastTickAt.current = Date.now();
                refresh(false);
            }, wait);
        }
    };

    // First analysis happens by itself as soon as candles are loaded, and again when the
    // person changes market, timeframe or strategy; no button press needed.
    useEffect(() => {
        if (mode !== 'h1') return;
        if (loading || loadError || closed || !strategy?.ready || !isConnected) return;
        aiRun.current.lastKey = '';
        drawKey.current = '';
        refresh(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, loadError, closed, strategyId, kind, symbol, tf, isConnected, mode]);

    // M15 + M5 mode: first calculation as soon as both timeframes are loaded
    useEffect(() => {
        if (mode !== 'mtf' || loading || loadError || closed || !m15Ready || !isConnected) return;
        mtfCompute();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, loading, loadError, closed, m15Ready, symbol, isConnected]);

    useEffect(
        () => () => {
            if (aiRun.current.timer) window.clearTimeout(aiRun.current.timer);
            if (tickTimer.current) window.clearTimeout(tickTimer.current);
        },
        []
    );

    const runAnalysis = useCallback(() => {
        refresh(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const aiCurrent = !!outcome?.ai && outcome.aiKey === outcome.key;
    // The code's rules decide whether a trade is ready. The AI may only make the call more careful, never less.
    const codeSt: AiResult['status'] | null = outcome ? codeStatus(outcome.analysis) : null;
    const isReady = (st: AiResult['status'] | null) => st === 'buy_ready' || st === 'sell_ready';
    const aiSt = aiCurrent ? outcome!.ai!.status : null;
    const status: AiResult['status'] | null = !outcome ? null : aiSt && isReady(codeSt) ? aiSt : codeSt;
    const conflict =
        outcome && codeSt && aiSt && aiSt !== codeSt
            ? isReady(codeSt)
                ? ('careful' as const)
                : isReady(aiSt)
                  ? ('eager' as const)
                  : ('wait' as const)
            : null;
    const plan = outcome?.analysis.plan;
    const fmt = (n: number) => n.toFixed(pipSize);
    const tone = status === 'buy_ready' ? 'buy' : status === 'sell_ready' ? 'sell' : status === 'invalidated' ? 'bad' : 'wait';

    return (
        <div
            ref={rootRef}
            className={`forex-trader${variant === 'panel' ? ' forex-trader--panel' : ''}${panelWidth && panelWidth >= 640 ? ' forex-trader--wide' : ''}${hideChart ? ' forex-trader--chart-hidden' : ''}`}
            style={fitHeight ? { height: `${fitHeight}px` } : undefined}
        >
            <div className='forex-trader__controls'>
                <MarketPicker
                    symbols={symbols}
                    value={symbol}
                    onChange={s => {
                        setSymbol(s);
                        onSymbolChange?.(s);
                    }}
                />
                <label>
                    <span>Mode</span>
                    <select value={mode} onChange={e => setMode(e.target.value as 'h1' | 'mtf')}>
                        <option value='h1'>H1 strategies (existing)</option>
                        <option value='mtf'>M15 analysis + M5 entry</option>
                    </select>
                </label>
                {mode === 'h1' && (
                <>
                <label className='forex-trader__tf'>
                    <span>Timeframe</span>
                    <select value={tf} onChange={e => setTf(Number(e.target.value))}>
                        {TIMEFRAMES.map(t => (
                            <option key={t.sec} value={t.sec}>
                                {t.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Category</span>
                    <select
                        value={category}
                        onChange={e => {
                            setCategory(e.target.value);
                            const first = STRATEGIES.find(s => s.category === e.target.value && s.ready);
                            setStrategyId((first ?? STRATEGIES.find(s => s.category === e.target.value))!.id);
                        }}
                    >
                        {STRATEGY_CATEGORIES.map(c => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Strategy</span>
                    <select value={strategyId} onChange={e => setStrategyId(Number(e.target.value))}>
                        {categoryStrategies.map(s => (
                            <option key={s.id} value={s.id} disabled={!s.ready}>
                                {s.id}. {s.name}
                                {s.ready ? '' : ' — coming soon'}
                            </option>
                        ))}
                    </select>
                </label>
                <button type='button' className='forex-trader__analyse-btn' disabled={!canAnalyse} onClick={runAnalysis}>
                    {aiBusy ? 'Reviewing…' : 'Re-analyse'}
                </button>
                </>
                )}
            </div>

            <div
                className='forex-trader__chart-wrap'
                ref={wrapRef}
                style={
                    panelWidth && panelWidth > 380
                        ? (() => {
                              // a wider panel gets a taller chart too (never taller than 62% of the screen)
                              const h = Math.max(290, Math.min(Math.round(panelWidth * 0.62), Math.round(window.innerHeight * 0.62)));
                              return { height: `${h}px`, minHeight: `${h}px` };
                          })()
                        : undefined
                }
            >
                <ChartView ref={chartRef} pipSize={pipSize} />
                <div className='forex-trader__chart-info'>
                    <b>{info?.underlying_symbol_name ?? symbol}</b>
                    <span>{mode === 'mtf' ? 'M15 + M5' : TIMEFRAMES.find(t => t.sec === tf)?.label}</span>
                    {lastPrice !== null && <span>{fmt(lastPrice)}</span>}
                    <em>times in GMT</em>
                </div>
                <button
                    type='button'
                    className={`forex-trader__live${live ? ' is-on' : ''}`}
                    onClick={() => setLive(l => !l)}
                    title={live ? 'Updating on every price change. Tap to pause.' : 'Paused. Tap to resume.'}
                >
                    {live ? '● LIVE' : '❚❚ PAUSED'}
                </button>
                {loading && !loadError && <div className='forex-trader__overlay'>Loading chart…</div>}
                {loadError && <div className='forex-trader__overlay forex-trader__overlay--error'>{loadError}</div>}
                {closed && !loadError && (
                    <div className='forex-trader__overlay forex-trader__overlay--closed'>
                        Market closed — no live analysis. Pick an open market (Derived indices run all week).
                    </div>
                )}
                {mode === 'mtf' && mtf && !closed && !loadError && (
                    <div className={`forex-trader__badge forex-trader__badge--${mtf.signal === 'BUY' ? 'buy' : mtf.signal === 'SELL' ? 'sell' : 'wait'}`}>
                        {mtf.signal === 'WAIT' ? 'WAIT / NO SIGNAL' : `${mtf.signal} signal`}
                    </div>
                )}
                {mode === 'h1' && status && (
                    <div className={`forex-trader__badge forex-trader__badge--${tone}`}>{outcome && statusLabel(status, outcome.analysis)}</div>
                )}
            </div>

            <div className='forex-trader__result'>
                {mode === 'mtf' && (
                    <MtfPanel
                        result={mtf}
                        market={info?.underlying_symbol_name ?? symbol}
                        fmt={fmt}
                        loading={loading || !m15Ready}
                        error={loadError ?? m15Error}
                        marketClosed={closed}
                    />
                )}
                {mode === 'h1' && !outcome && (
                    <p className='forex-trader__hint'>
                        Choose a market and a strategy, then tap <b>Analyse</b>. The tool calculates the exact levels with
                        code, draws them on the chart, and asks Gemini whether the setup looks clean. Signals only — it
                        never trades, and no strategy wins every time.
                    </p>
                )}
                {mode === 'h1' && outcome && (
                    <>
                        <div className='forex-trader__result-head'>
                            <span className={`forex-trader__pill forex-trader__pill--${tone}`}>
                                {status && outcome && statusLabel(status, outcome.analysis)}
                            </span>
                            {aiCurrent && <span className='forex-trader__conf'>Confidence {outcome.ai!.confidence}%</span>}
                            {!aiCurrent && !outcome.aiError && (
                                <span className='forex-trader__muted'>AI review {aiBusy ? 'refreshing…' : 'queued…'}</span>
                            )}
                        </div>
                        {conflict && codeSt && aiSt ? (
                            <div className={`forex-trader__conflict forex-trader__conflict--${conflict}`}>
                                <b>The code and the AI do not agree</b>
                                <p>
                                    <span>Code (exact rules):</span> {outcome.analysis.statusText.startsWith(statusLabel(codeSt, outcome.analysis))
                                        ? outcome.analysis.statusText
                                        : `${statusLabel(codeSt, outcome.analysis)} — ${outcome.analysis.statusText}`}
                                </p>
                                <p>
                                    <span>AI (chart review):</span> {STATUS_TEXT[aiSt]}
                                </p>
                                <p className='forex-trader__conflict-verdict'>
                                    {conflict === 'careful'
                                        ? 'Do not enter yet. The rules are met, but the AI sees a problem (its reasoning is below). Wait until both agree.'
                                        : conflict === 'eager'
                                          ? 'The code decides: its rules are not met, so this is not a trade yet. The AI note below is advice only.'
                                          : 'The code decides the status. The AI sees the market differently (reasoning below).'}
                                </p>
                            </div>
                        ) : (
                            status &&
                            statusLabel(status, outcome.analysis) !== outcome.analysis.statusText && (
                                <p className='forex-trader__code-status'>{outcome.analysis.statusText}</p>
                            )
                        )}

                        <h4 className='forex-trader__h'>Setup details</h4>
                        <dl className='forex-trader__facts'>
                            <dt>Strategy</dt>
                            <dd>{outcome.analysis.strategyName}</dd>
                            <dt>Market</dt>
                            <dd>{info?.underlying_symbol_name ?? symbol}</dd>
                            <dt>Trade timeframe</dt>
                            <dd>
                                {TIMEFRAMES.find(t => t.sec === tf)?.label} candles (enter on a candle close)
                            </dd>
                            <dt>Session now</dt>
                            <dd>
                                {outcome.analysis.sessionNow}
                                {outcome.analysis.lastCandleTime ? ` · ${fmtTime(outcome.analysis.lastCandleTime)}` : ''}
                            </dd>
                            {outcome.analysis.lastPrice !== null && (
                                <>
                                    <dt>Price now</dt>
                                    <dd>{fmt(outcome.analysis.lastPrice)}</dd>
                                </>
                            )}
                            {outcome.analysis.range && (
                                <>
                                    <dt>Reference range</dt>
                                    <dd>
                                        {outcome.analysis.range.label} High {fmt(outcome.analysis.range.high)} · Low{' '}
                                        {fmt(outcome.analysis.range.low)}
                                    </dd>
                                    <dt>Range measured</dt>
                                    <dd>
                                        {fmtTime(outcome.analysis.range.startTime)} →{' '}
                                        {fmtTime(outcome.analysis.range.endTime)}
                                        {outcome.analysis.range.note ? ` (${outcome.analysis.range.note})` : ''}
                                    </dd>
                                </>
                            )}
                            {outcome.analysis.sweep && (
                                <>
                                    <dt>Sweep</dt>
                                    <dd>
                                        {outcome.analysis.sweep.side === 'high' ? 'High' : 'Low'} swept to{' '}
                                        {fmt(outcome.analysis.sweep.extreme)}, closed back inside{' '}
                                        {fmtTime(outcome.analysis.sweep.confirmTime)}
                                    </dd>
                                </>
                            )}
                            {outcome.analysis.bos && (
                                <>
                                    <dt>Break of structure</dt>
                                    <dd>
                                        level {fmt(outcome.analysis.bos.level)}
                                        {outcome.analysis.bos.bosTime
                                            ? `, confirmed ${fmtTime(outcome.analysis.bos.bosTime)}`
                                            : ', not confirmed yet'}
                                    </dd>
                                </>
                            )}
                            {outcome.analysis.fvg && (
                                <>
                                    <dt>Fair value gap</dt>
                                    <dd>
                                        {fmt(outcome.analysis.fvg.bottom)} to {fmt(outcome.analysis.fvg.top)}
                                    </dd>
                                </>
                            )}
                            {outcome.analysis.entryTime && (
                                <>
                                    <dt>Entry reached</dt>
                                    <dd>{fmtTime(outcome.analysis.entryTime)}</dd>
                                </>
                            )}
                            {outcome.analysis.candlesLeft !== null && outcome.analysis.state === 'ready' && (
                                <>
                                    <dt>Valid for</dt>
                                    <dd>
                                        about {outcome.analysis.candlesLeft} more candles (
                                        {Math.round((outcome.analysis.candlesLeft * tf) / 60)} min)
                                    </dd>
                                </>
                            )}
                        </dl>

                        {plan && (
                            <>
                                <h4 className='forex-trader__h'>{plan.planned ? 'Planned trade' : 'Trade plan'} ({plan.side})</h4>
                                <div className='forex-trader__grid'>
                                    <div className='is-entry'>
                                        <span>
                                            Entry {outcome.analysis.entryTime ? '(reached)' : '(pullback to BOS level)'}
                                        </span>
                                        <b>{fmt(plan.entry)}</b>
                                    </div>
                                    <div className='is-sl'>
                                        <span>Stop loss</span>
                                        <b>{fmt(plan.stopLoss)}</b>
                                    </div>
                                    <div className='is-tp'>
                                        <span>Take profit</span>
                                        <b>{fmt(plan.takeProfit)}</b>
                                    </div>
                                    <div>
                                        <span>Risk : Reward</span>
                                        <b>1 : {plan.rr.toFixed(2)}</b>
                                    </div>
                                    <div>
                                        <span>Risk (price)</span>
                                        <b>{fmt(plan.risk)}</b>
                                    </div>
                                    <div>
                                        <span>Midpoint</span>
                                        <b>{fmt(plan.midpoint)}</b>
                                    </div>
                                </div>
                            </>
                        )}

                        {outcome.analysis.watch && outcome.analysis.range && (
                            <>
                                <h4 className='forex-trader__h'>Planned trades (dashed lines, not active yet)</h4>
                                <p className='forex-trader__muted'>
                                    Price is closer to the {outcome.analysis.watch.nearest === 'sell' ? 'HIGH' : 'LOW'}, so
                                    that side is the one to watch first.
                                </p>
                                {([outcome.analysis.watch.sell, outcome.analysis.watch.buy] as const).map(sc => (
                                    <div
                                        key={sc.side}
                                        className={`forex-trader__scenario forex-trader__scenario--${sc.side === 'SELL' ? 'sell' : 'buy'}${
                                            (sc.side === 'SELL') === (outcome.analysis.watch!.nearest === 'sell') ? ' is-near' : ''
                                        }`}
                                    >
                                        <b>
                                            If the {sc.side === 'SELL' ? 'HIGH' : 'LOW'} is swept → {sc.side}
                                        </b>
                                        <ol>
                                            <li>
                                                Price pushes {sc.side === 'SELL' ? 'above' : 'below'} {fmt(sc.trigger)}
                                            </li>
                                            <li>A {TIMEFRAMES.find(t => t.sec === tf)?.label} candle closes back inside the range</li>
                                            <li>
                                                Enter {sc.side} at {fmt(sc.entry)}, stop loss {fmt(sc.stopLoss)}
                                                {sc.slBasis === 'sweep'
                                                    ? ' (real sweep extreme + room)'
                                                    : ` (rule: ${sc.side === 'SELL' ? 'high' : 'low'} ${sc.side === 'SELL' ? '+' : '−'} 1 × ATR + ¼ ATR; moves to the real sweep extreme once price sweeps)`}
                                                , take profit {fmt(sc.takeProfit)}
                                            </li>
                                        </ol>
                                        <span className='forex-trader__muted'>
                                            RR 1 : {sc.rr.toFixed(2)} · price is {fmt(sc.distance)} away
                                            {sc.distanceAtr !== null ? ` (${sc.distanceAtr.toFixed(1)} × ATR)` : ''}
                                        </span>
                                    </div>
                                ))}
                            </>
                        )}

                        {outcome.analysis.stages.length > 0 && (
                            <>
                                <h4 className='forex-trader__h'>Setup stages</h4>
                                <ol className='forex-trader__stages'>
                                    {outcome.analysis.stages.map(st => (
                                        <li key={st.label} className={`is-${st.state}`}>
                                            <span>{st.state === 'done' ? '✔' : st.state === 'now' ? '●' : '○'}</span> {st.label}
                                        </li>
                                    ))}
                                </ol>
                            </>
                        )}

                        <h4 className='forex-trader__h'>Before you enter</h4>
                        <ul className='forex-trader__check'>
                            {checklist(outcome.analysis, closed).map(c => (
                                <li key={c.label} className={`is-${c.state}`}>
                                    <span>{c.state === 'yes' ? '✔' : c.state === 'no' ? '✖' : '○'}</span> {c.label}
                                </li>
                            ))}
                        </ul>

                        {aiCurrent && outcome.ai?.reasoning && <p className='forex-trader__reasoning'>{outcome.ai.reasoning}</p>}
                        {[...(outcome.analysis.warnings ?? []), ...(aiCurrent ? outcome.ai?.warnings ?? [] : [])].map((w, i) => (
                            <p key={i} className='forex-trader__warn'>
                                ⚠ {w}
                            </p>
                        ))}
                        {outcome.aiError && (
                            <p className='forex-trader__warn'>
                                AI review unavailable: {outcome.aiError} Showing the code-calculated result only.
                            </p>
                        )}
                        <p className='forex-trader__muted'>
                            Live: recalculated {new Date(outcome.at).toISOString().slice(11, 19)} GMT from the real candles. Signals only: no strategy wins every time.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};

export default ForexTrader;
