import type { Day } from './types';

// Chart times are "exchange wall-clock as UTC" so the axis reads 09:30..16:00.
export function dayStartTs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 9, 30) / 1000;
}

/** Bar index -> "HH:MM" (ET). */
export function hhmm(idx: number): string {
  const mins = 9 * 60 + 30 + idx;
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

export function prepDay(day: Day): Day {
  if (day._cumPV) return day;
  const n = day.c.length;
  const cumPV = new Float64Array(n), cumV = new Float64Array(n);
  let pv = 0, vv = 0;
  for (let i = 0; i < n; i++) {
    const tp = (day.h[i] + day.l[i] + day.c[i]) / 3;
    pv += tp * day.v[i]; vv += day.v[i];
    cumPV[i] = pv; cumV[i] = vv;
  }
  day._cumPV = cumPV; day._cumV = cumV;
  return day;
}

export function vwapAt(day: Day, i: number): number {
  prepDay(day);
  return day._cumV![i] > 0 ? day._cumPV![i] / day._cumV![i] : day.c[i];
}

/** Volume of bar i relative to the average of the prior `lookback` bars. */
/**
 * Time-of-day relative volume of candle i: its volume vs the average volume of the same minutes over
 * recent sessions (`ctx.vol5`). The opening always trades heavier than midday, so this is the fair
 * comparison. Falls back to `relVol` when the day has no baseline.
 */
export function rvolTod(day: Day, i: number): number {
  const base = day.ctx?.vol5, m = day.barMin ?? 1;
  if (!base?.length) return relVol(day, i);
  let exp = 0;
  for (let min = i * m; min < i * m + m; min++) exp += (base[Math.floor(min / 5)] ?? 0) / 5;
  return exp > 0 ? day.v[i] / exp : relVol(day, i);
}

export function relVol(day: Day, i: number, lookback = 10): number {
  let s = 0, n = 0;
  for (let k = Math.max(0, i - lookback); k < i; k++) { s += day.v[k]; n++; }
  return n && s > 0 ? day.v[i] / (s / n) : 0;
}

export interface AggBar { time: number; open: number; high: number; low: number; close: number; volume: number; lastIdx: number }

/** Aggregate revealed 1m bars (0..upto inclusive) of bucket b into a `tf`-minute bar. */
export function bucketBar(day: Day, b: number, tf: number, upto: number): AggBar {
  const s = b * tf, e = Math.min(s + tf - 1, upto);
  let h = -Infinity, l = Infinity, v = 0;
  for (let i = s; i <= e; i++) {
    if (day.h[i] > h) h = day.h[i];
    if (day.l[i] < l) l = day.l[i];
    v += day.v[i];
  }
  return { time: dayStartTs(day.date) + s * 60, open: day.o[s], high: h, low: l, close: day.c[e], volume: v, lastIdx: e };
}

export function aggregate(day: Day, upto: number, tf: number): AggBar[] {
  const out: AggBar[] = [];
  const nb = Math.floor(upto / tf) + 1;
  for (let b = 0; b < nb; b++) out.push(bucketBar(day, b, tf, upto));
  return out;
}

/** Extreme low (dir>0) or high (dir<0) of bars from..to inclusive. */
export function extreme(day: Day, dir: number, from: number, to: number): number {
  let ref = dir > 0 ? Infinity : -Infinity;
  for (let k = from; k <= to; k++) ref = dir > 0 ? Math.min(ref, day.l[k]) : Math.max(ref, day.h[k]);
  return ref;
}

/**
 * The day as `m`-minute bars (cached). Bar b covers minutes b*m .. b*m+m-1. Carries the prior
 * session's 5-min closes as `warm` so indicators on 5-min bars don't start cold.
 */
export function barsOf(day: Day, m: number): Day {
  if (m <= 1) return day;
  const cache = (day._tf ??= {});
  if (cache[m]) return cache[m];
  const n = day.c.length, nb = Math.ceil(n / m);
  const out: Day = { sym: day.sym, date: day.date, pc: day.pc, ctx: day.ctx, o: [], h: [], l: [], c: [], v: [], barMin: m,
    warm: m === 5 ? day.ctx?.prev5 : undefined };
  for (let b = 0; b < nb; b++) {
    const s = b * m, e = Math.min(n - 1, s + m - 1);
    let h = -Infinity, l = Infinity, v = 0;
    for (let i = s; i <= e; i++) { if (day.h[i] > h) h = day.h[i]; if (day.l[i] < l) l = day.l[i]; v += day.v[i]; }
    out.o.push(day.o[s]); out.h.push(h); out.l.push(l); out.c.push(day.c[e]); out.v.push(v);
  }
  return (cache[m] = out);
}
