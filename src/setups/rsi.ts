import { extreme } from '../core/day';
import { indicators } from '../core/indicators';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { at, bars, from, ruleHtml, triggerCandle, triggerNames } from './util';

const OVERSOLD = 35, OVERBOUGHT = 65; // 30/70 is rare on 5-min index charts
const SLOPE_BARS = 10;
const CONFIRM = 3; // candles from the reclaim for the trigger candle

// RSI(14) reclaim of 30 / 70, taken only when the 50 SMA slopes in the trade's direction
export const rsi: SetupDef = {
  id: 'rsi',
  group: 'Indicators',
  label: 'RSI Reclaim + 50 SMA',
  preset: { mas: [{ type: 'sma', period: 50 }], rsi: true },
  blurb: 'Oversold bounce in an uptrend? Or a falling knife?',
  rule: (o) => ruleHtml(o, [
    ['Signal', [`RSI (14) drops below ${OVERSOLD}`, `Then closes back above ${OVERSOLD}`]],
    ['Entry', [`Only if the <b>50 SMA is rising</b> (last ${SLOPE_BARS} candles)`]],
    ['Trigger', [`Within ${CONFIRM} candles of the reclaim: a <b>bullish engulfing</b> candle or a <b>hammer</b>`, 'Enter at that candle\'s close']],
    ['Risk', ['Stop: beyond the trigger candle (no wider than the oversold low)', 'Target: 2R']],
    ['Skip it if', ['The 50 SMA is falling (fighting the trend)', 'No reversal candle follows']],
  ], `above ${OVERBOUGHT}, back below, with the 50 SMA falling`),
  evaluate(day, o) {
    const { rsi: r, sma50 } = indicators(day), n = day.c.length;
    const first = day.warm?.length ? SLOPE_BARS + 2 : 65, floor = first - SLOPE_BARS;
    for (let i = from(o, first); i < Math.min(n - GRACE - 5, bars(day, 360)); i++) {
      let dir: Side | 0 = 0;
      if (r[i - 1] < OVERSOLD && r[i] >= OVERSOLD) dir = 1;
      else if (r[i - 1] > OVERBOUGHT && r[i] <= OVERBOUGHT) dir = -1;
      if (!dir) continue;
      let j = i - 1;
      while (j > floor && (dir > 0 ? r[j] < OVERSOLD : r[j] > OVERBOUGHT)) j--;
      const base = { startIdx: Math.max(1, Math.min(j - 4, i - 4)), windowEnd: i + CONFIRM + GRACE, levels: {},
        marks: [{ idx: j + 1, text: dir > 0 ? 'oversold' : 'overbought', above: dir < 0 }] };
      const slope = sma50[i] - sma50[i - SLOPE_BARS];
      if (!isFinite(slope)) continue;
      if (dir * slope > 0) {
        const signal = `RSI was ${dir > 0 ? 'oversold' : 'overbought'} while the 50 SMA was ${dir > 0 ? 'rising' : 'falling'}, then the ${at(day, i)} candle closed RSI back ${dir > 0 ? `above ${OVERSOLD}` : `below ${OVERBOUGHT}`}`;
        for (let k = i; k <= i + CONFIRM; k++) {
          const pat = triggerCandle(day, k, dir);
          if (pat) return { ...base, valid: true, dir, trigIdx: k, refStop: extreme(day, dir, j + 1, k),
            why: `${signal}, and the ${at(day, k)} candle was a ${pat}: the trigger.` };
        }
        return { ...base, valid: false, why: `${signal}, but no reversal candle (${triggerNames(dir)}) followed within ${CONFIRM} candles. A signal without a trigger isn't a trade.` };
      }
      return { ...base, valid: false,
        why: `RSI reclaimed ${dir > 0 ? OVERSOLD : OVERBOUGHT} at ${at(day, i)}, but the 50 SMA was ${dir > 0 ? 'falling' : 'rising'}. That's fighting the trend, so no trade.` };
    }
    return null;
  },
};
