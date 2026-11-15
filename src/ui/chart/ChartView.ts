// Imperative wrapper around Lightweight Charts. React tells it what to show; it figures out how.
import {
  CandlestickSeries, CrosshairMode, HistogramSeries, LineSeries, LineStyle, TickMarkType, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../../core/candles';
import { computeOverlays, maLabel, type IndicatorConfig } from '../../core/overlays';

export const COLORS = { up: '#26a69a', down: '#ef5350', accent: '#f0b429', blue: '#58a6ff', text: '#c9d1d9', grey: '#6e7681', purple: '#c792ea' };

export interface LineSpec { key: string; price: number; color: string; title: string; style?: LineStyle }
export interface Hover { open: number; high: number; low: number; close: number; volume: number; prevClose: number | null }

const ts = (t: number) => t as UTCTimestamp;
const pt = (time: number, v: number) => (isFinite(v) ? { time: ts(time), value: v } : { time: ts(time) });

type Line = ISeriesApi<'Line'>;

export class ChartView {
  readonly chart: IChartApi;
  private candle: ISeriesApi<'Candlestick'>;
  private vol: ISeriesApi<'Histogram'>;
  private markers: ISeriesMarkersPluginApi<Time>;
  private ind: { mas: Map<string, Line>; vwap: Line | null; rsi: Line | null; macd: { m: Line; s: Line; h: ISeriesApi<'Histogram'> } | null } = { mas: new Map(), vwap: null, rsi: null, macd: null };
  private cfg: IndicatorConfig | null = null;
  private lines = new Map<string, { spec: LineSpec; pl: IPriceLine }>();
  private last: Candle[] = [];
  private intraday = true;
  private blind = false;
  /** date -> trading days relative to the rep day (0 = today), for blind axis labels */
  private dayOffset = new Map<string, number>();

  constructor(el: HTMLElement) {
    this.chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: '#0d1117' }, textColor: '#8b97a5', panes: { separatorColor: '#2a3440' } },
      grid: { vertLines: { color: '#161d26' }, horzLines: { color: '#161d26' } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 7, borderColor: '#2a3440' },
      rightPriceScale: { borderColor: '#2a3440' },
      crosshair: { mode: CrosshairMode.Normal },
    });
    this.candle = this.chart.addSeries(CandlestickSeries, { upColor: COLORS.up, downColor: COLORS.down, borderVisible: false, wickUpColor: COLORS.up, wickDownColor: COLORS.down });
    this.vol = this.chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    this.markers = createSeriesMarkers(this.candle, []);
    this.chart.applyOptions({
      timeScale: { tickMarkFormatter: (t: number, type: TickMarkType) => this.tickLabel(t, type) },
      localization: { timeFormatter: (t: number) => this.crosshairLabel(t) },
    });
  }

  /** Blind mode: never show real dates; label days relative to the rep day. */
  setBlind(blind: boolean) { this.blind = blind; this.chart.applyOptions({}); }

  private static hhmm(t: number) { return new Date(t * 1000).toISOString().slice(11, 16); }
  private dayLabel(t: number) {
    const d = new Date(t * 1000).toISOString().slice(0, 10);
    if (!this.blind) return d;
    const off = this.dayOffset.get(d);
    return off == null ? '' : off === 0 ? 'Today' : `D${off}`;
  }
  private tickLabel(t: number, type: TickMarkType): string | null {
    if (type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds) return ChartView.hhmm(t);
    return this.blind ? this.dayLabel(t) : null; // null = library default
  }
  private crosshairLabel(t: number) {
    return this.intraday ? `${this.dayLabel(t)} ${ChartView.hhmm(t)}` : this.dayLabel(t);
  }

  destroy() { this.chart.remove(); }

  onClick(cb: (price: number) => void) {
    this.chart.subscribeClick((p) => { if (!p.point) return; const px = this.candle.coordinateToPrice(p.point.y); if (px != null) cb(px); });
  }

  onHover(cb: (h: Hover | null) => void) {
    this.chart.subscribeCrosshairMove((p) => {
      const c = p.time != null ? this.last.find((x) => x.time === p.time) : undefined;
      if (!c) return cb(null);
      const i = this.last.indexOf(c);
      cb({ ...c, prevClose: i > 0 ? this.last[i - 1].close : null });
    });
  }

  /** Last candle + its predecessor's close, for the legend when not hovering. */
  lastHover(): Hover | null {
    const n = this.last.length;
    return n ? { ...this.last[n - 1], prevClose: n > 1 ? this.last[n - 2].close : null } : null;
  }

  /** Rebuild indicator series and panes for a new config. */
  private rebuildIndicators(cfg: IndicatorConfig) {
    const rm = (s: ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | null) => { if (s) this.chart.removeSeries(s); };
    for (const s of this.ind.mas.values()) rm(s);
    rm(this.ind.vwap); rm(this.ind.rsi);
    if (this.ind.macd) { rm(this.ind.macd.m); rm(this.ind.macd.s); rm(this.ind.macd.h); }
    this.ind = { mas: new Map(), vwap: null, rsi: null, macd: null };
    while (this.chart.panes().length > 1) this.chart.removePane(1);

    const base = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    for (const m of cfg.mas.filter((x) => x.on && x.period > 0)) {
      this.ind.mas.set(m.id, this.chart.addSeries(LineSeries, { ...base, color: m.color, lineWidth: m.period >= 50 ? 2 : 1, title: maLabel(m) }));
    }
    if (cfg.vwap) this.ind.vwap = this.chart.addSeries(LineSeries, { ...base, color: COLORS.accent, lineWidth: 1, lineStyle: LineStyle.Dotted, title: 'VWAP' });
    let pane = 1;
    if (cfg.rsi.on) {
      const r = this.chart.addSeries(LineSeries, { ...base, color: COLORS.purple, lineWidth: 1, title: `RSI ${cfg.rsi.period}`, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) }, pane++);
      r.createPriceLine({ price: 30, color: COLORS.up, lineWidth: 1, lineStyle: LineStyle.Dashed, title: '30', axisLabelVisible: true });
      r.createPriceLine({ price: 70, color: COLORS.down, lineWidth: 1, lineStyle: LineStyle.Dashed, title: '70', axisLabelVisible: true });
      this.ind.rsi = r;
    }
    if (cfg.macd.on) {
      const p = pane++;
      const h = this.chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, p);
      const m = this.chart.addSeries(LineSeries, { ...base, color: COLORS.blue, lineWidth: 1, title: `MACD ${cfg.macd.fast},${cfg.macd.slow},${cfg.macd.signal}` }, p);
      const s = this.chart.addSeries(LineSeries, { ...base, color: COLORS.accent, lineWidth: 1, title: 'signal' }, p);
      m.createPriceLine({ price: 0, color: COLORS.grey, lineWidth: 1, lineStyle: LineStyle.Dashed, title: '', axisLabelVisible: false });
      this.ind.macd = { m, s, h };
    }
    // Price pane gets most of the height; each lower pane an equal smaller share.
    const panes = this.chart.panes();
    panes[0].setStretchFactor(panes.length > 2 ? 2.2 : 3);
    for (const p of panes.slice(1)) p.setStretchFactor(1);
  }

  /**
   * Draw candles + indicators. Updates the last point in place when the candle count is unchanged;
   * otherwise redraws everything (keeping the view pinned to the right edge if it was there).
   */
  render(cs: Candle[], cfg: IndicatorConfig, intraday: boolean, opts: { reframe?: boolean } = {}) {
    const cfgChanged = this.cfg !== cfg || this.intraday !== intraday;
    if (cfgChanged) { this.rebuildIndicators(cfg); this.cfg = cfg; this.intraday = intraday; }
    const prev = this.last;
    this.last = cs;
    if (cs.length && (prev.length === 0 || prev[0] !== cs[0] || cs.length !== prev.length)) {
      const dates = [...new Set(cs.map((c) => c.date))], n = dates.length - 1;
      this.dayOffset = new Map(dates.map((d, i) => [d, i - n]));
    }
    const ov = computeOverlays(cs, cfg, intraday);
    const incremental = !cfgChanged && !opts.reframe && prev.length === cs.length && cs.length > 0 && prev[0]?.time === cs[0].time;

    const volColor = (c: Candle) => (c.close >= c.open ? 'rgba(38,166,154,.35)' : 'rgba(239,83,80,.35)');
    const histColor = (v: number) => (v >= 0 ? 'rgba(38,166,154,.55)' : 'rgba(239,83,80,.55)');

    if (incremental) {
      const i = cs.length - 1, c = cs[i], t = ts(c.time);
      this.candle.update({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
      this.vol.update(cfg.volume ? { time: t, value: c.volume, color: volColor(c) } : { time: t });
      for (const { spec, values } of ov.mas) this.ind.mas.get(spec.id)?.update(pt(c.time, values[i]));
      if (ov.vwap && this.ind.vwap) this.ind.vwap.update(pt(c.time, ov.vwap[i]));
      if (ov.rsi && this.ind.rsi) this.ind.rsi.update(pt(c.time, ov.rsi[i]));
      if (ov.macd && this.ind.macd) {
        this.ind.macd.m.update(pt(c.time, ov.macd.macd[i])); this.ind.macd.s.update(pt(c.time, ov.macd.signal[i]));
        const hv = ov.macd.hist[i];
        this.ind.macd.h.update(isFinite(hv) ? { time: t, value: hv, color: histColor(hv) } : { time: t });
      }
      return;
    }

    const ts0 = this.chart.timeScale(), range = ts0.getVisibleLogicalRange();
    const pinned = !range || range.to >= prev.length - 3;
    this.candle.setData(cs.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    this.vol.setData(cfg.volume ? cs.map((c) => ({ time: ts(c.time), value: c.volume, color: volColor(c) })) : []);
    for (const { spec, values } of ov.mas) this.ind.mas.get(spec.id)?.setData(cs.map((c, i) => pt(c.time, values[i])));
    if (ov.vwap && this.ind.vwap) this.ind.vwap.setData(cs.map((c, i) => pt(c.time, ov.vwap![i])));
    if (ov.rsi && this.ind.rsi) this.ind.rsi.setData(cs.map((c, i) => pt(c.time, ov.rsi![i])));
    if (ov.macd && this.ind.macd) {
      const m = ov.macd;
      this.ind.macd.m.setData(cs.map((c, i) => pt(c.time, m.macd[i])));
      this.ind.macd.s.setData(cs.map((c, i) => pt(c.time, m.signal[i])));
      this.ind.macd.h.setData(cs.map((c, i) => (isFinite(m.hist[i]) ? { time: ts(c.time), value: m.hist[i], color: histColor(m.hist[i]) } : { time: ts(c.time) })));
    }
    if (opts.reframe || cfgChanged) this.frameRight();
    else if (pinned && range) {
      const shift = cs.length - prev.length;
      ts0.setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
    }
  }

  /** Show the most recent ~100 candles. */
  frameRight() {
    const n = this.last.length;
    const set = () => this.chart.timeScale().setVisibleLogicalRange({ from: n - 100, to: n + 12 });
    set(); requestAnimationFrame(set);
  }
  fitAll() { this.chart.timeScale().fitContent(); }

  /** Keyed horizontal price lines on the price chart; only changed lines are touched. */
  setLines(specs: LineSpec[]) {
    const want = new Map(specs.map((s) => [s.key, s]));
    for (const [k, v] of this.lines) {
      const s = want.get(k);
      if (!s || s.price !== v.spec.price || s.color !== v.spec.color || s.title !== v.spec.title) { this.candle.removePriceLine(v.pl); this.lines.delete(k); }
    }
    for (const s of specs) {
      if (this.lines.has(s.key)) continue;
      const pl = this.candle.createPriceLine({ price: s.price, color: s.color, lineWidth: 1, lineStyle: s.style ?? LineStyle.Dashed, axisLabelVisible: true, title: s.title });
      this.lines.set(s.key, { spec: s, pl });
    }
  }

  setMarkers(m: SeriesMarker<Time>[]) {
    this.markers.setMarkers([...m].sort((a, b) => (a.time as number) - (b.time as number)));
  }
}
