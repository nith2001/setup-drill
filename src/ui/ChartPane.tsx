import { LineStyle, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { buildCandles, candleTimeFor, type Candle, type History, type TF } from '../core/candles';
import type { IndicatorConfig } from '../core/overlays';
import type { Replay } from '../engine/replay';
import { COLORS, ChartView, type Hover, type LineSpec } from './chart/ChartView';
import { ChartOverlay } from './ChartOverlay';
import type { Drawing, Tool } from './drawings';
import { fmtR, settings } from './state';

interface Props {
  rep: Replay; version: number; tf: TF; cfg: IndicatorConfig; hist: History; historyLoading: boolean;
  tool: Tool; setTool: (t: Tool) => void;
  drawings: Drawing[]; setDrawings: (fn: (d: Drawing[]) => Drawing[]) => void;
  selected: string | null; setSelected: (id: string | null) => void;
  children?: ReactNode; // floating controls (replay bar)
}

/** Colors for daily reference levels. */
const LEVEL = { pd: '#f0b429', d50: '#c792ea', d200: '#ff7b72', drill: '#2962ff' };

const fmtVol = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(v));

function Legend({ h }: { h: Hover | null }) {
  if (!h) return null;
  const chg = h.prevClose ? ((h.close - h.prevClose) / h.prevClose) * 100 : null;
  const c = h.close >= h.open ? 'up' : 'down';
  return (
    <div className="legend mono">
      O <span className={c}>{h.open.toFixed(2)}</span> H <span className={c}>{h.high.toFixed(2)}</span> L <span className={c}>{h.low.toFixed(2)}</span> C <span className={c}>{h.close.toFixed(2)}</span>
      {chg != null && <span className={chg >= 0 ? 'up' : 'down'}> {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>}
      <span className="muted"> Vol {fmtVol(h.volume)}</span>
    </div>
  );
}

export function ChartPane({ rep, version, tf, cfg, hist, historyLoading, tool, setTool, drawings, setDrawings, selected, setSelected, children }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const view = useRef<ChartView | null>(null);
  const [viewState, setViewState] = useState<ChartView | null>(null);
  const cache = useRef<{ hist: History | null; map: Map<TF, Candle[]> }>({ hist: null, map: new Map() });
  const framed = useRef('');
  const [hover, setHover] = useState<Hover | null>(null);
  const [lastBar, setLastBar] = useState<Hover | null>(null);
  const [autoScale, setAutoScale] = useState(true);

  useEffect(() => {
    const v = new ChartView(el.current!);
    view.current = v;
    setViewState(v);
    v.onClick(() => setSelected(null));
    v.onHover(setHover);
    v.setBlind(!!settings.blind);
    v.onAutoScaleChange = setAutoScale;
    framed.current = '';
    return () => { v.destroy(); view.current = null; setViewState(null); };
  }, [rep, setSelected]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (cache.current.hist !== hist) cache.current = { hist, map: new Map() };
    const day = rep.day, intraday = tf !== 'D';
    // Finished reps reveal the rest of the day; examples stop where the example ends.
    const upto = rep.done && !rep.example ? day.c.length - 1 : rep.cur;
    const candles = buildCandles(tf, hist, day, upto, cache.current.map, rep.done ? null : rep.forming);

    // Re-frame on new timeframe, newly loaded history, or a restart. (Not on stepping: that keeps your zoom.)
    const frameKey = `${tf}|${hist.daily.length}|${hist.m5.length}|${hist.m1?.length ?? 0}|${rep.restarts}`;
    const reframe = frameKey !== framed.current;
    framed.current = frameKey;
    v.render(candles, cfg, intraday, { reframe });
    if (reframe && rep.example && !rep.tutorial && rep.done && rep.ev && intraday) {
      // Frame the whole pattern: from its first labelled point (or the rep start) to the end.
      const first = Math.min(rep.ev.startIdx, ...(rep.ev.marks ?? []).map((m) => m.idx));
      v.frameFrom(candleTimeFor(day.date, Math.max(0, first - 10), tf));
    }
    if (reframe && rep.tutorial && intraday) {
      // Tutorials start zoomed on the action (last ~60 candles). Only on start/restart/timeframe
      // change: after that new candles scroll in and the user's zoom is left alone.
      v.frameLast(60);
    }
    setLastBar(v.lastHover());

    // Price lines
    const lines: LineSpec[] = [];
    const cx = day.ctx;
    if (intraday && cfg.pd && cx) {
      lines.push({ key: 'pdh', price: cx.pdh, color: LEVEL.pd, title: 'PDH', style: LineStyle.Dashed });
      lines.push({ key: 'pdl', price: cx.pdl, color: LEVEL.pd, title: 'PDL', style: LineStyle.Dashed });
      lines.push({ key: 'pc', price: cx.pdc, color: COLORS.grey, title: 'PDC', style: LineStyle.Dashed });
    }
    if (intraday && cfg.dsma && cx) {
      if (cx.sma50 != null) lines.push({ key: 'd50', price: cx.sma50, color: LEVEL.d50, title: 'D 50 SMA', style: LineStyle.LargeDashed });
      if (cx.sma200 != null) lines.push({ key: 'd200', price: cx.sma200, color: LEVEL.d200, title: 'D 200 SMA', style: LineStyle.LargeDashed });
    }
    const or = rep.openingRange;
    if (or && intraday && cfg.or) {
      lines.push({ key: 'orh', price: or.hi, color: COLORS.blue, title: `OR${or.minutes} high`, style: LineStyle.Solid });
      lines.push({ key: 'orl', price: or.lo, color: COLORS.blue, title: `OR${or.minutes} low`, style: LineStyle.Solid });
    }
    // After the rep (or in an example), show the pattern the rule saw: key levels and labelled points.
    // Tutorials reveal each label and level as the replay reaches it.
    const teach = (rep.done || rep.tutorial) && rep.ev && intraday;
    const shown = (idx?: number) => rep.done || (idx ?? -1) <= rep.cur;
    const trigShown = !!rep.ev?.valid && (rep.done || (rep.tutorial && rep.cur >= rep.ev.trigIdx));
    if (teach) rep.ev!.lines?.forEach((l, i) => { if (shown(l.idx)) lines.push({ key: `ev${i}`, price: l.price, color: LEVEL.drill, title: l.text, style: LineStyle.Dashed }); });
    // The textbook trade: in examples once the trigger closes, in drills once the rep is over.
    const ideal = (rep.example || rep.done) && trigShown ? rep.ideal : null;
    if (ideal) {
      lines.push({ key: 'xEntry', price: ideal.entry, color: COLORS.text, title: 'textbook entry', style: LineStyle.Solid });
      lines.push({ key: 'xStop', price: ideal.stop, color: COLORS.down, title: 'stop', style: LineStyle.Solid });
      lines.push({ key: 'xTgt', price: ideal.target, color: COLORS.up, title: `target ${ideal.rr.toFixed(1)}R`, style: LineStyle.Solid });
    }
    v.setLines(lines);
    const br = rep.done ? null : rep.pos;
    v.setExtraPrices(br ? [br.stop, br.target ?? NaN] : ideal ? [ideal.stop, ideal.target] : []);

    // Markers
    const t = (idx: number) => candleTimeFor(day.date, idx, tf) as UTCTimestamp;
    const m: SeriesMarker<Time>[] = [];
    for (const tr of rep.trades) {
      m.push({ time: t(tr.entryBar ?? tr.entryIdx), position: tr.side > 0 ? 'belowBar' : 'aboveBar', color: tr.side > 0 ? COLORS.up : COLORS.down, shape: tr.side > 0 ? 'arrowUp' : 'arrowDown', text: tr.side > 0 ? 'B' : 'S' });
      m.push({ time: t(tr.exitIdx), position: tr.side > 0 ? 'aboveBar' : 'belowBar', color: COLORS.text, shape: 'circle', text: fmtR(tr.R) });
    }
    if (rep.pos) m.push({ time: t(rep.pos.entryBar), position: rep.pos.side > 0 ? 'belowBar' : 'aboveBar', color: COLORS.accent, shape: rep.pos.side > 0 ? 'arrowUp' : 'arrowDown', text: 'open' });
    if (trigShown && rep.ev?.valid) m.push({ time: t(rep.ev.trigIdx), position: rep.ev.dir > 0 ? 'belowBar' : 'aboveBar', color: COLORS.accent, shape: 'square', text: 'valid trigger' });
    if (teach) for (const k of rep.ev!.marks ?? []) if (shown(k.idx)) m.push({ time: t(k.idx), position: k.above ? 'aboveBar' : 'belowBar', color: LEVEL.drill, shape: 'circle', text: k.text });
    v.setMarkers(m);
  }, [rep, version, tf, cfg, hist]);

  const needsHistory = (tf === 1 ? !hist.m1?.length : hist.daily.length === 0 && hist.m5.length === 0) && (historyLoading || tf !== 1);
  return (
    <div id="chartWrap">
      <div id="chart" ref={el} />
      <Legend h={hover ?? lastBar} />
      <ChartOverlay view={viewState} rep={rep} version={version} tool={tool} setTool={setTool} drawings={drawings} setDrawings={setDrawings} selected={selected} setSelected={setSelected} />
      {children}
      {viewState && (() => {
        const r = viewState.paneRect();
        return (
          <button className={`autoBtn ${autoScale ? 'on' : ''}`} style={{ left: r.width - 52, top: r.height - 30 }}
            title={autoScale ? 'Auto-scale is on: the price axis fits the candles. Drag the chart up or down to move freely.' : 'Auto-scale is off. Click to fit the price axis to the candles again (or double-click the price axis).'}
            onClick={() => viewState.setAutoScale(true)}>Auto</button>
        );
      })()}
      {needsHistory && <div className="histnote">{historyLoading ? 'Loading earlier days…' : 'No earlier days available for this chart (showing this day only).'}</div>}
    </div>
  );
}
