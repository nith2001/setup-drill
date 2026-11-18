// Directional bias, the owner's way, decided before the session (no lookahead):
//  1. The past week on the 4-hour chart: higher highs and higher lows = up, lower highs and lower lows = down,
//     anything else = sideways (a range: trade the edges, not breakouts).
//  2. Older tested levels override it: if this week ran into support / resistance that held at least twice in the
//     past ~3 months and got rejected, the bias turns with the rejection. Pressing into one without a rejection
//     yet = wait (no trade until it breaks or rejects).
// Days without 4-hour candles fall back to the older month + week rule on daily closes.
import type { Day, Ohlc, Side } from './types';

export type BiasKind = 'up' | 'down' | 'range' | 'wait';

export interface Bias {
  /** 1 = long, -1 = short, 0 = sideways or wait. */
  dir: Side | 0;
  kind: BiasKind;
  /** Week trend before any level override. */
  week: Side | 0;
  /** The older tested level that changed the bias, if any. */
  level?: { price: number; side: 'support' | 'resistance'; touches: string[] };
  /** Plain-English summary, e.g. "short (week up into resistance at 95.40, rejected)". */
  text: string;
  /** Legacy month component (fallback rule only). */
  month?: Side | 0;
}

/** Setups that trade a trend (breakouts, pullbacks) or a range (fades at the edges). */
export type SetupStyle = 'trend' | 'range';

const H4_WEEK = 10; // 5 sessions × two 4-hour candles

/** Tunable parts of the bias (the audit sweeps these). */
export const BIAS = {
  /** Daily swings within this many average daily ranges = the same level. */
  zone: 0.75,
  /** Older levels count after this many daily swings at a common price (1 = any older swing high / low). */
  touches: 2,
  /** Use older levels at all. */
  levels: true,
  /** Closed back at least this many average daily ranges from the level = rejected. */
  reject: 0.25,
  /** The week's extreme within this many average daily ranges of a level = it ran into it. */
  near: 0.5,
  /** An up week that closed in the bottom part of its range (this fraction) isn't trending: sideways. */
  giveBack: 0.4,
};
const FLAT = 0.005;

const fmt = (x: number) => x.toFixed(2);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/** Week trend from 4-hour candles: compare the second half of the week with the first. */
function weekTrend(h4: Ohlc): { dir: Side | 0; hi: number; lo: number; why: string } {
  const n = h4.c.length, s = Math.max(0, n - H4_WEEK), mid = s + Math.floor((n - s) / 2);
  const hiA = Math.max(...h4.h.slice(s, mid)), hiB = Math.max(...h4.h.slice(mid)), loA = Math.min(...h4.l.slice(s, mid)), loB = Math.min(...h4.l.slice(mid));
  const hi = Math.max(hiA, hiB), lo = Math.min(loA, loB);
  if (hiB > hiA && loB > loA) return { dir: 1, hi, lo, why: 'higher highs and higher lows' };
  if (hiB < hiA && loB < loA) return { dir: -1, hi, lo, why: 'lower highs and lower lows' };
  return { dir: 0, hi, lo, why: hiB > hiA ? 'a higher high but a lower low' : hiB < hiA && loB > loA ? 'an inside week (lower high, higher low)' : 'no clear highs and lows' };
}

/** Older levels (before this week) that held at least twice: pairs of daily swing highs / lows at a common price. */
export function testedLevels(daily: Ohlc & { d: string[] }, week = 5): { price: number; side: 'support' | 'resistance'; touches: string[] }[] {
  const n = daily.c.length, end = n - week, adr = avg(daily.h.slice(-20).map((h, i) => h - daily.l.slice(-20)[i]));
  const out: { price: number; side: 'support' | 'resistance'; touches: string[] }[] = [];
  for (const side of ['resistance', 'support'] as const) {
    const x = side === 'resistance' ? daily.h : daily.l, sgn = side === 'resistance' ? 1 : -1;
    const swings: number[] = [];
    for (let i = 2; i < end - 1; i++) {
      let ok = true;
      for (let j = i - 2; j <= Math.min(end - 1, i + 2); j++) if (j !== i && sgn * (x[j] - x[i]) > 0) ok = false;
      if (ok) swings.push(i);
    }
    for (const i of swings) {
      const near = swings.filter((j) => Math.abs(x[i] - x[j]) <= BIAS.zone * adr && (j === i || Math.abs(j - i) >= 3));
      if (near.length < BIAS.touches) continue;
      const price = sgn > 0 ? Math.max(...near.map((j) => x[j])) : Math.min(...near.map((j) => x[j]));
      if (!out.some((l) => l.side === side && Math.abs(l.price - price) <= BIAS.zone * adr)) out.push({ price, side, touches: near.map((j) => daily.d[j]) });
    }
  }
  return out;
}

export function biasOf(day: Day): Bias | null {
  const h4 = day.ctx?.h4, daily = day.ctx?.daily;
  if (!h4 || h4.c.length < H4_WEEK || !daily || daily.c.length < 30) return legacyBias(day);
  const w = weekTrend(h4), last = h4.c[h4.c.length - 1];
  const adr = avg(daily.h.slice(-20).map((h, i) => h - daily.l.slice(-20)[i]));
  const wk = w.dir > 0 ? 'up' : w.dir < 0 ? 'down' : 'sideways';
  // Older tested levels this week ran into (resistance above for an up week, support below for a down week;
  // a sideways week checks both).
  const ext = (l: { side: string }) => (l.side === 'resistance' ? w.hi : w.lo);
  const levels = !BIAS.levels ? [] : testedLevels(daily).filter((l) => (l.side === 'resistance' ? w.dir >= 0 : w.dir <= 0))
    .sort((a, b) => Math.abs(a.price - ext(a)) - Math.abs(b.price - ext(b)));
  for (const l of levels) {
    const res = l.side === 'resistance', reached = res ? w.hi >= l.price - BIAS.near * adr : w.lo <= l.price + BIAS.near * adr;
    if (!reached) continue;
    const away = res ? l.price - last : last - l.price; // how far price closed back from the level
    const at = `${l.side} at ${fmt(l.price)} (turned price on ${l.touches.join(' and ')})`;
    if (away >= BIAS.reject * adr) {
      const dir: Side = res ? -1 : 1;
      return { dir, kind: dir > 0 ? 'up' : 'down', week: w.dir, level: l, text: `${dir > 0 ? 'long' : 'short'}: the week ran ${res ? 'up' : 'down'} into older ${at} and got rejected (closed ${fmt(last)})` };
    }
    if (away > -BIAS.reject * adr) return { dir: 0, kind: 'wait', week: w.dir, level: l, text: `wait: the week is pressing into older ${at} with no rejection or breakout yet` };
    // Closed clearly through it: a breakout, the week trend stands.
  }
  // Not near an old level: the week decides. A week that's pulled back below the middle of its range isn't trending.
  if (w.dir !== 0) {
    const pos = (last - w.lo) / (w.hi - w.lo || 1);
    if (w.dir > 0 ? pos < BIAS.giveBack : pos > 1 - BIAS.giveBack) return { dir: 0, kind: 'range', week: w.dir, text: `sideways: the week made ${w.why} but gave most of it back (closed ${fmt(last)})` };
    return { dir: w.dir, kind: wk as BiasKind, week: w.dir, text: `${w.dir > 0 ? 'long' : 'short'} (4-hour week ${wk}: ${w.why})` };
  }
  return { dir: 0, kind: 'range', week: 0, text: `sideways (4-hour week: ${w.why}, range ${fmt(w.lo)}–${fmt(w.hi)}): fade the edges, skip breakouts` };
}

/** Older rule for days without 4-hour candles: month (20 sessions) and week (5) of daily closes must agree. */
function legacyBias(day: Day): Bias | null {
  const cs = day.ctx?.closes;
  if (!cs || cs.length < 21) return null;
  const last = cs[cs.length - 1];
  const sma20 = cs.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const chg = (n: number) => (last - cs[cs.length - 1 - n]) / cs[cs.length - 1 - n];
  const m = chg(20), w = chg(5);
  const month: Side | 0 = m > FLAT && last > sma20 ? 1 : m < -FLAT && last < sma20 ? -1 : 0;
  const week: Side | 0 = w > FLAT ? 1 : w < -FLAT ? -1 : 0;
  const dir: Side | 0 = month !== 0 && month === week ? month : 0;
  const word = (x: Side | 0) => (x > 0 ? 'up' : x < 0 ? 'down' : 'flat');
  return { dir, kind: dir > 0 ? 'up' : dir < 0 ? 'down' : 'wait', month, week, text: `${dir > 0 ? 'long' : dir < 0 ? 'short' : 'none'} (month ${word(month)}, week ${word(week)})` };
}

/**
 * How strict a setup is about bias. strict: the bias points the trade's way. lenient (legacy rule): month or week
 * agrees and neither opposes. week: the week trend agrees. Range setups also trade both ways on a sideways bias.
 */
export type BiasMode = 'strict' | 'lenient' | 'week' | 'none';
export function biasAllows(b: Bias | null | undefined, dir: Side, mode: BiasMode = 'strict', style: SetupStyle = 'trend'): boolean {
  if (!b || mode === 'none') return true;
  if (style === 'range' && b.kind === 'range') return true;
  if (mode === 'week') return b.week === dir;
  if (mode === 'lenient' && b.month != null) return b.month !== -dir && b.week !== -dir && (b.month === dir || b.week === dir);
  return b.dir === dir;
}
