import { extreme, vwapAt } from '../core/day';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { at, avgRange, bars, ext, from, ruleHtml, triggerCandle, triggerNames } from './util';

const SIDE_MIN = 30; // price on one side of VWAP this long gives the bias
const ZONE = 0.2; // within this many average candles of VWAP counts as a touch
const REV = 1.5; // touch 1 must bounce at least this many average candles away
const FAIL = 0.2; // a close this many average candles through VWAP = lost it
const RETEST_MIN = 120; // the second touch must come within this long of touch 1
const CONFIRM = 3; // candles after the retest for the confirmation

// Bias from the side of VWAP → touch 1 bounces (VWAP respected) → touch 2 rejects → confirmation. Mirror for shorts.
export const vwap: SetupDef = {
  id: 'vwap',
  group: 'Indicators',
  label: 'VWAP Bounce',
  preset: { vwap: true },
  blurb: 'Price respects VWAP once. Buy the second test when it holds, or pass when it loses VWAP.',
  rule: (o) => ruleHtml(o, [
    ['1. Bias', [`Price closes above VWAP for ${SIDE_MIN}+ min`]],
    ['2. Touch 1 (proof)', ['Price pulls back to VWAP', `Bounces at least ${REV} average candles away without closing below it`]],
    ['3. Touch 2 (retest)', [`Price comes back to VWAP within ${RETEST_MIN} min`, 'The test candle <b>closes back above</b> VWAP']],
    ['4. Trigger', [`Within ${CONFIRM} candles of the retest: a <b>bullish engulfing</b> candle or a <b>hammer</b>`, 'Enter at that candle\'s close']],
    ['Risk', ["Stop: below the test candle's low", 'Target: 2R']],
    ['Skip it if', ['A candle closes clearly below VWAP', 'No reversal candle shows up']],
  ], 'mirror it below VWAP'),
  evaluate(day, o) {
    const n = day.c.length, SIDE = bars(day, SIDE_MIN);
    if (n < bars(day, 200)) return null;
    const vw = (i: number) => vwapAt(day, i);
    for (let i = from(o, SIDE + 1); i < Math.min(n - CONFIRM - GRACE - 2, bars(day, 320)); i++) {
      const A = avgRange(day, i);
      for (const dir of [1, -1] as Side[]) {
        let bias = true;
        for (let j = i - SIDE; j < i && bias; j++) if (!(dir * (day.c[j] - vw(j)) > 0)) bias = false;
        if (!bias || dir * (ext(day, i, (-dir) as Side) - vw(i)) > ZONE * A || dir * (day.c[i] - vw(i)) < -FAIL * A) continue;
        // Touch 1 at i: it has to bounce clearly before any close through VWAP.
        let proven = -1, t = -1;
        for (let j = i + 1; j <= Math.min(n - CONFIRM - GRACE - 2, i + bars(day, RETEST_MIN)); j++) {
          const Aj = avgRange(day, j);
          if (dir * (day.c[j] - vw(j)) < -FAIL * Aj) break;
          if (proven < 0) { if (dir * (ext(day, j, dir) - vw(j)) >= REV * Aj) proven = j; continue; }
          if (dir * (ext(day, j, (-dir) as Side) - vw(j)) <= ZONE * Aj) { t = j; break; }
        }
        if (t < 0) continue;
        const At = avgRange(day, t);
        const base = { startIdx: proven + 1, windowEnd: t + CONFIRM + GRACE, levels: {},
          marks: [{ idx: i, text: 'touch 1', above: dir < 0 }, { idx: t, text: 'touch 2', above: dir < 0 }] };
        const side = dir > 0 ? 'above' : 'below', other = dir > 0 ? 'below' : 'above';
        const proof = `Price was ${side} VWAP, tested it at ${at(day, i)} and bounced, so VWAP was respected.`;
        if (dir * (day.c[t] - vw(t)) < -FAIL * At) return { ...base, valid: false,
          why: `${proof} But the ${at(day, t)} retest candle closed ${other} VWAP. It lost VWAP, so no trade.` };
        for (let k = t; k <= t + CONFIRM; k++) {
          if (dir * (day.c[k] - vw(k)) < -FAIL * At) return { ...base, valid: false,
            why: `${proof} It held the ${at(day, t)} retest, but the ${at(day, k)} candle closed ${other} VWAP before confirming.` };
          const pat = triggerCandle(day, k, dir);
          if (pat) return { ...base, valid: true, dir, trigIdx: k, refStop: extreme(day, dir, t, k),
            why: `${proof} Price came back to VWAP at ${at(day, t)}, closed back ${side} it, and the ${at(day, k)} candle was a ${pat}: the trigger.` };
        }
        return { ...base, valid: false, why: `${proof} Price came back at ${at(day, t)} but no reversal candle (${triggerNames(dir)}) showed up within ${CONFIRM} candles.` };
      }
    }
    return null;
  },
};
