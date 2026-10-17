import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';
import type { Candle } from './engine';
import './chart-drawings.scss';

/**
 * Drawing tools for the forex trader chart (phase 1): trend line, ray, extended line,
 * horizontal line / ray, vertical line, cross line, text, callout, price label, magnet.
 *
 * Everything is drawn in an SVG laid over the chart. A point is stored as
 * { x: candle index, y: price }, so drawings follow the chart when it is zoomed or scrolled.
 */

export type Tool = 'cursor' | 'trend' | 'ray' | 'extended' | 'hline' | 'hray' | 'vline' | 'cross' | 'text' | 'callout' | 'pricelabel';
type DrawTool = Exclude<Tool, 'cursor'>;
type Magnet = 'off' | 'weak' | 'strong';

interface Pt {
    x: number;
    y: number;
}
interface Px {
    x: number;
    y: number;
}
interface Drawing {
    id: number;
    tool: DrawTool;
    pts: Pt[];
    text: string;
    color: string;
}

/** How many clicks each tool needs. */
const NEEDS: Record<DrawTool, number> = {
    trend: 2,
    ray: 2,
    extended: 2,
    hline: 1,
    hray: 1,
    vline: 1,
    cross: 1,
    text: 1,
    callout: 2,
    pricelabel: 1,
};

const HINTS: Record<DrawTool, string> = {
    trend: 'Click the start point, then the end point',
    ray: 'Click the start point, then a point it passes through',
    extended: 'Click two points on the line',
    hline: 'Click where the line should be',
    hray: 'Click where the ray should start',
    vline: 'Click where the line should be',
    cross: 'Click where the cross should be',
    text: 'Click where the text should go',
    callout: 'Click the point to mark, then where the box should sit',
    pricelabel: 'Click the price to label',
};

const LINE_TOOLS: Array<{ tool: DrawTool; label: string }> = [
    { tool: 'trend', label: 'Trend Line' },
    { tool: 'ray', label: 'Ray' },
    { tool: 'extended', label: 'Extended Line' },
    { tool: 'hline', label: 'Horizontal Line' },
    { tool: 'hray', label: 'Horizontal Ray' },
    { tool: 'vline', label: 'Vertical Line' },
    { tool: 'cross', label: 'Cross Line' },
];
const TEXT_TOOLS: Array<{ tool: DrawTool; label: string }> = [
    { tool: 'text', label: 'Text' },
    { tool: 'callout', label: 'Callout' },
    { tool: 'pricelabel', label: 'Price Label' },
];

const SNAP_PX = 14; // weak magnet: how close (in pixels) to a candle's O/H/L/C it must be
const HIDDEN = 'rgba(0,0,0,0)';

/** Black or white text, whichever reads better on the given colour. */
const ink = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return lum > 150 ? '#111' : '#fff';
};

/** A point a long way along the line a -> b (k can be negative to go backwards). */
const far = (a: Px, b: Px, k: number): Px => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const s = k / (Math.hypot(dx, dy) || 1);
    return { x: a.x + dx * s, y: a.y + dy * s };
};

// ---- small icons ------------------------------------------------------------------------
const Svg = ({ children }: { children: ReactNode }) => (
    <svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round'>
        {children}
    </svg>
);
const ICONS: Record<Tool | 'magnet' | 'trash', ReactNode> = {
    cursor: (
        <Svg>
            <path d='M12 3v6M12 15v6M3 12h6M15 12h6' />
        </Svg>
    ),
    trend: (
        <Svg>
            <path d='M6 18L18 6' />
            <circle cx='6' cy='18' r='2' />
            <circle cx='18' cy='6' r='2' />
        </Svg>
    ),
    ray: (
        <Svg>
            <path d='M6 18L21 3' />
            <circle cx='6' cy='18' r='2' />
            <circle cx='13' cy='11' r='1.2' />
        </Svg>
    ),
    extended: (
        <Svg>
            <path d='M3 21L21 3' />
            <circle cx='9' cy='15' r='1.6' />
            <circle cx='15' cy='9' r='1.6' />
        </Svg>
    ),
    hline: (
        <Svg>
            <path d='M3 12h18' />
            <circle cx='12' cy='12' r='2' />
        </Svg>
    ),
    hray: (
        <Svg>
            <path d='M6 12h16' />
            <circle cx='5' cy='12' r='2' />
        </Svg>
    ),
    vline: (
        <Svg>
            <path d='M12 3v18' />
            <circle cx='12' cy='12' r='2' />
        </Svg>
    ),
    cross: (
        <Svg>
            <path d='M3 12h18M12 3v18' />
            <circle cx='12' cy='12' r='2' />
        </Svg>
    ),
    text: (
        <Svg>
            <path d='M6 6h12M12 6v13M9 19h6' />
        </Svg>
    ),
    callout: (
        <Svg>
            <path d='M4 5h16v11h-8l-4 4v-4H4z' />
        </Svg>
    ),
    pricelabel: (
        <Svg>
            <path d='M3 12l5-5h13v10H8z' />
        </Svg>
    ),
    magnet: (
        <Svg>
            <path d='M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3z' />
            <path d='M6 7h4M14 7h4' />
        </Svg>
    ),
    trash: (
        <Svg>
            <path d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' />
        </Svg>
    ),
};

interface Props {
    chart: IChartApi;
    series: ISeriesApi<'Candlestick'>;
    getCandles: () => Candle[];
    pipSize: number;
    /** Changes whenever new candles are loaded (market / timeframe change): drawings are cleared. */
    resetKey: number;
}

export default function ChartDrawings({ chart, series, getCandles, pipSize, resetKey }: Props) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [drawings, setDrawings] = useState<Drawing[]>([]);
    const [draft, setDraft] = useState<{ tool: DrawTool; pts: Pt[] } | null>(null);
    const [tool, setTool] = useState<Tool>('cursor');
    const [lastLine, setLastLine] = useState<DrawTool>('trend');
    const [lastText, setLastText] = useState<DrawTool>('text');
    const [magnet, setMagnet] = useState<Magnet>('off');
    const [color, setColor] = useState('#facc15');
    const [selected, setSelected] = useState<number | null>(null);
    const [menu, setMenu] = useState<string | null>(null);
    const [, redraw] = useState(0);
    const nextId = useRef(1);
    const downAt = useRef<{ x: number; y: number } | null>(null);
    const drag = useRef<{ id: number; idx: number | null; start: Pt; orig: Pt[] } | null>(null);
    const clipId = useRef(`fx-clip-${Math.random().toString(36).slice(2)}`);

    // ---- measuring -------------------------------------------------------------------------
    const size = () => {
        const r = svgRef.current?.getBoundingClientRect();
        const w = r?.width ?? 0;
        const h = r?.height ?? 0;
        let axisW = 56;
        let axisH = 26;
        try {
            axisW = chart.priceScale('right').width() || axisW;
            axisH = chart.timeScale().height() || axisH;
        } catch {
            /* chart not ready: use the defaults */
        }
        return { w, h, plotW: Math.max(0, w - axisW), plotH: Math.max(0, h - axisH) };
    };

    const toPx = (p: Pt): Px | null => {
        const x = chart.timeScale().logicalToCoordinate(p.x as Logical);
        const y = series.priceToCoordinate(p.y);
        return x === null || y === null ? null : { x: x as number, y: y as number };
    };

    /** Magnet: snap to the open / high / low / close of the candle under the pointer. */
    const snapPt = (pt: Pt, yPx: number): Pt => {
        const candles = getCandles();
        const i = Math.round(pt.x);
        if (magnet === 'off' || i < 0 || i >= candles.length) return pt;
        const c = candles[i];
        let best = pt.y;
        let bestDist = Infinity;
        [c.open, c.high, c.low, c.close].forEach(level => {
            const ly = series.priceToCoordinate(level);
            if (ly === null) return;
            const d = Math.abs((ly as number) - yPx);
            if (d < bestDist) {
                bestDist = d;
                best = level;
            }
        });
        return magnet === 'strong' || bestDist <= SNAP_PX ? { x: i, y: best } : pt;
    };

    const toPt = (clientX: number, clientY: number, snap: boolean, inPlotOnly = false): Pt | null => {
        const r = svgRef.current?.getBoundingClientRect();
        if (!r) return null;
        const x = clientX - r.left;
        const y = clientY - r.top;
        if (inPlotOnly) {
            const s = size();
            if (x > s.plotW || y > s.plotH) return null;
        }
        const lx = chart.timeScale().coordinateToLogical(x);
        const py = series.coordinateToPrice(y);
        if (lx === null || py === null) return null;
        const pt = { x: lx as number, y: py as number };
        return snap ? snapPt(pt, y) : pt;
    };

    // ---- keep the overlay glued to the chart ------------------------------------------------
    // The chart can move without telling us (scroll, zoom, drag the price axis, new candles), so
    // every frame we check where two known points sit on screen and redraw only if that changed.
    useEffect(() => {
        let raf = 0;
        let last = '';
        const loop = () => {
            try {
                const candles = getCandles();
                const base = candles.length ? candles[candles.length - 1].close : 1;
                const s = size();
                const sig = [
                    s.w,
                    s.h,
                    s.plotW,
                    s.plotH,
                    chart.timeScale().logicalToCoordinate(0 as Logical),
                    chart.timeScale().logicalToCoordinate(10 as Logical),
                    series.priceToCoordinate(base),
                    series.priceToCoordinate(base * 1.01),
                ].join('|');
                if (sig !== last) {
                    last = sig;
                    redraw(n => n + 1);
                }
            } catch {
                /* chart is being removed */
            }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chart, series]);

    // clicking empty chart: deselect and close menus
    useEffect(() => {
        const onClick = () => {
            setSelected(null);
            setMenu(null);
        };
        chart.subscribeClick(onClick);
        return () => {
            try {
                chart.unsubscribeClick(onClick);
            } catch {
                /* chart already removed */
            }
        };
    }, [chart]);

    // new candles (market / timeframe changed): the old drawings no longer mean anything
    useEffect(() => {
        setDrawings([]);
        setDraft(null);
        setSelected(null);
        setTool('cursor');
    }, [resetKey]);

    // keyboard: Esc cancels, Delete removes the selected drawing
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
            if (e.key === 'Escape' && (tool !== 'cursor' || draft || selected !== null)) {
                setDraft(null);
                setTool('cursor');
                setSelected(null);
                setMenu(null);
            } else if (e.key === 'Delete' && selected !== null) {
                setDrawings(d => d.filter(x => x.id !== selected));
                setSelected(null);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [tool, draft, selected]);

    // ---- creating ---------------------------------------------------------------------------
    const commit = (t: DrawTool, pts: Pt[]) => {
        let text = '';
        if (t === 'text' || t === 'callout') {
            const answer = window.prompt('Type your text:', '');
            if (!answer) {
                setDraft(null);
                return;
            }
            text = answer;
        }
        const id = nextId.current++;
        setDrawings(d => [...d, { id, tool: t, pts, text, color }]);
        setSelected(id);
        setDraft(null);
        setTool('cursor');
        downAt.current = null;
    };

    const onDown = (e: RPointerEvent<SVGSVGElement>) => {
        if (tool === 'cursor') return;
        const pt = toPt(e.clientX, e.clientY, true, true);
        if (!pt) return;
        e.preventDefault();
        setMenu(null);
        if (NEEDS[tool] === 1) {
            commit(tool, [pt]);
            return;
        }
        if (draft) {
            commit(draft.tool, [draft.pts[0], pt]);
            return;
        }
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* not critical */
        }
        downAt.current = { x: e.clientX, y: e.clientY };
        setDraft({ tool, pts: [pt, pt] });
    };

    const onMove = (e: RPointerEvent<SVGSVGElement>) => {
        const dr = drag.current;
        if (dr) {
            const cur = toPt(e.clientX, e.clientY, dr.idx !== null);
            if (!cur) return;
            setDrawings(list =>
                list.map(d => {
                    if (d.id !== dr.id) return d;
                    if (dr.idx !== null) return { ...d, pts: d.pts.map((p, i) => (i === dr.idx ? cur : p)) };
                    const dx = cur.x - dr.start.x;
                    const dy = cur.y - dr.start.y;
                    return { ...d, pts: dr.orig.map(p => ({ x: p.x + dx, y: p.y + dy })) };
                })
            );
            return;
        }
        if (draft) {
            const pt = toPt(e.clientX, e.clientY, true);
            if (pt) setDraft({ ...draft, pts: [draft.pts[0], pt] });
        }
    };

    const onUp = (e: RPointerEvent<SVGSVGElement>) => {
        if (drag.current) {
            drag.current = null;
            return;
        }
        const start = downAt.current;
        downAt.current = null;
        // press-drag-release draws the line in one gesture; a plain click waits for the second click
        if (draft && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
            commit(draft.tool, draft.pts);
        }
    };

    // ---- moving / editing ---------------------------------------------------------------------
    const startDrag = (e: RPointerEvent<Element>, d: Drawing, idx: number | null) => {
        e.stopPropagation();
        setSelected(d.id);
        setMenu(null);
        const start = toPt(e.clientX, e.clientY, false);
        if (!start) return;
        drag.current = { id: d.id, idx, start, orig: d.pts.map(p => ({ ...p })) };
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* not critical */
        }
    };

    const editText = (d: Drawing) => {
        if (d.tool !== 'text' && d.tool !== 'callout') return;
        const answer = window.prompt('Edit text:', d.text);
        if (answer) setDrawings(list => list.map(x => (x.id === d.id ? { ...x, text: answer } : x)));
    };

    // ---- drawing a shape ----------------------------------------------------------------------
    const S = size();

    const renderShape = (d: Drawing, preview: boolean): ReactNode => {
        const px = d.pts.map(toPx);
        if (px.some(p => p === null)) return null;
        const P = px as Px[];
        const { w, plotW, plotH } = S;
        const sel = !preview && d.id === selected;
        const stroke = d.color;
        const line = (a: Px, b: Px, key: string) => (
            <g key={key}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={sel ? 2.5 : 2} strokeDasharray={preview ? '5 4' : undefined} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={HIDDEN} strokeWidth={14} />
            </g>
        );
        const axisTag = (y: number, price: number) => (
            <g key={`tag-${y}`} pointerEvents='none'>
                <rect x={plotW} y={y - 9} width={Math.max(0, w - plotW)} height={18} fill={stroke} />
                <text x={plotW + 4} y={y + 4} fontSize={11} fill={ink(stroke)}>
                    {price.toFixed(pipSize)}
                </text>
            </g>
        );

        let body: ReactNode = null;
        switch (d.tool) {
            case 'trend':
                body = line(P[0], P[1], 'l');
                break;
            case 'ray':
                body = line(P[0], far(P[0], P[1], 10000), 'l');
                break;
            case 'extended':
                body = line(far(P[0], P[1], -10000), far(P[0], P[1], 10000), 'l');
                break;
            case 'hline':
                body = [line({ x: 0, y: P[0].y }, { x: plotW, y: P[0].y }, 'l'), axisTag(P[0].y, d.pts[0].y)];
                break;
            case 'hray':
                body = [line({ x: P[0].x, y: P[0].y }, { x: plotW, y: P[0].y }, 'l'), axisTag(P[0].y, d.pts[0].y)];
                break;
            case 'vline':
                body = line({ x: P[0].x, y: 0 }, { x: P[0].x, y: plotH }, 'l');
                break;
            case 'cross':
                body = [
                    line({ x: 0, y: P[0].y }, { x: plotW, y: P[0].y }, 'h'),
                    line({ x: P[0].x, y: 0 }, { x: P[0].x, y: plotH }, 'v'),
                    axisTag(P[0].y, d.pts[0].y),
                ];
                break;
            case 'text':
                body = (
                    <text
                        x={P[0].x}
                        y={P[0].y}
                        fontSize={13}
                        fontWeight={600}
                        fill={stroke}
                        stroke='rgba(0,0,0,0.55)'
                        strokeWidth={3}
                        paintOrder='stroke'
                        onDoubleClick={() => editText(d)}
                    >
                        {d.text}
                    </text>
                );
                break;
            case 'callout': {
                const bw = Math.max(40, d.text.length * 7 + 18);
                const bx = P[1].x - bw / 2;
                const by = P[1].y - 13;
                body = (
                    <g onDoubleClick={() => editText(d)}>
                        <line x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} stroke={stroke} strokeWidth={1.5} />
                        <circle cx={P[0].x} cy={P[0].y} r={3.5} fill={stroke} />
                        <rect x={bx} y={by} width={bw} height={26} rx={5} fill='rgba(24,28,36,0.95)' stroke={stroke} strokeWidth={1.5} />
                        <text x={P[1].x} y={P[1].y + 4} fontSize={12} textAnchor='middle' fill='#fff'>
                            {d.text}
                        </text>
                    </g>
                );
                break;
            }
            case 'pricelabel': {
                const label = d.pts[0].y.toFixed(pipSize);
                const tw = label.length * 7 + 14;
                body = (
                    <g>
                        <path d={`M ${P[0].x} ${P[0].y} l 8 -11 h ${tw} v 22 h -${tw} z`} fill={stroke} />
                        <text x={P[0].x + 12} y={P[0].y + 4} fontSize={12} fontWeight={600} fill={ink(stroke)}>
                            {label}
                        </text>
                    </g>
                );
                break;
            }
        }

        return (
            <g
                key={preview ? 'draft' : d.id}
                className={preview ? undefined : 'fx-shape'}
                pointerEvents={preview ? 'none' : undefined}
                onPointerDown={preview ? undefined : e => startDrag(e, d, null)}
            >
                {body}
                {sel &&
                    P.map((p, i) => (
                        <circle
                            key={`h${i}`}
                            className='fx-handle'
                            cx={d.tool === 'hline' || d.tool === 'hray' ? Math.min(Math.max(p.x, 8), plotW - 8) : p.x}
                            cy={p.y}
                            r={5}
                            fill='#fff'
                            stroke={stroke}
                            strokeWidth={2}
                            onPointerDown={e => startDrag(e, d, i)}
                        />
                    ))}
            </g>
        );
    };

    // ---- toolbar ------------------------------------------------------------------------------
    const pick = (t: DrawTool, group: 'lines' | 'text') => {
        if (group === 'lines') setLastLine(t);
        else setLastText(t);
        setTool(t);
        setDraft(null);
        setSelected(null);
        setMenu(null);
    };
    const toggle = (name: string) => setMenu(m => (m === name ? null : name));
    const isLine = LINE_TOOLS.some(x => x.tool === tool);
    const isText = TEXT_TOOLS.some(x => x.tool === tool);

    return (
        <>
            <svg
                ref={svgRef}
                className={`fx-svg${tool !== 'cursor' ? ' is-drawing' : ''}`}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
            >
                <defs>
                    <clipPath id={clipId.current}>
                        <rect x={0} y={0} width={S.plotW} height={S.plotH} />
                    </clipPath>
                </defs>
                <g clipPath={`url(#${clipId.current})`}>
                    {drawings.map(d => renderShape(d, false))}
                    {draft && renderShape({ id: -1, tool: draft.tool, pts: draft.pts, text: '', color }, true)}
                </g>
                {/* handles and price tags sit outside the clip so they stay visible at the edges */}
            </svg>

            {tool !== 'cursor' && <div className='fx-hint'>{HINTS[tool]} · Esc to cancel</div>}

            <div className='fx-bar' onPointerDown={e => e.stopPropagation()}>
                <button
                    type='button'
                    className={`fx-btn${tool === 'cursor' ? ' is-on' : ''}`}
                    title='Cursor'
                    onClick={() => {
                        setTool('cursor');
                        setDraft(null);
                        setMenu(null);
                    }}
                >
                    {ICONS.cursor}
                </button>

                <div className='fx-group'>
                    <button type='button' className={`fx-btn${isLine ? ' is-on' : ''}`} title='Lines' onClick={() => toggle('lines')}>
                        {ICONS[lastLine]}
                    </button>
                    {menu === 'lines' && (
                        <div className='fx-menu'>
                            <div className='fx-menu__title'>Lines</div>
                            {LINE_TOOLS.map(x => (
                                <button key={x.tool} type='button' className={`fx-item${tool === x.tool ? ' is-on' : ''}`} onClick={() => pick(x.tool, 'lines')}>
                                    {ICONS[x.tool]}
                                    <span>{x.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className='fx-group'>
                    <button type='button' className={`fx-btn${isText ? ' is-on' : ''}`} title='Text & notes' onClick={() => toggle('text')}>
                        {ICONS[lastText]}
                    </button>
                    {menu === 'text' && (
                        <div className='fx-menu'>
                            <div className='fx-menu__title'>Text &amp; notes</div>
                            {TEXT_TOOLS.map(x => (
                                <button key={x.tool} type='button' className={`fx-item${tool === x.tool ? ' is-on' : ''}`} onClick={() => pick(x.tool, 'text')}>
                                    {ICONS[x.tool]}
                                    <span>{x.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className='fx-group'>
                    <button type='button' className={`fx-btn${magnet !== 'off' ? ' is-on' : ''}`} title='Magnet' onClick={() => toggle('magnet')}>
                        {ICONS.magnet}
                    </button>
                    {menu === 'magnet' && (
                        <div className='fx-menu'>
                            <div className='fx-menu__title'>Magnet</div>
                            {(['off', 'weak', 'strong'] as Magnet[]).map(m => (
                                <button
                                    key={m}
                                    type='button'
                                    className={`fx-item${magnet === m ? ' is-on' : ''}`}
                                    onClick={() => {
                                        setMagnet(m);
                                        setMenu(null);
                                    }}
                                >
                                    <span>{m === 'off' ? 'Off' : m === 'weak' ? 'Weak magnet' : 'Strong magnet'}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <label className='fx-btn fx-color' title='Colour (also recolours the selected drawing)'>
                    <input
                        type='color'
                        value={color}
                        onChange={e => {
                            const c = e.target.value;
                            setColor(c);
                            if (selected !== null) setDrawings(list => list.map(x => (x.id === selected ? { ...x, color: c } : x)));
                        }}
                    />
                </label>

                <div className='fx-group'>
                    <button type='button' className='fx-btn' title='Remove' onClick={() => toggle('trash')}>
                        {ICONS.trash}
                    </button>
                    {menu === 'trash' && (
                        <div className='fx-menu'>
                            <div className='fx-menu__title'>Remove</div>
                            <button
                                type='button'
                                className='fx-item'
                                disabled={selected === null}
                                onClick={() => {
                                    setDrawings(list => list.filter(x => x.id !== selected));
                                    setSelected(null);
                                    setMenu(null);
                                }}
                            >
                                <span>Delete selected</span>
                            </button>
                            <button
                                type='button'
                                className='fx-item'
                                disabled={drawings.length === 0}
                                onClick={() => {
                                    setDrawings([]);
                                    setSelected(null);
                                    setMenu(null);
                                }}
                            >
                                <span>Remove all drawings</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
