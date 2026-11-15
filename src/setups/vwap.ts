import { extreme, hhmm, relVol, vwapAt } from '../core/day';
import type { Side } from '../core/types';
import { GRACE, RV_MIN, type SetupDef } from './types';

const STRETCH = 0.002; // ≥0.2% from VWAP
const MIN_RUN = 12; // bars stretched
const RECLAIM_WINDOW = 30;

export const vwap: SetupDef = {
  id: 'vwap',
  group: 'Price action',
  label: 'VWAP Reclaim',
  blurb: 'Price stretched from VWAP. Does it reclaim with conviction?',
  rule: () => `After ${MIN_RUN}+ min stretched ≥${STRETCH * 100}% from VWAP, a 1-min candle <b>closes back across VWAP</b> on <b>≥${RV_MIN}× volume</b> within ${RECLAIM_WINDOW} min. Enter within 3 bars. Stop: beyond the trigger candle, no wider than the 10-bar extreme.`,
  evaluate(day) {
    const n = day.c.length;
    if (n < 300) return null;
    let run = 0, side = 0;
    for (let i = 15; i < 240; i++) {
      const vw = vwapAt(day, i), dev = (day.c[i] - vw) / vw;
      const s = dev < -STRETCH ? -1 : dev > STRETCH ? 1 : 0;
      if (s && s === side) { run++; continue; }
      if (s) { side = s; run = 1; continue; }
      if (run >= MIN_RUN) {
        // Stretch just ended at i. First close back across VWAP within the window decides it.
        const dir = -side as Side, deadline = i + RECLAIM_WINDOW;
        const base = { startIdx: Math.max(15, i - 8), windowEnd: deadline + GRACE, levels: {} };
        for (let k = i; k <= deadline && k < n - 10; k++) {
          const crossed = dir > 0 ? day.c[k] > vwapAt(day, k) : day.c[k] < vwapAt(day, k);
          if (!crossed) continue;
          const rv = relVol(day, k);
          if (rv >= RV_MIN) return { ...base, valid: true, dir, trigIdx: k, refStop: extreme(day, dir, k - 10, k),
            why: `${hhmm(k)} candle closed back ${dir > 0 ? 'above' : 'below'} VWAP on ${rv.toFixed(1)}× volume.` };
          return { ...base, valid: false, why: `${hhmm(k)} crossed VWAP, but on only ${rv.toFixed(1)}× volume.` };
        }
        return { ...base, valid: false, why: `Price never closed back across VWAP within ${RECLAIM_WINDOW} minutes.` };
      }
      run = 0; side = 0;
    }
    return null;
  },
};
