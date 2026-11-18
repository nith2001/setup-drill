import { biasAllows, biasOf, type Bias, type BiasMode, type SetupStyle } from '../core/bias';
import { barsOf, prepDay } from '../core/day';
import type { Day, Eval } from '../core/types';
import { ema } from './ema';
import { flag } from './flag';
import { gap } from './gap';
import { macd } from './macd';
import { orb } from './orb';
import { orbBreak } from './orbBreak';
import { rangeFade } from './rangeFade';
import { rsi } from './rsi';
import { srFlip } from './srFlip';
import { srReject } from './srReject';
import { trend123 } from './trend123';
import type { SetupDef, SetupOpts } from './types';
import { vwap } from './vwap';

export type { SetupDef, SetupOpts } from './types';

/** Registry: add new setups here. Order = order on the home screen. */
export const SETUPS: SetupDef[] = [orbBreak, orb, gap, vwap, trend123, flag, srReject, srFlip, rangeFade, ema, macd, rsi];

export const SETUP_BY_ID: Record<string, SetupDef> = Object.fromEntries(SETUPS.map((s) => [s.id, s]));

/** Free play is a rep mode with no rule. */
export const FREE_PLAY = { id: 'random', label: 'Free play', blurb: 'Any day, no rules. Scored on P&L and trade management.' } as const;

/** Most events taken from one day per setup. */
const MAX_EVENTS = 4;

/** Convert an eval on `m`-minute candles to 1-min indices. A candle's trigger is its closing minute. */
function toMinutes(e: Eval, m: number, n: number): Eval {
  if (m === 1) return { ...e, barMin: 1 };
  const close = (b: number) => Math.min(n - 1, b * m + m - 1);
  const out = { ...e, barMin: m, startIdx: e.startIdx * m, windowEnd: close(e.windowEnd),
    marks: e.marks?.map((k) => ({ ...k, idx: close(k.idx) })), lines: e.lines?.map((l) => (l.idx == null ? l : { ...l, idx: close(l.idx) })) };
  return e.valid ? { ...out, valid: true, trigIdx: close(e.trigIdx) } as Eval : out as Eval;
}

/**
 * Owner's process, step 1: bias first. A setup only counts in the direction of the 4-hour bias (past
 * month and week). A pattern that's valid on its own but points against the bias, or comes on a day
 * with no clear bias, is a pass.
 */
function withBias(e: Eval, bias: Bias | null, mode: BiasMode = 'strict', style: SetupStyle = 'trend'): Eval {
  if (!bias || !e.valid || mode === 'none') return e;
  if (biasAllows(bias, e.dir, mode, style)) return { ...e, why: `Bias ${bias.text}. ${e.why}` };
  const { dir, trigIdx: _t, refStop: _r, target: _g, ...rest } = e;
  const side = dir > 0 ? 'long' : 'short';
  return { ...rest, valid: false, why: `${e.why} The pattern itself was there, but it's a ${side} ${bias.kind === 'range' ? 'breakout-style trade on a sideways bias (range days only take fades at the edges)' : bias.kind === 'wait' ? 'while the bias says wait' : 'against your bias'}: ${bias.text}. That's a pass.` };
}

/**
 * Every event of a setup on a day, in order, without overlapping windows. Rules run on
 * `opts.barMin`-minute candles; results use 1-min indices like the rest of the app.
 */
export function evaluateAll(id: string, day: Day, opts: SetupOpts = { orMin: 15 }): Eval[] {
  const s = SETUP_BY_ID[id];
  if (!s) return [];
  const m = opts.barMin ?? 1, series = prepDay(barsOf(prepDay(day), m)), bias = biasOf(day);
  const out: Eval[] = [];
  let from = 0;
  for (let k = 0; k < MAX_EVENTS; k++) {
    const raw = s.evaluate(series, { ...opts, barMin: m, from, bias });
    if (!raw || raw.windowEnd < from) break;
    // A later event's rep starts after the previous one ends (its context is still on the chart).
    const e = k && raw.startIdx < from ? { ...raw, startIdx: from } : raw;
    out.push(withBias(toMinutes(e, m, day.c.length), bias, s.biasMode, s.style));
    from = e.windowEnd + 1;
  }
  return out;
}

/** The day's first event for a setup (null if none). */
export function evaluate(id: string, day: Day, opts: SetupOpts = { orMin: 15 }): Eval | null {
  return evaluateAll(id, day, opts)[0] ?? null;
}

/** Quiet charts start this many minutes after the open at the earliest. */
const QUIET_OPEN_MIN = 30;

/**
 * A quiet no-trade chart: a random stretch of the day (60–120 min) where this setup never even starts, so the
 * right call is to sit on your hands. null if the setup is tied to the open or no clean stretch turns up.
 * The stretch also stays clear of the drill's lead-in (`lead` minutes before it).
 */
export function quietWindow(id: string, day: Day, opts: SetupOpts = { orMin: 15 }, lead = 18 * (opts.barMin ?? 1)): Eval | null {
  const s = SETUP_BY_ID[id];
  if (!s || s.openOnly) return null;
  const m = opts.barMin ?? 1, n = day.c.length, series = prepDay(barsOf(prepDay(day), m)), bias = biasOf(day);
  const events = evaluateAll(id, day, opts);
  for (let attempt = 0; attempt < 8; attempt++) {
    const len = (60 + Math.floor(Math.random() * 61)), lo = QUIET_OPEN_MIN + lead, hi = n - len - 15;
    if (hi <= lo) return null;
    const a = Math.floor((lo + Math.random() * (hi - lo)) / m) * m, b = a + len - 1, a0 = a - lead;
    // Walk all the setup's events from the open (the drill's events plus any past its per-day cap); any event
    // touching the stretch, lead-in included, rules it out.
    let f = 0, clash = events.some((e) => e.startIdx <= b && e.windowEnd >= a0);
    for (let k = 0; k < 40 && !clash; k++) {
      const raw = s.evaluate(series, { ...opts, barMin: m, from: f, bias });
      if (!raw || raw.windowEnd < f) break;
      const e = toMinutes(raw, m, n);
      if (e.windowEnd < a0) { f = raw.windowEnd + 1; continue; }
      clash = e.startIdx <= b;
      break;
    }
    if (clash) continue;
    return { valid: false, startIdx: a, windowEnd: b, barMin: m, levels: {},
      why: `Quiet chart: no ${s.label} setup started anywhere in this stretch. Most of a trading day looks like this, and the right call was to sit on your hands.` };
  }
  return null;
}
