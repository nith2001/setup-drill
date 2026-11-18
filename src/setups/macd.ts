import { extreme } from '../core/day';
import { indicators } from '../core/indicators';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { at, bars, from, ruleHtml, triggerCandle, triggerNames } from './util';

const QUIET = 8; // no prior cross for this many candles
const CONFIRM = 3; // candles from the cross for the trigger candle

// MACD (12,26,9) signal-line cross, taken only on the trend side of the zero line
export const macd: SetupDef = {
  id: 'macd',
  group: 'Indicators',
  label: 'MACD Cross',
  preset: { macd: true },
  blurb: 'Signal-line crosses. Only the ones on the right side of zero count.',
  rule: (o) => ruleHtml(o, [
    ['Signal', ['MACD (12, 26, 9) crosses its signal line', `No other cross in the last ${QUIET} candles`]],
    ['Entry', ['Long only if MACD is <b>above zero</b> (short only below zero)']],
    ['Trigger', [`Within ${CONFIRM} candles of the cross: a <b>bullish engulfing</b> candle or a <b>hammer</b>`, 'Enter at that candle\'s close']],
    ['Risk', ["Stop: beyond the trigger candle (no wider than the last 5 candles' extreme)", 'Target: 2R']],
    ['Skip it if', ['The cross is on the wrong side of zero (counter-trend)', 'No reversal candle follows']],
  ]),
  evaluate(day, o) {
    const { macd: m, sig } = indicators(day), n = day.c.length;
    const side = (i: number) => Math.sign(m[i] - sig[i]);
    const first = day.warm?.length ? QUIET + 2 : 50;
    for (let i = from(o, first); i < Math.min(n - GRACE - 5, bars(day, 360)); i++) {
      if (!side(i) || side(i) === side(i - 1)) continue;
      let quiet = true;
      for (let k = i - QUIET; k < i; k++) if (side(k) !== side(k - 1)) { quiet = false; break; }
      if (!quiet) continue;
      const dir = side(i) as Side;
      const base = { startIdx: Math.max(1, i - 8), windowEnd: i + CONFIRM + GRACE, levels: {}, marks: [{ idx: i, text: 'cross', above: dir < 0 }] };
      if (dir * m[i] > 0) {
        const signal = `On the ${at(day, i)} candle MACD crossed ${dir > 0 ? 'above' : 'below'} its signal line while ${dir > 0 ? 'above' : 'below'} zero, with the trend`;
        for (let k = i; k <= i + CONFIRM; k++) {
          const pat = triggerCandle(day, k, dir);
          if (pat) return { ...base, valid: true, dir, trigIdx: k, refStop: extreme(day, dir, Math.max(0, i - 4), k),
            why: `${signal}, and the ${at(day, k)} candle was a ${pat}: the trigger.` };
        }
        return { ...base, valid: false, why: `${signal}, but no reversal candle (${triggerNames(dir)}) followed within ${CONFIRM} candles. A signal without a trigger isn't a trade.` };
      }
      return { ...base, valid: false,
        why: `On the ${at(day, i)} candle MACD crossed ${dir > 0 ? 'up' : 'down'}, but ${dir > 0 ? 'below' : 'above'} the zero line. That's a counter-trend cross, so no trade.` };
    }
    return null;
  },
};
