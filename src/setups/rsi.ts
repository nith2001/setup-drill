import { extreme, hhmm } from '../core/day';
import { indicators } from '../core/indicators';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';

const OVERSOLD = 30, OVERBOUGHT = 70;

// RSI(14) reclaim of 30 / 70, taken only when the 50 SMA slopes in the trade's direction
export const rsi: SetupDef = {
  id: 'rsi',
  group: 'Indicators',
  label: 'RSI Reclaim + 50 SMA',
  blurb: 'Oversold bounce in an uptrend? Or a falling knife?',
  rule: () => `RSI (14) goes below ${OVERSOLD}, then closes back above ${OVERSOLD}. Valid only if the <b>50 SMA is rising</b>. Mirror for shorts: back below ${OVERBOUGHT} with the 50 SMA falling. Enter within 3 bars. Stop: beyond the trigger candle, no wider than the low (or high) of the oversold stretch.`,
  preset: { mas: [{ type: 'sma', period: 50 }], rsi: true, vwap: false },
  evaluate(day) {
    const { rsi: r, sma50 } = indicators(day), n = day.c.length;
    for (let i = 65; i < Math.min(n - 20, 300); i++) {
      let dir: Side | 0 = 0;
      if (r[i - 1] < OVERSOLD && r[i] >= OVERSOLD) dir = 1;
      else if (r[i - 1] > OVERBOUGHT && r[i] <= OVERBOUGHT) dir = -1;
      if (!dir) continue;
      let j = i - 1;
      while (j > 55 && (dir > 0 ? r[j] < OVERSOLD : r[j] > OVERBOUGHT)) j--;
      const base = { startIdx: Math.max(55, Math.min(j - 8, i - 6)), windowEnd: i + 3 + GRACE, levels: {} };
      const slope = sma50[i] - sma50[i - 10];
      if (dir * slope > 0) return { ...base, valid: true, dir, trigIdx: i, refStop: extreme(day, dir, j + 1, i),
        why: `RSI was ${dir > 0 ? 'oversold' : 'overbought'} during a ${dir > 0 ? 'rising' : 'falling'} 50 SMA, then ${hhmm(i)} closed back ${dir > 0 ? `above ${OVERSOLD}` : `below ${OVERBOUGHT}`}.` };
      return { ...base, valid: false,
        why: `RSI reclaimed ${dir > 0 ? OVERSOLD : OVERBOUGHT} at ${hhmm(i)}, but the 50 SMA was ${dir > 0 ? 'falling' : 'rising'}. That's fighting the trend, so no trade.` };
    }
    return null;
  },
};
