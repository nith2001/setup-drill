// Shared helpers for setups: candle-size conversion, swing points, bar size, key levels.
import { hhmm } from '../core/day';
import type { Day, Side } from '../core/types';
import type { SetupOpts } from './types';

/** Minutes → candles on this series (at least 1). */
export const bars = (day: Day, min: number) => Math.max(1, Math.round(min / (day.barMin ?? 1)));
/** Clock time of the start of candle i. */
export const at = (day: Day, i: number) => hhmm(i * (day.barMin ?? 1));
/** Rule text as short labelled sections of bullets. `shorts` says how the rule mirrors for shorts. */
export function ruleHtml(o: SetupOpts, sections: [string, string[]][], shorts?: string): string {
  const head = `<div class="ruleTf">On ${tfName(o)} candles · rules for longs${shorts ? `; shorts: ${shorts}` : ''}</div>`;
  // Every setup starts with the owner's bias step (checked centrally in evaluateAll).
  const bias: [string, string[]] = ['Bias first', ['From the <b>4-hour chart</b>, past <b>week</b>: higher highs and higher lows = <b>up</b> (longs only), lower highs and lower lows = <b>down</b> (shorts only), anything else = <b>sideways</b>', 'Older levels win: if the week ran into support / resistance that held twice in the past 3 months and got <b>rejected</b>, trade the rejection; still pressing into it = <b>wait</b>', 'Sideways = range day: only fades at the edges (Range Fade, S/R Retest), no breakouts']];
  return head + [bias, ...sections].map(([h, items]) => `<div class="ruleSec"><div class="ruleHead">${h}</div><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`).join('');
}

/** "5-min" / "1-min" for rule text. */
export const tfName = (o: SetupOpts) => `${o.barMin ?? 1}-min`;
/** First candle to scan from: the setup's own earliest bar, or later when looking for the next event. */
export const from = (o: SetupOpts, min: number) => Math.max(min, o.from ?? 0);

/** Average bar range (high - low) of the `n` bars ending at i. */
export function avgRange(day: Day, i: number, n = 20): number {
  let s = 0, k = 0;
  for (let j = Math.max(0, i - n + 1); j <= i; j++) { s += day.h[j] - day.l[j]; k++; }
  return k ? s / k : 0;
}

/**
 * Swing point at i, confirmed by `k` bars each side. dir 1 = swing high, -1 = swing low.
 * Earlier bars may tie; later bars must not reach it.
 */
export function isSwing(day: Day, i: number, k: number, dir: Side): boolean {
  if (i - k < 0 || i + k >= day.c.length) return false;
  const x = dir > 0 ? day.h : day.l;
  for (let j = i - k; j <= i + k; j++) {
    if (j === i) continue;
    const d = dir * (x[i] - x[j]);
    if (j < i ? d < 0 : d <= 0) return false;
  }
  return true;
}

/** High (dir 1) or low (dir -1) of bar i. */
export const ext = (day: Day, i: number, dir: Side) => (dir > 0 ? day.h[i] : day.l[i]);

export interface Level { price: number; name: string }

/** Levels everyone watches: prior day high / low / close and the daily 50 / 200 SMA. Near-duplicates merged. */
export function keyLevels(day: Day): Level[] {
  const x = day.ctx;
  if (!x) return [];
  const raw: Level[] = [
    { price: x.pdh, name: 'Prior day high' }, { price: x.pdl, name: 'Prior day low' }, { price: x.pdc, name: 'Prior day close' },
  ];
  if (x.sma50 != null) raw.push({ price: x.sma50, name: 'Daily 50 SMA' });
  if (x.sma200 != null) raw.push({ price: x.sma200, name: 'Daily 200 SMA' });
  const out: Level[] = [];
  for (const l of raw) {
    const near = out.find((o) => Math.abs(o.price - l.price) / l.price < 0.001);
    if (near) near.name += ' + ' + l.name.replace('Prior day ', '').replace('Daily ', 'daily ');
    else out.push({ ...l });
  }
  return out;
}

/** Minimum reward-to-risk to a structural target; closer than this is not worth taking. */
export const MIN_RR = 1.5;

/** Candles each side that confirm a swing point (fewer on 5-min candles). */
export const swingK = (day: Day) => ((day.barMin ?? 1) >= 5 ? 2 : 3);

/** A price where the market turned once: the first touch of a support (dir 1, a swing low) or resistance (dir -1, a swing high). */
export interface Touch { p: number; dir: Side; price: number; name: string; /** a named level (prior day / daily SMA) */ key: boolean }

/**
 * If candle p is a swing low (dir 1) or swing high (dir -1), the level it creates. When the turn happened
 * at a key level (prior day high/low/close, daily SMA), the level takes that price and name.
 */
export function touchAt(day: Day, p: number, dir: Side): Touch | null {
  if (!isSwing(day, p, swingK(day), (-dir) as Side)) return null;
  const x = ext(day, p, (-dir) as Side), tol = Math.max(tolAt(x), 0.15 * avgRange(day, p));
  const key = keyLevels(day).find((L) => Math.abs(L.price - x) <= tol);
  if (key) return { p, dir, price: key.price, name: key.name, key: true };
  return { p, dir, price: x, name: `${dir > 0 ? 'support' : 'resistance'} from ${at(day, p)}`, key: false };
}

/** "Price turned at the prior day high (512.30) at 10:15" / "Price turned down at 512.30 at 10:15". */
export function touchText(day: Day, T: Touch): string {
  const lvl = T.key ? `at the ${T.name.charAt(0).toLowerCase() + T.name.slice(1)} (${fmt(T.price)})` : `${T.dir > 0 ? 'up' : 'down'} at ${fmt(T.price)}`;
  return `Price turned ${lvl} at ${at(day, T.p)}`;
}

/** Price tolerance for "at the level": 0.05%. */
/** Minimum price tolerance for touching a level, as a fraction of price (tuned by the audit). The main tolerance is in average candles. */
export const TOL = { pct: 0.0002 };
export const tolAt = (px: number) => Math.max(0.01, px * TOL.pct);

export const fmt = (px: number) => px.toFixed(2);

// ---------- Owner's model: a candlestick trigger right after the setup's action ----------

/**
 * Reversal/continuation candle in direction `dir` at candle k, or null:
 *  - engulfing: closes in `dir`, the previous candle closed the other way, and this body covers it
 *  - hammer (long) / shooting star (short): a wick against `dir` at least 2× the body and half the
 *    candle, closing in the `dir` third of its range (price was pushed away and rejected)
 */
export function triggerCandle(day: Day, k: number, dir: Side): string | null {
  if (k < 1) return null;
  const o = day.o[k], c = day.c[k], h = day.h[k], l = day.l[k], po = day.o[k - 1], pc = day.c[k - 1];
  const tol = Math.max(0.01, c * 0.0001);
  if (dir * (c - o) > 0 && dir * (pc - po) < 0 && dir * (o - pc) <= tol && dir * (c - po) > 0) return dir > 0 ? 'bullish engulfing' : 'bearish engulfing';
  const range = h - l, body = Math.abs(c - o);
  if (range <= 0) return null;
  const wick = dir > 0 ? Math.min(o, c) - l : h - Math.max(o, c);
  const closePos = dir > 0 ? (c - l) / range : (h - c) / range;
  if (wick >= 2 * body && wick >= 0.5 * range && closePos >= 2 / 3) return dir > 0 ? 'hammer' : 'shooting star';
  return null;
}
export const triggerNames = (dir: Side) => (dir > 0 ? 'a bullish engulfing candle or a hammer' : 'a bearish engulfing candle or a shooting star');

/** A support (side 1) or resistance (side -1) level proven by two turns at a common price. */
export interface Level2 {
  price: number; name: string;
  /** First touch (null = the prior day's low/high served as the first touch). */
  t1: number | null;
  t2: number;
  /** Candle from which price has bounced away from touch 2, so the next return is a retest. */
  ready: number;
  /** Farthest price reached away from the level since touch 1 (the bounce high / low). */
  react: number;
  /** "Two lows at 512.30 (10:05 and 11:20)" style description. */
  text: string;
}

/**
 * Owner's S/R rule: a line counts only once two peaks (resistance) or two valleys (support) turned at
 * a common price. Touch 1 is the swing at p (or the prior day's low/high, if the swing is right at it);
 * price bounces at least `rev` average candles away, comes back, and turns again near the same price
 * (touch 2, at least `gap` candles later), then bounces away again.
 */
export function twoTouchLevel(day: Day, p: number, side: Side, o: { rev: number; zone: number; gap: number; within: number }): Level2 | null {
  const n = day.c.length, K = swingK(day);
  const T = touchAt(day, p, side);
  if (!T) return null;
  const A = avgRange(day, p), tol = Math.max(tolAt(T.price), o.zone * A);
  const priorDay = T.key && T.name.includes(side > 0 ? 'Prior day low' : 'Prior day high');
  const through = (j: number, L: number) => side * (day.c[j] - L) < -tol;
  let react = T.price, j = p + 1;
  const end = Math.min(n - 1, p + bars(day, o.within));
  // Bounce away from the swing at p.
  for (; j <= end; j++) {
    if (through(j, T.price)) return null;
    const far = ext(day, j, side);
    if (side * (far - react) > 0) react = far;
    if (j >= p + K && side * (react - T.price) >= o.rev * A) break;
  }
  if (j > end) return null;
  const fmtT = (i: number) => at(day, i);
  if (priorDay) {
    return { price: T.price, name: T.name, t1: null, t2: p, ready: j, react,
      text: `the ${T.name.charAt(0).toLowerCase() + T.name.slice(1)} (${fmt(T.price)}), which price turned at again at ${fmtT(p)}` };
  }
  // Touch 2: another swing at (about) the same price.
  for (j = j + 1; j <= end; j++) {
    if (through(j, T.price)) return null;
    const far = ext(day, j, side);
    if (side * (far - react) > 0) { react = far; continue; }
    const x = ext(day, j, (-side) as Side);
    if (Math.abs(x - T.price) > tol || j - p < o.gap || !isSwing(day, j, K, (-side) as Side)) continue;
    const L = T.key ? T.price : (T.price + x) / 2, t2 = j;
    // Bounce away again from touch 2 (at least half the first bounce), so a later return is a retest.
    for (let k = t2 + 1; k <= Math.min(n - 1, t2 + bars(day, o.within)); k++) {
      if (side * (day.c[k] - L) < -tol) return null;
      if (k >= t2 + K && side * (ext(day, k, side) - L) >= (o.rev / 2) * A) {
        for (let q = t2; q <= k; q++) if (side * (ext(day, q, side) - react) > 0) react = ext(day, q, side);
        const kind = side > 0 ? 'lows' : 'highs';
        return { price: L, name: T.key ? T.name : `${side > 0 ? 'support' : 'resistance'} ${fmt(L)}`, t1: p, t2, ready: k, react,
          text: `two ${kind} at ${fmt(L)} (${fmtT(p)} and ${fmtT(t2)})${T.key ? `, at the ${T.name.charAt(0).toLowerCase() + T.name.slice(1)}` : ''}` };
      }
    }
    return null;
  }
  return null;
}
