// SVG layer over the price pane: the position/bracket tool (draggable SL/TP) and user drawings.
import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import type { Replay } from '../engine/replay';
import type { ChartView } from './chart/ChartView';
import { DRAW_COLOR, newId, type Drawing, type Pt, type Tool } from './drawings';
import { fmtMove } from './pnl';
import { toast } from './state';

interface Props {
  view: ChartView | null;
  rep: Replay;
  version: number;
  tool: Tool;
  setTool: (t: Tool) => void;
  drawings: Drawing[];
  setDrawings: (fn: (d: Drawing[]) => Drawing[]) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
}

type Drag =
  | { kind: 'sl' }
  | { kind: 'tp' }
  | { kind: 'hline'; id: string }
  | { kind: 'trendA' | 'trendB'; id: string }
  | { kind: 'trendMove'; id: string; start: Pt; a: Pt; b: Pt };

const COL = { up: '#26a69a', down: '#ef5350', entry: '#8b97a5', text: '#e6edf3' };

/** Right-aligned label pill on a horizontal line. */
function Pill({ x, y, text, color, solid }: { x: number; y: number; text: string; color: string; solid?: boolean }) {
  const w = text.length * 6.6 + 12;
  return (
    <g pointerEvents="none">
      <rect x={x - w} y={y - 9} width={w} height={18} rx={3} fill={solid ? color : '#131722'} stroke={color} />
      <text x={x - w / 2} y={y + 4} textAnchor="middle" fontSize={11} fill={solid ? '#fff' : color} fontFamily="ui-monospace,Menlo,monospace">{text}</text>
    </g>
  );
}

/** Price label on the axis. */
function AxisTag({ x, w, y, text, color }: { x: number; w: number; y: number; text: string; color: string }) {
  return (
    <g pointerEvents="none">
      <rect x={x} y={y - 9} width={w} height={18} fill={color} />
      <text x={x + w / 2} y={y + 4} textAnchor="middle" fontSize={11} fill="#fff" fontFamily="ui-monospace,Menlo,monospace">{text}</text>
    </g>
  );
}

export function ChartOverlay({ view, rep, version, tool, setTool, drawings, setDrawings, selected, setSelected }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [, setFrame] = useState(0);
  const [draft, setDraft] = useState<{ a: Pt; b: Pt } | null>(null);

  // Re-render whenever the chart's coordinate system moves (scroll, zoom, autoscale, resize).
  useEffect(() => {
    if (!view) return;
    let raf = 0, sig = '';
    const loop = () => {
      const r = view.paneRect(), ref = rep.last;
      const s = `${r.width}|${r.height}|${r.axis}|${view.priceToY(ref)}|${view.priceToY(ref * 1.01)}|${view.timeToX(0)}|${view.lastX()}`;
      if (s !== sig) { sig = s; setFrame((f) => f + 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view, rep]);

  // Escape cancels a drawing in progress
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDraft(null); setTool('cursor'); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [setTool]);

  if (!view) return null;
  const { width: W, height: H, axis: AW } = view.paneRect();
  if (!W || !H) return null;
  const y = (p: number) => view.priceToY(p);
  const pos = (e: { clientX: number; clientY: number }) => {
    const b = svg.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const toPt = (e: { clientX: number; clientY: number }): Pt | null => {
    const { x, y: yy } = pos(e), t = view.xToTime(x), p = view.yToPrice(yy);
    return t == null || p == null ? null : { t, p };
  };

  // ---------- Drag handling ----------
  const startDrag = (d: Drag) => (e: RPE) => {
    if (tool !== 'cursor') return;
    e.stopPropagation(); e.preventDefault();
    drag.current = d;
    view.setInteractive(false);
    try { svg.current!.setPointerCapture(e.pointerId); } catch { /* synthetic or inactive pointer */ }
    if ('id' in d) setSelected(d.id);
  };
  const onMove = (e: RPE) => {
    if (draft) { const p = toPt(e); if (p) setDraft({ a: draft.a, b: p }); return; }
    const d = drag.current;
    if (!d) return;
    const pt = toPt(e);
    if (!pt) return;
    if (d.kind === 'sl') rep.setStop(pt.p);
    else if (d.kind === 'tp') rep.setTarget(pt.p);
    else if ('id' in d) setDrawings((ds) => ds.map((x) => {
      if (x.id !== d.id) return x;
      if (x.kind === 'hline' && d.kind === 'hline') return { ...x, price: pt.p };
      if (x.kind === 'trend') {
        if (d.kind === 'trendA') return { ...x, a: pt };
        if (d.kind === 'trendB') return { ...x, b: pt };
        if (d.kind === 'trendMove') {
          const dt = pt.t - d.start.t, dp = pt.p - d.start.p;
          return { ...x, a: { t: d.a.t + dt, p: d.a.p + dp }, b: { t: d.b.t + dt, p: d.b.p + dp } };
        }
      }
      return x;
    }));
  };
  const onUp = (e: RPE) => {
    if (drag.current) {
      const d = drag.current;
      drag.current = null;
      view.setInteractive(true);
      try { svg.current!.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      if (d.kind === 'sl' || d.kind === 'tp') { const pt = toPt(e); if (pt) { const err = d.kind === 'sl' ? rep.setStop(pt.p) : rep.setTarget(pt.p); if (err) toast(err); } }
    }
  };

  // ---------- Creating drawings ----------
  const onCreate = (e: RPE) => {
    const pt = toPt(e);
    if (!pt) return;
    if (tool === 'hline') {
      const id = newId();
      setDrawings((ds) => [...ds, { id, kind: 'hline', price: pt.p, color: DRAW_COLOR }]);
      setSelected(id); setTool('cursor');
    } else if (tool === 'trend') {
      if (!draft) setDraft({ a: pt, b: pt });
      else {
        const id = newId();
        setDrawings((ds) => [...ds, { id, kind: 'trend', a: draft.a, b: pt, color: DRAW_COLOR }]);
        setDraft(null); setSelected(id); setTool('cursor');
      }
    }
  };

  // ---------- Bracket / position ----------
  const bracket = (() => {
    // Only shown once in a trade; while flat the chart stays clean.
    if (rep.done || !rep.pos) return null;
    const p = rep.pos;
    const plan = p ? null : rep.plan;
    const side = p ? p.side : plan!.side;
    const entry = p ? p.entry : plan!.entry;
    const stop = p ? p.stop : plan!.stop;
    const target = p ? p.target : plan!.target;
    const qty = p ? p.qty : plan!.qty;
    const ye = y(entry), ys = y(stop), yt = target != null ? y(target) : null;
    if (ye == null || ys == null) return null;
    const x0 = Math.max(0, (p ? view.timeToX(candleTime(rep, p.entryIdx)) : view.lastX()) ?? 0);
    const live = !!p, dash = live ? undefined : '6 4', op = live ? 0.16 : 0.08;
    const pv = rep.order.pnlView, rps = Math.abs(entry - stop);
    const mv = (m: number) => fmtMove(pv, m, qty, rps);
    const openPnl = side * (rep.last - entry);
    const right = W - 100; // clear of the chart's own price-line titles at the edge
    return (
      <g>
        {yt != null && <rect x={x0} y={Math.min(ye, yt)} width={Math.max(0, W - x0)} height={Math.abs(yt - ye)} fill={COL.up} opacity={op} pointerEvents="none" />}
        <rect x={x0} y={Math.min(ye, ys)} width={Math.max(0, W - x0)} height={Math.abs(ys - ye)} fill={COL.down} opacity={op} pointerEvents="none" />
        {/* entry */}
        <line x1={x0} x2={W} y1={ye} y2={ye} stroke={COL.entry} strokeDasharray={dash} pointerEvents="none" />
        <Pill x={right} y={ye} color={live ? (openPnl >= 0 ? COL.up : COL.down) : COL.entry} solid={live}
          text={live ? `${side > 0 ? 'LONG' : 'SHORT'} ${qty} · ${mv(openPnl)}` : `${side > 0 ? 'BUY' : 'SELL'} ${qty || '–'} @ MKT (preview)`} />
        {/* stop */}
        <line x1={x0} x2={W} y1={ys} y2={ys} stroke={COL.down} strokeDasharray={dash} pointerEvents="none" />
        <line x1={0} x2={W} y1={ys} y2={ys} stroke="transparent" strokeWidth={12} pointerEvents="stroke" style={{ cursor: 'ns-resize' }} onPointerDown={startDrag({ kind: 'sl' })} />
        <Pill x={right} y={ys} color={COL.down} text={`SL ${stop.toFixed(2)} · ${mv(side * (stop - entry))}`} />
        <AxisTag x={W} w={AW} y={ys} text={stop.toFixed(2)} color={COL.down} />
        {/* target */}
        {yt != null && target != null && <>
          <line x1={x0} x2={W} y1={yt} y2={yt} stroke={COL.up} strokeDasharray={dash} pointerEvents="none" />
          <line x1={0} x2={W} y1={yt} y2={yt} stroke="transparent" strokeWidth={12} pointerEvents="stroke" style={{ cursor: 'ns-resize' }} onPointerDown={startDrag({ kind: 'tp' })} />
          <Pill x={right} y={yt} color={COL.up} text={`TP ${target.toFixed(2)} · ${mv(side * (target - entry))}${pv === 'r' ? '' : ` · ${(Math.abs(target - entry) / rps).toFixed(1)}R`}`} />
          <AxisTag x={W} w={AW} y={yt} text={target.toFixed(2)} color={COL.up} />
        </>}
      </g>
    );
  })();

  // ---------- Drawings ----------
  const drawn = drawings.map((d) => {
    const sel = d.id === selected;
    if (d.kind === 'hline') {
      const yy = y(d.price);
      if (yy == null) return null;
      return (
        <g key={d.id}>
          <line x1={0} x2={W} y1={yy} y2={yy} stroke={d.color} strokeWidth={sel ? 2 : 1} pointerEvents="none" />
          <line x1={0} x2={W} y1={yy} y2={yy} stroke="transparent" strokeWidth={10} pointerEvents="stroke" style={{ cursor: tool === 'cursor' ? 'ns-resize' : undefined }} onPointerDown={startDrag({ kind: 'hline', id: d.id })} />
          <AxisTag x={W} w={AW} y={yy} text={d.price.toFixed(2)} color={d.color} />
        </g>
      );
    }
    const xa = view.timeToX(d.a.t), ya = y(d.a.p), xb = view.timeToX(d.b.t), yb = y(d.b.p);
    if (xa == null || ya == null || xb == null || yb == null) return null;
    return (
      <g key={d.id}>
        <line x1={xa} y1={ya} x2={xb} y2={yb} stroke={d.color} strokeWidth={sel ? 2 : 1.5} pointerEvents="none" />
        <line x1={xa} y1={ya} x2={xb} y2={yb} stroke="transparent" strokeWidth={10} pointerEvents="stroke" style={{ cursor: tool === 'cursor' ? 'move' : undefined }}
          onPointerDown={(e) => { const s = toPt(e); if (s) startDrag({ kind: 'trendMove', id: d.id, start: s, a: d.a, b: d.b })(e); }} />
        {sel && <>
          <circle cx={xa} cy={ya} r={5} fill="#131722" stroke={d.color} strokeWidth={2} style={{ cursor: 'grab' }} pointerEvents="all" onPointerDown={startDrag({ kind: 'trendA', id: d.id })} />
          <circle cx={xb} cy={yb} r={5} fill="#131722" stroke={d.color} strokeWidth={2} style={{ cursor: 'grab' }} pointerEvents="all" onPointerDown={startDrag({ kind: 'trendB', id: d.id })} />
        </>}
      </g>
    );
  });

  const draftEl = draft && (() => {
    const xa = view.timeToX(draft.a.t), ya = y(draft.a.p), xb = view.timeToX(draft.b.t), yb = y(draft.b.p);
    return xa != null && ya != null && xb != null && yb != null ? <line x1={xa} y1={ya} x2={xb} y2={yb} stroke={DRAW_COLOR} strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" /> : null;
  })();

  void version; // re-render on every replay change
  return (
    <svg ref={svg} className="overlay" onPointerMove={onMove} onPointerUp={onUp}>
      <defs><clipPath id="paneClip"><rect x={0} y={0} width={W + AW} height={H} /></clipPath></defs>
      <g clipPath="url(#paneClip)">
        {tool !== 'cursor' && <rect x={0} y={0} width={W} height={H} fill="transparent" pointerEvents="all" style={{ cursor: 'crosshair' }} onPointerDown={onCreate} />}
        {bracket}
        {drawn}
        {draftEl}
      </g>
    </svg>
  );
}

/** Chart time of the entry candle (1-min resolution; the view maps it to the current timeframe). */
function candleTime(rep: Replay, idx: number) {
  const [y, m, d] = rep.day.date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 9, 30) / 1000 + idx * 60;
}
