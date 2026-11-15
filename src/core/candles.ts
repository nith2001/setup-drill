// Timeframes and multi-day candle series for the chart.
// The rep day is 1-min bars; days before it come from History (5-min bars + daily bars).
import { dayStartTs } from './day';
import type { Day } from './types';

export type TF = 1 | 5 | 15 | 60 | 240 | 'D';
export const TFS: TF[] = [1, 5, 15, 60, 240, 'D'];
export const tfLabel = (tf: TF) => (tf === 'D' ? '1D' : tf >= 60 ? `${tf / 60}h` : `${tf}m`);

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; date: string }

/** One regular session at a fixed bar step (minutes) from 09:30 ET. */
export interface SessionBars { date: string; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }

/** Context before the rep day (strictly earlier dates). */
export interface History { daily: Candle[]; m5: SessionBars[] }
export const EMPTY_HISTORY: History = { daily: [], m5: [] };

/** Group a session's bars (each `stepMin` long) into `tfMin` candles, using bars 0..upto. */
function bucketize(s: SessionBars, stepMin: number, tfMin: number, upto = s.c.length - 1): Candle[] {
  const per = Math.max(1, Math.round(tfMin / stepMin)), t0 = dayStartTs(s.date), out: Candle[] = [];
  for (let b = 0; b <= upto; b += per) {
    const e = Math.min(b + per - 1, upto);
    let high = -Infinity, low = Infinity, volume = 0;
    for (let i = b; i <= e; i++) { if (s.h[i] > high) high = s.h[i]; if (s.l[i] < low) low = s.l[i]; volume += s.v[i]; }
    out.push({ time: t0 + b * stepMin * 60, open: s.o[b], high, low, close: s.c[e], volume, date: s.date });
  }
  return out;
}

/** Candles for the chart at timeframe `tf`, with the rep day revealed up to 1-min bar `upto`. */
export function buildCandles(tf: TF, hist: History, day: Day, upto: number, priorCache?: Map<TF, Candle[]>): Candle[] {
  const today = bucketize(day, 1, tf === 'D' ? 390 : tf, upto);
  if (tf === 1) return today;
  let prior = priorCache?.get(tf);
  if (!prior) {
    prior = tf === 'D' ? hist.daily : hist.m5.flatMap((s) => bucketize(s, 5, tf));
    priorCache?.set(tf, prior);
  }
  return prior.concat(today);
}

/** Chart time of the candle that contains 1-min bar `idx` of the rep day. */
export const candleTimeFor = (date: string, idx: number, tf: TF) =>
  tf === 'D' ? dayStartTs(date) : dayStartTs(date) + Math.floor(idx / tf) * tf * 60;

/** Last 1-min index of the next full candle at `tf` after `cur` (for "step one bar"). */
export function nextBarEnd(cur: number, tf: TF, lastIdx: number): number {
  if (tf === 'D') return lastIdx;
  return Math.min(lastIdx, Math.floor((cur + 1) / tf) * tf + tf - 1);
}

/** Demo mode: build History from earlier days of the same symbol in the dataset. */
export function historyFromDays(days: Day[], sym: string, date: string, m5Days = 40): History {
  const prior = days.filter((d) => d.sym === sym && d.date < date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const daily = prior.map((d) => bucketize(d, 1, 390)[0]);
  const m5 = prior.slice(-m5Days).map((d) => {
    const cs = bucketize(d, 1, 5);
    return { date: d.date, o: cs.map((c) => c.open), h: cs.map((c) => c.high), l: cs.map((c) => c.low), c: cs.map((c) => c.close), v: cs.map((c) => c.volume) };
  });
  return { daily, m5 };
}
