import { biasAllows } from '../core/bias';
import { extreme, rvolTod as relVol } from '../core/day';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { at, avgRange, bars, ext, fmt, ruleHtml, tolAt, triggerCandle, triggerNames } from './util';

/** Tunable thresholds (the audit sweeps these). */
export const ORB = {
  RV: 1.5, // breakout volume vs normal for that time of day
  SCAN: false, // only take breakouts in the bias direction (a counter-bias break doesn't end the search)
  AWAY: 1, // after the breakout, price gets this many average candles past the edge before a retest counts
  RETEST_MIN: 60, // time after the breakout for the retest
  ZONE: 0.4, // within this many average candles of the edge counts as a retest
  FAIL: 0.3, // a close this many average candles back inside the range = failed breakout
  CONFIRM: 3, // candles from the retest for the trigger candle
  WINDOW_MIN: 90, // minutes after the range closes in which a breakout counts
};

const MIN_RANGE_PCT = 0.001; // ranges narrower than 0.1% are skipped

// ORB retest (owner's model): breakout of the opening range, pullback to the range edge, hold, then a reversal
// candle in the breakout direction. A plain breakout can reverse; the retest shows the edge now holds.
export const orb: SetupDef = {
  id: 'orb',
  openOnly: true,
  group: 'Price action',
  label: 'ORB Retest',
  preset: { or: true },
  blurb: 'Opening range breaks, price comes back to the edge, holds, and a reversal candle triggers. Skip failed breakouts.',
  rule: (o) => ruleHtml(o, [
    ['1. Range', [`Mark the high and low of the first ${o.orMin} min`]],
    ['2. Breakout', [`Within ${ORB.WINDOW_MIN} min a candle <b>closes above</b> the range on ≥${ORB.RV}× normal volume for that time of day`, `Price gets at least ${ORB.AWAY} average candle past the range high`]],
    ['3. Retest', [`Within ${ORB.RETEST_MIN} min price <b>comes back</b> to the range high and holds it`]],
    ['4. Trigger', [`Within ${ORB.CONFIRM} candles of the retest: a <b>bullish engulfing</b> candle or a <b>hammer</b>`, 'Enter at that candle\'s close']],
    ['Risk', ['Stop: below the retest low', 'Target: 2R']],
    ['Skip it if', ['Price closes back inside the range (failed breakout)', 'The breakout is on low volume', 'No retest, or no reversal candle']],
  ], 'mirror it below the range low'),
  evaluate(day, o) {
    if (o.from) return null; // once a day
    const n = day.c.length, nb = bars(day, o.orMin), deadline = nb + bars(day, ORB.WINDOW_MIN);
    if (n < deadline + bars(day, ORB.RETEST_MIN) + ORB.CONFIRM + GRACE + 5) return null;
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < nb; i++) { hi = Math.max(hi, day.h[i]); lo = Math.min(lo, day.l[i]); }
    if (!(hi - lo > 0) || (hi - lo) / day.c[0] < MIN_RANGE_PCT) return null;
    // No range lines here: the drill's OR indicator already draws them.
    const base0 = { startIdx: nb, levels: { hi, lo } };
    // The breakout.
    let b = -1, dir: Side = 1, weak: { i: number; rv: number } | null = null;
    for (let i = nb; i <= deadline; i++) {
      const d: Side | 0 = day.c[i] > hi ? 1 : day.c[i] < lo ? -1 : 0;
      if (!d) continue;
      if (ORB.SCAN && !biasAllows(o.bias, d)) continue;
      const rv = relVol(day, i);
      if (rv >= ORB.RV) { b = i; dir = d; break; }
      if (!weak || rv > weak.rv) weak = { i, rv };
    }
    if (b < 0) return { ...base0, windowEnd: deadline + GRACE, valid: false, marks: [{ idx: nb - 1, text: 'range set', above: true }],
      why: weak ? `Price closed outside the range at ${at(day, weak.i)}, but on only ${weak.rv.toFixed(1)}× volume. No real breakout.` : 'Price never closed outside the opening range.' };

    const E = dir > 0 ? hi : lo, A = avgRange(day, b), tol = Math.max(tolAt(E), 0.1 * A), fail = Math.max(tol, ORB.FAIL * A);
    const end = b + bars(day, ORB.RETEST_MIN);
    const base = { ...base0, windowEnd: end + ORB.CONFIRM + GRACE };
    const mk = (r?: number) => [{ idx: nb - 1, text: 'range set', above: true }, { idx: b, text: 'breakout', above: dir > 0 },
      ...(r != null ? [{ idx: r, text: 'retest', above: dir < 0 }] : [])];
    const edge = `range ${dir > 0 ? 'high' : 'low'} (${fmt(E)})`;
    const proof = `The ${at(day, b)} candle broke ${dir > 0 ? 'above' : 'below'} the opening range on ${relVol(day, b).toFixed(1)}× volume.`;
    let away = false;
    for (let r = b + 1; r <= end; r++) {
      if (dir * (day.c[r] - E) < -fail) return { ...base, valid: false, marks: mk(r),
        why: `${proof} But the ${at(day, r)} candle closed back inside the range: a failed breakout. This is exactly the trap the retest rule avoids.` };
      if (!away) { if (dir * (ext(day, r, dir) - E) >= ORB.AWAY * A) away = true; continue; }
      if (dir * (ext(day, r, (-dir) as Side) - E) > Math.max(ORB.ZONE * A, tol)) continue;
      for (let k = r; k <= r + ORB.CONFIRM; k++) {
        if (dir * (day.c[k] - E) < -fail) return { ...base, valid: false, marks: mk(r),
          why: `${proof} Price came back to the ${edge} at ${at(day, r)}, but the ${at(day, k)} candle closed back inside the range. The breakout failed.` };
        const pat = triggerCandle(day, k, dir);
        if (!pat) continue;
        return { ...base, valid: true, dir, trigIdx: k, refStop: extreme(day, dir, r, k), marks: mk(r),
          why: `${proof} Price came back to the ${edge} at ${at(day, r)}, held it, and the ${at(day, k)} candle was a ${pat}: the trigger.` };
      }
      return { ...base, valid: false, marks: mk(r), why: `${proof} Price retested the ${edge} at ${at(day, r)}, but no reversal candle (${triggerNames(dir)}) showed up within ${ORB.CONFIRM} candles.` };
    }
    return { ...base, valid: false, marks: mk(),
      why: `${proof} But price ${away ? `never came back to retest the ${edge} within ${ORB.RETEST_MIN} minutes` : 'never got clear of the range'}. Chasing the breakout isn't this setup.` };
  },
};
