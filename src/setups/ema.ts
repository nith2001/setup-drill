import { indicators } from '../core/indicators';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { at, avgRange, bars, from, ruleHtml, triggerCandle, triggerNames } from './util';

const TREND = 8; // candles of 9 over 20
const SEP = 0.4; // average 9–20 gap over the trend, in average candles
const SLOPE = 1; // 20 EMA rise over the trend, in average candles
const DEPTH = 1; // pullback from the trend's high, in average candles
const RESUME = 4; // candles after a touch to bounce
const CLEAR = 0.1; // the bounce close must clear the 9 EMA by this many average candles
const AWAY = 1; // between touches price must get this many average candles clear of the 20 EMA
const RETEST_MIN = 120; // the second touch must come within this long of the first bounce
const MIN_GAP = 4; // candles between touch 1 and touch 2 (a separate pullback)

// Clear trend → touch 1 of the 20 EMA bounces (the EMA is respected) → touch 2 → decisive close back past the 9 EMA
export const ema: SetupDef = {
  id: 'ema',
  group: 'Indicators',
  label: '9/20 EMA Pullback',
  preset: { mas: [{ type: 'ema', period: 9 }, { type: 'ema', period: 20 }] },
  blurb: 'A trend respects the 20 EMA once. Buy the second pullback when it bounces, or pass when it breaks.',
  rule: (o) => ruleHtml(o, [
    ['1. Trend', [`9 EMA above the 20 EMA for ${TREND}+ candles, visibly apart`, '20 EMA clearly rising']],
    ['2. Touch 1 (proof)', [`A pullback of at least ${DEPTH} average candle touches the 20 EMA`, `It bounces: a green candle closes clearly above the 9 EMA within ${RESUME} candles`]],
    ['3. Touch 2 (retest)', [`Price gets clear, then pulls back to the 20 EMA again within ${RETEST_MIN} min`]],
    ['4. Trigger', [`Within ${RESUME} candles of touch 2: a <b>bullish engulfing</b> candle or a <b>hammer</b>`, 'Enter at that candle\'s close']],
    ['Risk', ['Stop: below the trigger candle (no lower than the pullback low)', 'Target: 2R']],
    ['Skip it if', ['A candle closes below the 20 EMA', 'No reversal candle shows up']],
  ], 'mirror it (9 below a falling 20)'),
  evaluate(day, o) {
    const { e9, e20 } = indicators(day), n = day.c.length;
    const first = day.warm?.length ? TREND + 2 : 30; // with prior-session warmup the EMAs are ready early
    const touches = (i: number, dir: Side, A: number) => (dir > 0 ? day.l[i] <= e20[i] + 0.1 * A : day.h[i] >= e20[i] - 0.1 * A);
    const bounce = (k: number, dir: Side, A: number) => dir * (day.c[k] - e9[k]) > CLEAR * A && dir * (day.c[k] - day.o[k]) > 0;
    const broke = (k: number, dir: Side) => dir * (day.c[k] - e20[k]) < 0;
    for (let i = from(o, first); i < Math.min(n - RESUME - GRACE - 1, bars(day, 330)); i++) {
      const A = avgRange(day, i);
      for (const dir of [1, -1] as Side[]) {
        let trend = dir * (e20[i - 1] - e20[i - 1 - TREND]) >= SLOPE * A, sep = 0;
        for (let k = i - TREND; trend && k < i; k++) { const g = dir * (e9[k] - e20[k]); if (!(g > 0)) trend = false; sep += g; }
        if (!trend || sep / TREND < SEP * A || !touches(i, dir, A)) continue;
        const high = dir > 0 ? Math.max(...day.h.slice(i - TREND, i + 1)) : Math.min(...day.l.slice(i - TREND, i + 1));
        if (dir * (high - (dir > 0 ? day.l[i] : day.h[i])) < DEPTH * A) continue;
        // Touch 1 must be respected: a bounce before any close through the 20.
        let r1 = -1;
        for (let k = i; k <= i + RESUME && k < n; k++) { if (broke(k, dir)) break; if (bounce(k, dir, A)) { r1 = k; break; } }
        if (r1 < 0) continue;
        // Touch 2: price gets clear, then comes back to the 20 while the trend holds.
        let clear = false, j = -1;
        for (let m = r1 + 1; m <= Math.min(n - RESUME - GRACE - 2, r1 + bars(day, RETEST_MIN)); m++) {
          const Am = avgRange(day, m);
          if (broke(m, dir) || !(dir * (e9[m - 1] - e20[m - 1]) > 0)) break; // trend broke between touches
          if (!clear) { if (dir * ((dir > 0 ? day.h[m] : day.l[m]) - e20[m]) >= AWAY * Am) clear = true; continue; }
          if (m - i >= MIN_GAP && touches(m, dir, Am)) { j = m; break; }
        }
        if (j < 0) continue;
        const deadline = j + RESUME;
        const base = { startIdx: r1 + 1, windowEnd: deadline + GRACE, levels: {},
          marks: [{ idx: i, text: 'touch 1', above: dir < 0 }, { idx: j, text: 'touch 2', above: dir < 0 }] };
        const proof = `The 20 EMA was respected at ${at(day, i)} (price bounced off it).`;
        let ref = dir > 0 ? Infinity : -Infinity;
        for (let k = j; k <= deadline; k++) {
          ref = dir > 0 ? Math.min(ref, day.l[k]) : Math.max(ref, day.h[k]);
          if (broke(k, dir)) return { ...base, valid: false,
            why: `${proof} On the second pullback the ${at(day, k)} candle closed ${dir > 0 ? 'below' : 'above'} the 20 EMA, so the trend broke. No trade.` };
          const pat = triggerCandle(day, k, dir);
          if (pat) return { ...base, valid: true, dir, trigIdx: k, refStop: ref,
            why: `${proof} Price pulled back to it again at ${at(day, j)}, held, and the ${at(day, k)} candle was a ${pat}: the trigger.` };
        }
        return { ...base, valid: false, why: `${proof} Price came back to it at ${at(day, j)} but no reversal candle (${triggerNames(dir)}) showed up within ${RESUME} candles.` };
      }
    }
    return null;
  },
};
