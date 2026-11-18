import { biasAllows } from '../core/bias';
import { extreme } from '../core/day';
import { rrOf } from '../core/ideal';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { at, avgRange, bars, ext, fmt, from, MIN_RR, ruleHtml, tolAt, triggerCandle, triggerNames, twoTouchLevel } from './util';

const REV = 2; // each touch must bounce price at least this many average candles away (half for touch 2)
const GAP = 6; // touch 2 comes at least this many candles after touch 1 (a separate test)
const LEVEL_MIN = 180; // touches 1 and 2 within this long of each other
const ZONE = 0.3; // within this many average candles of the level counts as touching it
const RETEST_MIN = 150; // the third test must come within this long of touch 2
const CONFIRM = 3; // candles from the third test for the trigger candle
/** Only look in directions the bias allows (both on a sideways bias). */
export const SRR = {
  SCAN: false,
  /** Stop beyond the level itself (plus this many average candles), not just beyond the test's wick. null = wick only. */
  BEYOND: 0.1 as number | null,
};

// Owner's S/R rule: a line exists once two valleys (support) turned at a common price, or the prior day's
// low plus one valley. Price comes back a third time, rejects it, and a reversal candle (engulfing / hammer)
// is the trigger. Mirror at resistance.
export const srReject: SetupDef = {
  id: 'srReject',
  group: 'Support & resistance',
  label: 'S/R Retest',
  style: 'range',
  preset: { pd: true, dsma: true },
  blurb: 'Two lows at the same price make support. Buy the third test when a reversal candle shows up.',
  rule: (o) => ruleHtml(o, [
    ['1. Build the level', ['<b>Two swing lows at about the same price</b> (or the prior day low plus one swing low)', `Each one bounces: at least ${REV} average candles away after the first`, `The second comes ${GAP}+ candles after the first`, 'Draw the line through them']],
    ['2. Third test', [`Price comes back to the line within ${RETEST_MIN} min`, 'It doesn\'t close through it']],
    ['3. Trigger', [`Within ${CONFIRM} candles of the test: a <b>bullish engulfing</b> candle or a <b>hammer</b> (long lower wick, closes near its high)`, 'Enter at that candle\'s close']],
    ['Risk', ['Stop: <b>below the support line</b> (or below the test\'s lowest wick if it dipped further), not just under the trigger candle', 'Target: the high of the bounce between the touches']],
    ['Skip it if', ['A candle closes through the level', 'No reversal candle shows up', `The target is less than ${MIN_RR}R away`]],
  ], 'mirror it at resistance (two highs, bearish engulfing or shooting star)'),
  evaluate(day, o) {
    const n = day.c.length;
    if (n < bars(day, 200)) return null;
    for (let p = from(o, bars(day, 10)); p < bars(day, 300); p++) {
      for (const dir of [1, -1] as Side[]) {
        if (SRR.SCAN && !biasAllows(o.bias, dir, 'strict', 'range')) continue;
        const lv = twoTouchLevel(day, p, dir, { rev: REV, zone: ZONE, gap: GAP, within: LEVEL_MIN });
        if (!lv) continue;
        const L = lv.price, A = avgRange(day, lv.t2), tol = Math.max(tolAt(L), ZONE * A);
        // Third test: the next return to the line after price bounced off touch 2.
        let react = lv.react, t = -1;
        const last = Math.min(n - CONFIRM - GRACE - 2, lv.ready + bars(day, RETEST_MIN));
        for (let j = lv.ready + 1; j <= last; j++) {
          if (dir * (day.c[j] - L) < -tol) break; // broke before a third test
          const far = ext(day, j, dir);
          if (dir * (far - react) > 0) { react = far; continue; }
          if (dir * (ext(day, j, (-dir) as Side) - L) <= tol) { t = j; break; }
        }
        if (t < 0) continue;

        const role = dir > 0 ? 'support' : 'resistance';
        const proof = `Price turned at ${lv.text}, making ${fmt(L)} ${role}.`;
        const base = { startIdx: Math.min(t, lv.ready + 1), windowEnd: t + CONFIRM + GRACE, levels: {},
          lines: [{ price: L, text: lv.name, idx: lv.t2 }, { price: react, text: `bounce ${dir > 0 ? 'high' : 'low'}`, idx: lv.ready }],
          marks: [...(lv.t1 != null ? [{ idx: lv.t1, text: 'touch 1', above: dir < 0 }] : []), { idx: lv.t2, text: 'touch 2', above: dir < 0 }, { idx: t, text: 'touch 3', above: dir < 0 }] };
        for (let k = t; k <= t + CONFIRM; k++) {
          if (dir * (day.c[k] - L) < -tol) return { ...base, valid: false,
            why: `${proof} Price came back at ${at(day, t)}, but the ${at(day, k)} candle closed through the line. No rejection: the level broke.` };
          const pat = triggerCandle(day, k, dir);
          if (!pat) continue;
          const wick = extreme(day, dir, t, k), stop = SRR.BEYOND == null ? wick : dir > 0 ? Math.min(wick, L - SRR.BEYOND * A) : Math.max(wick, L + SRR.BEYOND * A), rr = rrOf(dir, day.c[k], stop, react);
          if (rr < MIN_RR) return { ...base, valid: false,
            why: `${proof} The ${at(day, t)} test rejected with a ${pat} at ${at(day, k)}, but the bounce ${dir > 0 ? 'high' : 'low'} (${fmt(react)}) was only ${Math.max(0, rr).toFixed(1)}R away. Not enough room to be worth the risk.` };
          return { ...base, valid: true, dir, trigIdx: k, refStop: stop,
            target: { price: react, why: `the ${dir > 0 ? 'high' : 'low'} of the bounce between the touches (${fmt(react)}), where price turned last time` },
            why: `${proof} Price came back for a third test at ${at(day, t)}, held, and the ${at(day, k)} candle was a ${pat}: the trigger.` };
        }
        return { ...base, valid: false, why: `${proof} Price came back for a third test at ${at(day, t)}, but no reversal candle (${triggerNames(dir)}) showed up within ${CONFIRM} candles.` };
      }
    }
    return null;
  },
};
