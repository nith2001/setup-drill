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

  useEffect(() => {
    const v = new ChartView(el.current!);
    view.current = v;
    setViewState(v);
    v.onClick(() => setSelected(null));
    v.onHover(setHover);
    v.setBlind(!!settings.blind);
    framed.current = '';
    return () => { v.destroy(); view.current = null; setViewState(null); };
  }, [rep, setSelected]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (cache.current.hist !== hist) cache.current = { hist, map: new Map() };
    const day = rep.day, intraday = tf !== 'D';
    const upto = rep.done ? day.c.length - 1 : rep.cur;
    const candles = buildCandles(tf, hist, day, upto, cache.current.map);

    // Re-frame on new timeframe, newly loaded history, or a restart.
    const frameKey = `${tf}|${hist.daily.length}|${hist.m5.length}|${hist.m1?.length ?? 0}|${rep.cur === rep.startIdx - 1 ? 'start' : ''}`;
    const reframe = frameKey !== framed.current;
    framed.current = frameKey;
    v.render(candles, cfg, intraday, { reframe });
    setLastBar(v.lastHover());

    // Price lines
    const lines: LineSpec[] = [];
    if (intraday && day.pc != null) lines.push({ key: 'pc', price: day.pc, color: COLORS.grey, title: 'prev close', style: LineStyle.Dotted });
    const or = rep.openingRange;
    if (or && intraday && cfg.or) {
      lines.push({ key: 'orh', price: or.hi, color: COLORS.blue, title: `OR${or.minutes} high`, style: LineStyle.Solid });
      lines.push({ key: 'orl', price: or.lo, color: COLORS.blue, title: `OR${or.minutes} low`, style: LineStyle.Solid });
    }
    v.setLines(lines);
    const br = rep.done ? null : rep.pos;
    v.setExtraPrices(br ? [br.stop, br.target ?? NaN] : []);

    // Markers
    const t = (idx: number) => candleTimeFor(day.date, idx, tf) as UTCTimestamp;
    const m: SeriesMarker<Time>[] = [];
    for (const tr of rep.trades) {
      m.push({ time: t(tr.entryIdx), position: tr.side > 0 ? 'belowBar' : 'aboveBar', color: tr.side > 0 ? COLORS.up : COLORS.down, shape: tr.side > 0 ? 'arrowUp' : 'arrowDown', text: tr.side > 0 ? 'B' : 'S' });
      m.push({ time: t(tr.exitIdx), position: tr.side > 0 ? 'aboveBar' : 'belowBar', color: COLORS.text, shape: 'circle', text: fmtR(tr.R) });
    }
    if (rep.pos) m.push({ time: t(rep.pos.entryIdx), position: rep.pos.side > 0 ? 'belowBar' : 'aboveBar', color: COLORS.accent, shape: rep.pos.side > 0 ? 'arrowUp' : 'arrowDown', text: 'open' });
    if (rep.done && rep.ev?.valid) m.push({ time: t(rep.ev.trigIdx), position: rep.ev.dir > 0 ? 'belowBar' : 'aboveBar', color: COLORS.accent, shape: 'square', text: 'valid trigger' });
    v.setMarkers(m);
  }, [rep, version, tf, cfg, hist]);

  const needsHistory = (tf === 1 ? !hist.m1?.length : hist.daily.length === 0 && hist.m5.length === 0) && (historyLoading || tf !== 1);
  return (
    <div id="chartWrap">
      <div id="chart" ref={el} />
      <Legend h={hover ?? lastBar} />
      <ChartOverlay view={viewState} rep={rep} version={version} tool={tool} setTool={setTool} drawings={drawings} setDrawings={setDrawings} selected={selected} setSelected={setSelected} />
      {children}
      {needsHistory && <div className="histnote">{historyLoading ? 'Loading earlier days…' : 'No earlier days available for this chart (showing this day only).'}</div>}
    </div>
  );
}
