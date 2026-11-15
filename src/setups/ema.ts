import { hhmm } from '../core/day';
import { indicators } from '../core/indicators';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';

const TREND_BARS = 15;
const RESUME_WITHIN = 6;

// Trend (9 over 20, 20 sloping) -> pullback touches the 20 EMA -> close back past the 9 EMA
export const ema: SetupDef = {
  id: 'ema',
  group: 'Indicators',
  label: '9/20 EMA Pullback',
  blurb: 'Trend pulls back to the 20 EMA. Buy the bounce, or pass when it breaks.',
  rule: () => `Trend: 9 EMA above the 20 EMA for ${TREND_BARS}+ bars, 20 EMA rising (mirror for shorts). Price pulls back and touches the 20 EMA. Valid if, within ${RESUME_WITHIN} bars and without <b>closing through the 20 EMA</b>, a candle closes back past the 9 EMA in the trend's direction. Stop: beyond the trigger candle, no wider than the pullback's extreme.`,
  preset: { mas: [{ type: 'ema', period: 9 }, { type: 'ema', period: 20 }], vwap: false },
  evaluate(day) {
    const { e9, e20 } = indicators(day), n = day.c.length;
    for (let i = 35; i < Math.min(n - 20, 240); i++) {
      for (const dir of [1, -1] as Side[]) {
        let trend = dir * (e20[i - 1] - e20[i - 11]) > 0;
        for (let k = i - TREND_BARS; trend && k < i; k++) if (!(dir * (e9[k] - e20[k]) > 0)) trend = false;
        const touch = dir > 0 ? day.l[i] <= e20[i] : day.h[i] >= e20[i];
        if (!trend || !touch) continue;
        const deadline = i + RESUME_WITHIN;
        const base = { startIdx: i - 12, windowEnd: deadline + GRACE, levels: {} };
        let ref = dir > 0 ? Infinity : -Infinity;
        for (let k = i; k <= deadline; k++) {
          ref = dir > 0 ? Math.min(ref, day.l[k]) : Math.max(ref, day.h[k]);
          if (dir * (day.c[k] - e20[k]) < 0) return { ...base, valid: false,
            why: `The pullback ${hhmm(k)} closed ${dir > 0 ? 'below' : 'above'} the 20 EMA, so the trend broke. No trade.` };
          if (dir * (day.c[k] - e9[k]) > 0 && dir * (day.c[k] - day.o[k]) > 0) return { ...base, valid: true, dir, trigIdx: k, refStop: ref,
            why: `${dir > 0 ? 'Uptrend' : 'Downtrend'} pulled back to the 20 EMA, held it, and ${hhmm(k)} closed back ${dir > 0 ? 'above' : 'below'} the 9 EMA.` };
        }
        return { ...base, valid: false, why: `Price touched the 20 EMA but never closed back past the 9 EMA within ${RESUME_WITHIN} bars.` };
      }
    }
    return null;
  },
};
