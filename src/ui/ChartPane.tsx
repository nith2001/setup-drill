import { LineStyle, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { buildCandles, candleTimeFor, type Candle, type History, type TF } from '../core/candles';
import type { IndicatorConfig } from '../core/overlays';
import type { Replay } from '../engine/replay';
import { COLORS, ChartView, type Hover, type LineSpec } from './chart/ChartView';
import { fmtR, settings, toast } from './state';

interface Props { rep: Replay; version: number; tf: TF; cfg: IndicatorConfig; hist: History; historyLoading: boolean }

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

export function ChartPane({ rep, version, tf, cfg, hist, historyLoading }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const view = useRef<ChartView | null>(null);
  const cache = useRef<{ hist: History | null; map: Map<TF, Candle[]> }>({ hist: null, map: new Map() });
  const framed = useRef('');
  const [hover, setHover] = useState<Hover | null>(null);
  const [lastBar, setLastBar] = useState<Hover | null>(null);

  useEffect(() => {
    const v = new ChartView(el.current!);
    view.current = v;
    v.onClick((px) => { const err = rep.setStop(px); if (err) toast(err); });
    v.onHover(setHover);
    v.setBlind(!!settings.blind);
    framed.current = '';
    return () => { v.destroy(); view.current = null; };
  }, [rep]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (cache.current.hist !== hist) cache.current = { hist, map: new Map() };
    const day = rep.day, intraday = tf !== 'D';
    const upto = rep.done ? day.c.length - 1 : rep.cur;
    const candles = buildCandles(tf, hist, day, upto, cache.current.map);

    // Re-frame on new timeframe, newly loaded history, or a restart.
    const frameKey = `${tf}|${hist.daily.length}|${hist.m5.length}|${rep.cur === rep.startIdx - 1 ? 'start' : ''}`;
    const reframe = frameKey !== framed.current;
    framed.current = frameKey;
    v.render(candles, cfg, intraday, { reframe });
    setLastBar(v.lastHover());

    // Price lines
    const lines: LineSpec[] = [];
    if (intraday && day.pc != null) lines.push({ key: 'pc', price: day.pc, color: COLORS.grey, title: 'prev close', style: LineStyle.Dotted });
    const or = rep.openingRange;
    if (or && intraday) {
      lines.push({ key: 'orh', price: or.hi, color: COLORS.blue, title: `OR${or.minutes} high`, style: LineStyle.Solid });
      lines.push({ key: 'orl', price: or.lo, color: COLORS.blue, title: `OR${or.minutes} low`, style: LineStyle.Solid });
    }
    if (rep.pos) {
      const p = rep.pos;
      lines.push({ key: 'pstop', price: p.stop, color: COLORS.down, title: 'stop', style: LineStyle.Solid });
      lines.push({ key: 'entry', price: p.entry, color: COLORS.text, title: p.side > 0 ? 'long' : 'short', style: LineStyle.Dotted });
      if (p.target) lines.push({ key: 'tgt', price: p.target, color: COLORS.up, title: `${rep.tgtR}R`, style: LineStyle.Solid });
    } else if (rep.stopPx != null && !rep.done) {
      lines.push({ key: 'stop', price: rep.stopPx, color: COLORS.down, title: 'planned stop' });
    }
    v.setLines(lines);

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

  const needsHistory = tf !== 1 && hist.daily.length === 0 && hist.m5.length === 0;
  return (
    <div id="chartWrap">
      <div id="chart" ref={el} />
      <Legend h={hover ?? lastBar} />
      {!rep.pos && rep.stopPx == null && !rep.done && <div id="hint">Click the chart to place your stop</div>}
      {needsHistory && <div className="histnote">{historyLoading ? 'Loading earlier days…' : 'No earlier days available for this chart (showing this day only).'}</div>}
    </div>
  );
}
