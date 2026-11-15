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
