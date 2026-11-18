import { biasAllows, testedLevels } from '../core/bias';
import { extreme } from '../core/day';
import type { Day, Eval, Side } from '../core/types';
import { GRACE, type SetupDef, type SetupOpts } from './types';
import { at, avgRange, bars, ext, fmt, from, ruleHtml, tolAt, triggerCandle, triggerNames, twoTouchLevel } from './util';

/** Tunable thresholds (the audit sweeps these). */
export const FLIP = {
  SCAN: true, // only look in the bias direction
  /** Levels from earlier days also count: the prior day's high / low and older tested daily levels. */
  DAY_LEVELS: true,
  REV: 2, // each touch must turn price at least this many average candles away (half for touch 2)
  GAP: 6, // touch 2 comes at least this many candles after touch 1
  LEVEL_MIN: 180, // touches 1 and 2 within this long of each other
  LEVEL_ZONE: 0.3, // touches within this many average candles of each other count as the same level
  BREAK_MIN: 180, // the break must come within this long of touch 2
  AWAY: 1.5, // after the break, price must get this many average candles past the level before a retest counts
  FAIL: 0.5, // a close this many average candles back through the level = fakeout
  RETEST_MIN: 90, // time after the break for the retest
  ZONE: 0.75, // within this many average candles of the level counts as a retest
  CONFIRM: 3, // candles from the retest for the trigger candle
  MIN_AWAY_CANDLES: 3, // the retest comes at least this many candles after the break
};

interface Lvl { name: string; proof: string; marks: { idx: number; text: string; above: boolean }[]; known: number; line: number }

/** After level L breaks at candle b: away → retest → trigger. null = not enough day left. */
function afterBreak(day: Day, L: number, dir: Side, b: number, lv: Lvl, A = avgRange(day, b)): Eval | null {
  const n = day.c.length, tol = Math.max(tolAt(L), 0.1 * A);
  const was = dir > 0 ? 'resistance' : 'support', now = dir > 0 ? 'support' : 'resistance';
  const deadline = b + bars(day, FLIP.RETEST_MIN);
  if (deadline + FLIP.CONFIRM + GRACE + 1 >= n) return null;
  const base = { startIdx: Math.min(b, lv.known + 1), windowEnd: deadline + FLIP.CONFIRM + GRACE, levels: {},
    lines: [{ price: L, text: lv.name, idx: lv.line }] };
  const mk = (r?: number) => [...lv.marks, { idx: b, text: 'break', above: dir > 0 }, ...(r != null ? [{ idx: r, text: 'retest', above: dir < 0 }] : [])];
  const fail = Math.max(tol, FLIP.FAIL * A);
  let away = false, top = ext(day, b, dir);
  for (let r = b + 1; r <= deadline; r++) {
    if (dir * (day.c[r] - L) < -fail) return { ...base, valid: false, marks: mk(r),
      why: `${lv.proof} It broke at ${at(day, b)}, but the ${at(day, r)} candle closed back ${dir > 0 ? 'below' : 'above'} it. A fakeout: old ${was} never became ${now}.` };
    if (!away) { top = dir > 0 ? Math.max(top, day.h[r]) : Math.min(top, day.l[r]); if (dir * (top - L) >= FLIP.AWAY * A) away = true; continue; }
    if (r - b < FLIP.MIN_AWAY_CANDLES || dir * (ext(day, r, (-dir) as Side) - L) > Math.max(FLIP.ZONE * A, tol)) { top = dir > 0 ? Math.max(top, day.h[r]) : Math.min(top, day.l[r]); continue; }
    // Retest candle r: wait for the reversal candle (r itself can be the hammer).
    for (let k = r; k <= r + FLIP.CONFIRM; k++) {
      if (dir * (day.c[k] - L) < -fail) return { ...base, valid: false, marks: mk(r),
        why: `${lv.proof} It broke at ${at(day, b)} and price retested it at ${at(day, r)}, then the ${at(day, k)} candle closed back through. The flip failed.` };
      const pat = triggerCandle(day, k, dir);
      if (!pat) continue;
      const lines = [...base.lines, { price: top, text: `breakout ${dir > 0 ? 'high' : 'low'}`, idx: r }];
      return { ...base, lines, valid: true, dir, trigIdx: k, refStop: extreme(day, dir, r, k), marks: mk(r),
        why: `${lv.proof} The ${at(day, b)} candle broke it, price came back at ${at(day, r)} and held it as ${now}, and the ${at(day, k)} candle was a ${pat}: the trigger.` };
    }
    return { ...base, valid: false, marks: mk(r), why: `${lv.proof} It broke at ${at(day, b)} and price retested it at ${at(day, r)}, but no reversal candle (${triggerNames(dir)}) showed up within ${FLIP.CONFIRM} candles.` };
  }
  return { ...base, valid: false, marks: mk(),
    why: `${lv.proof} It broke at ${at(day, b)} but price ${away ? `never came back to retest it within ${FLIP.RETEST_MIN} minutes` : 'never got clear of the level'}. Chasing the first break isn't this setup.` };
}

/** The first break of a level from an earlier day (prior day high / low, older tested daily levels), or null. */
function dayLevelFlip(day: Day, o: SetupOpts): { b: number; ev: Eval } | null {
  const ctx = day.ctx, n = day.c.length;
  if (!ctx) return null;
  const s0 = from(o, bars(day, 10));
  const cands: { price: number; side: Side; name: string; proof: string }[] = [
    { price: ctx.pdh, side: -1, name: 'Prior day high', proof: `The prior day's high (${fmt(ctx.pdh)}) was resistance.` },
    { price: ctx.pdl, side: 1, name: 'Prior day low', proof: `The prior day's low (${fmt(ctx.pdl)}) was support.` },
  ];
  if (ctx.daily) for (const l of testedLevels(ctx.daily, 0)) {
    const side: Side = l.side === 'resistance' ? -1 : 1;
    cands.push({ price: l.price, side, name: `${l.side} ${fmt(l.price)}`, proof: `${fmt(l.price)} was ${l.side} on the daily chart (turned price on ${l.touches.join(' and ')}).` });
  }
  let best: { b: number; ev: Eval } | null = null;
  for (const c of cands) {
    const dir = (-c.side) as Side; // resistance breaks up, support breaks down
    if (FLIP.SCAN && !biasAllows(o.bias, dir)) continue;
    const tol = Math.max(tolAt(c.price), 0.1 * avgRange(day, s0));
    if (dir * (day.c[s0] - c.price) >= -tol) continue; // must start on the old side of the level
    let b = -1;
    for (let j = s0 + 1; j < Math.min(n, bars(day, 300)); j++) if (dir * (day.c[j] - c.price) > tol) { b = j; break; }
    if (b < 0 || (best && b >= best.b)) continue;
    const ev = afterBreak(day, c.price, dir, b, { name: c.name, proof: c.proof, marks: [], known: s0, line: 0 });
    if (ev) best = { b, ev };
  }
  return best;
}

// Owner's S/R rule: resistance (two highs at a common price today, or a level from earlier days) breaks,
// price comes back, holds it as support, and a reversal candle (engulfing / hammer) is the trigger. Mirror for shorts.
export const srFlip: SetupDef = {
  id: 'srFlip',
  group: 'Support & resistance',
  label: 'S/R Flip (Break & Retest)',
  preset: { pd: true, dsma: true },
  blurb: 'Resistance breaks and becomes support. Buy the retest when a reversal candle shows up.',
  rule: (o) => ruleHtml(o, [
    ['1. The level', [FLIP.DAY_LEVELS ? '<b>Resistance</b>: two swing highs at about the same price today, the <b>prior day high</b>, or an older daily level price turned at twice' : '<b>Two swing highs at about the same price</b> (or the prior day high plus one swing high): resistance', `Today's swing highs must each turn price down: at least ${FLIP.REV} average candles`]],
    ['2. Break', ['A candle <b>closes above</b> the level', `Price gets at least ${FLIP.AWAY} average candles past it`]],
    ['3. Retest', [`Within ${FLIP.RETEST_MIN} min price <b>comes back</b> to the level (now support)`]],
    ['4. Trigger', [`Within ${FLIP.CONFIRM} candles of the retest: a <b>bullish engulfing</b> candle or a <b>hammer</b>`, 'Enter at that candle\'s close']],
    ['Risk', ['Stop: below the retest low', 'Target: 2R (the breakout high is a place for partial profit)']],
    ['Skip it if', ['A candle closes clearly back below the level (fakeout)', 'Price never comes back to retest', 'No reversal candle shows up']],
  ], 'mirror it (support breaks, retest from below)'),
  evaluate(day, o) {
    const n = day.c.length;
    if (n < bars(day, 200)) return null;
    const daily = FLIP.DAY_LEVELS ? dayLevelFlip(day, o) : null;
    for (let p = from(o, bars(day, 10)); p < bars(day, 280); p++) {
      if (daily && p >= daily.b) break; // the earlier day-level break comes first
      for (const dir of [1, -1] as Side[]) {
        if (FLIP.SCAN && !biasAllows(o.bias, dir)) continue;
        // A long flip starts as resistance: two highs at a common price.
        const lv = twoTouchLevel(day, p, (-dir) as Side, { rev: FLIP.REV, zone: FLIP.LEVEL_ZONE, gap: FLIP.GAP, within: FLIP.LEVEL_MIN });
        if (!lv) continue;
        const L = lv.price, A = avgRange(day, lv.t2), tol = Math.max(tolAt(L), 0.1 * A);
        let b = -1;
        for (let j = lv.ready + 1; j <= Math.min(n - 1, lv.t2 + bars(day, FLIP.BREAK_MIN)); j++) if (dir * (day.c[j] - L) > tol) { b = j; break; }
        if (b < 0 || (daily && b >= daily.b)) continue;
        const was = dir > 0 ? 'resistance' : 'support';
        const marks = [...(lv.t1 != null ? [{ idx: lv.t1, text: 'touch 1', above: dir > 0 }] : []), { idx: lv.t2, text: 'touch 2', above: dir > 0 }];
        return afterBreak(day, L, dir, b, { name: lv.name, proof: `Price turned at ${lv.text}, making it ${was}.`, marks, known: lv.ready, line: lv.t2 }, A);
      }
    }
    return daily?.ev ?? null;
  },
};
