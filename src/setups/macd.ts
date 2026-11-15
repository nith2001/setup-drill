import { extreme, hhmm } from '../core/day';
import { indicators } from '../core/indicators';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';

const QUIET_BARS = 15; // no prior cross for this long

// MACD (12,26,9) signal-line cross, taken only on the trend side of the zero line
export const macd: SetupDef = {
  id: 'macd',
  group: 'Indicators',
  label: 'MACD Cross',
  blurb: 'Signal-line crosses. Only the ones on the right side of zero count.',
  rule: () => `MACD (12, 26, 9) crosses its signal line. Valid only if MACD is on the <b>trend side of zero</b>: above zero for longs, below zero for shorts. Enter within 3 bars. Stop: beyond the trigger candle, no wider than the 5-bar extreme.`,
  preset: { macd: true, vwap: false },
  evaluate(day) {
    const { macd: m, sig } = indicators(day), n = day.c.length;
    const side = (i: number) => Math.sign(m[i] - sig[i]);
    for (let i = 50; i < Math.min(n - 20, 240); i++) {
      if (!side(i) || side(i) === side(i - 1)) continue;
      let quiet = true;
      for (let k = i - QUIET_BARS; k < i; k++) if (side(k) !== side(k - 1)) { quiet = false; break; }
      if (!quiet) continue;
      const dir = side(i) as Side;
      const base = { startIdx: i - 15, windowEnd: i + 3 + GRACE, levels: {} };
      if (dir * m[i] > 0) return { ...base, valid: true, dir, trigIdx: i, refStop: extreme(day, dir, i - 4, i),
        why: `${hhmm(i)} MACD crossed ${dir > 0 ? 'above' : 'below'} its signal line while ${dir > 0 ? 'above' : 'below'} zero, with the trend.` };
      return { ...base, valid: false,
        why: `${hhmm(i)} MACD crossed ${dir > 0 ? 'up' : 'down'}, but ${dir > 0 ? 'below' : 'above'} the zero line. That's a counter-trend cross, so no trade.` };
    }
    return null;
  },
};
