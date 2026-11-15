// User-configurable chart indicators, computed over whatever candles the chart shows.
import type { Candle } from './candles';
import { emaArr, macdArr, rsiArr, smaArr } from './indicators';

export type MAType = 'ema' | 'sma';
export interface MASpec { id: string; type: MAType; period: number; color: string; on: boolean }
export interface IndicatorConfig {
  mas: MASpec[];
  vwap: boolean;
  volume: boolean;
  rsi: { on: boolean; period: number };
  macd: { on: boolean; fast: number; slow: number; signal: number };
}

export const MA_COLORS = ['#58a6ff', '#f0b429', '#c792ea', '#ff7b72', '#7ee787', '#79c0ff', '#ffa657'];

export const DEFAULT_INDICATORS: IndicatorConfig = {
  mas: [
    { id: 'ema9', type: 'ema', period: 9, color: '#58a6ff', on: false },
    { id: 'ema20', type: 'ema', period: 20, color: '#f0b429', on: false },
    { id: 'sma50', type: 'sma', period: 50, color: '#c792ea', on: false },
    { id: 'sma200', type: 'sma', period: 200, color: '#ff7b72', on: false },
  ],
  vwap: true,
  volume: true,
  rsi: { on: false, period: 14 },
  macd: { on: false, fast: 12, slow: 26, signal: 9 },
};

/** What a setup drill needs switched on. */
export interface Preset { mas?: { type: MAType; period: number }[]; rsi?: boolean; macd?: boolean; vwap?: boolean }

export function applyPreset(cfg: IndicatorConfig, p?: Preset): IndicatorConfig {
  const out: IndicatorConfig = structuredClone(cfg);
  if (!p) return out;
  for (const want of p.mas ?? []) {
    const hit = out.mas.find((m) => m.type === want.type && m.period === want.period);
    if (hit) hit.on = true;
    else out.mas.push({ id: `${want.type}${want.period}`, type: want.type, period: want.period, color: MA_COLORS[out.mas.length % MA_COLORS.length], on: true });
  }
  if (p.rsi) out.rsi.on = true;
  if (p.macd) out.macd.on = true;
  if (p.vwap != null) out.vwap = p.vwap;
  return out;
}

export const maLabel = (m: Pick<MASpec, 'type' | 'period'>) => `${m.type.toUpperCase()} ${m.period}`;

/** Session VWAP, reset each date. */
export function vwapSeries(cs: Candle[]): number[] {
  const out: number[] = [];
  let pv = 0, vv = 0, date = '';
  for (const c of cs) {
    if (c.date !== date) { pv = 0; vv = 0; date = c.date; }
    pv += ((c.high + c.low + c.close) / 3) * c.volume; vv += c.volume;
    out.push(vv > 0 ? pv / vv : c.close);
  }
  return out;
}

export interface Overlays {
  mas: { spec: MASpec; values: number[] }[];
  vwap: number[] | null;
  rsi: number[] | null;
  macd: { macd: number[]; signal: number[]; hist: number[] } | null;
}

export function computeOverlays(cs: Candle[], cfg: IndicatorConfig, intraday: boolean): Overlays {
  const close = cs.map((c) => c.close);
  return {
    mas: cfg.mas.filter((m) => m.on && m.period > 0).map((spec) => ({ spec, values: spec.type === 'ema' ? emaArr(close, spec.period) : smaArr(close, spec.period) })),
    vwap: cfg.vwap && intraday ? vwapSeries(cs) : null,
    rsi: cfg.rsi.on ? rsiArr(close, cfg.rsi.period) : null,
    macd: cfg.macd.on ? macdArr(close, cfg.macd.fast, cfg.macd.slow, cfg.macd.signal) : null,
  };
}
