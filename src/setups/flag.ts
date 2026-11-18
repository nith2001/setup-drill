import { biasAllows } from '../core/bias';
import { extreme, relVol, rvolTod } from '../core/day';
import type { Day, Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { at, avgRange, bars, ext, fmt, from, ruleHtml, triggerCandle } from './util';

/** Tunable thresholds (the audit sweeps these). */
export const FLAG = {
  /** vol: the breakout candle needs volume. candle: it must be a trigger candle (engulfing, hammer, or strong close) instead. */
  TRIG: 'candle' as 'vol' | 'candle' | 'both',
  /** measured: the pole's length past the break. 2R: twice the risk. */
  TARGET: 'measured' as 'measured' | '2R',
  TOD: true, // breakout volume vs normal for that time of day (else vs the prior 10 candles)
  SCAN: true, // only look in the bias direction
  POLE_ATR: 3.5, // pole at least 3.5 average candles...
  FLAG_MIN: 3, // candles of pause, at least
  FLAG_MAX_MIN: 60, // and at most this long
  MAX_RETRACE: 0.618, // the flag may not give back more than 61.8% of the pole
  BRK_RV: 1.0, // breakout volume needed when TRIG includes volume
  POLE_MAX_MIN: 30, // time for the pole
};

const POLE_PCT = 0.0025; // ...and at least 0.25%

/** Engulfing, hammer, or a strong candle (body ≥ half the range, closing in its top third) in `dir`. */
function strongOrTrigger(day: Day, k: number, dir: Side) {
  if (triggerCandle(day, k, dir)) return true;
  const r = day.h[k] - day.l[k];
  return r > 0 && dir * (day.c[k] - day.o[k]) >= 0.5 * r && (dir > 0 ? day.c[k] - day.l[k] : day.h[k] - day.c[k]) >= (2 / 3) * r;
}

// Sharp move (pole), tight pause against it (flag), then a break out of the flag with volume.
export const flag: SetupDef = {
  id: 'flag',
  group: 'Price action',
  label: 'Flag Breakout',
  preset: {},
  blurb: 'A sharp move, a quiet pause, then continuation. Or a pullback that runs too deep.',
  rule: (o) => ruleHtml(o, [
    ['Pattern', [`<b>Pole</b>: a fast move of at least ${FLAG.POLE_ATR} average candles in ≤${FLAG.POLE_MAX_MIN} min`, `<b>Flag</b>: ${FLAG.FLAG_MIN}+ candles (≤${FLAG.FLAG_MAX_MIN} min) drifting back or sideways`, `The flag gives back <b>no more than ${FLAG.MAX_RETRACE * 100}%</b> of the pole`]],
    ['Trigger', ["A <b>trigger candle closes above the pole's high</b>: a bullish engulfing candle, a hammer, or a strong bullish candle (body at least half its range, closing in its top third)", 'Enter at its close']],
    ['Risk', ["Stop: below the flag's low (no tighter than the trigger candle)", "Target: a measured move (the pole's length added to the breakout)"]],
    ['Skip it if', [`The flag closes past ${FLAG.MAX_RETRACE * 100}%`, `It drags on past ${FLAG.FLAG_MAX_MIN} min`, 'The breakout candle is weak (small body, long top wick)']],
  ], 'mirror it (bear flag)'),
  evaluate(day, o) {
    const n = day.c.length, PM = bars(day, FLAG.POLE_MAX_MIN), FM = Math.max(FLAG.FLAG_MIN + 1, bars(day, FLAG.FLAG_MAX_MIN));
    if (n < bars(day, 200)) return null;
    for (let p = from(o, PM + 2); p < bars(day, 320); p++) {
      for (const dir of [1, -1] as Side[]) {
        if (FLAG.SCAN && !biasAllows(o.bias, dir)) continue;
        const top = ext(day, p, dir);
        // p is the pole's extreme: nothing beyond it in the prior PM candles or the next 2.
        let ok = true;
        for (let j = p - PM; j <= p + 2 && ok; j++) if (j !== p && dir * (ext(day, j, dir) - top) >= (j < p ? 0.0001 : 0)) ok = false;
        if (!ok) continue;
        let bIdx = p, base = top;
        for (let j = p - PM; j < p; j++) if (dir * (ext(day, j, (-dir) as Side) - base) < 0) { base = ext(day, j, (-dir) as Side); bIdx = j; }
        const pole = dir * (top - base);
        if (p - bIdx < 2 || pole < Math.max(FLAG.POLE_ATR * avgRange(day, bIdx), base * POLE_PCT)) continue;

        const deadline = p + FM + 1, mid = base + dir * pole * FLAG.MAX_RETRACE;
        if (deadline + GRACE + 2 >= n) return null;
        const marks = [{ idx: bIdx, text: 'pole starts', above: dir < 0 }, { idx: p, text: 'pole ends', above: dir > 0 }];
        const b0 = { startIdx: p + 3, windowEnd: deadline + GRACE, levels: {}, marks,
          lines: [{ price: top, text: `pole ${dir > 0 ? 'high' : 'low'} (break level)`, idx: p }, { price: mid, text: `${FLAG.MAX_RETRACE * 100}% retrace`, idx: p }] };
        let noPause = false;
        for (let k = p + 3; k <= deadline; k++) {
          if (dir * (day.c[k] - mid) < 0) return { ...b0, valid: false,
            why: `The ${at(day, k)} candle closed past the ${FLAG.MAX_RETRACE * 100}% retracement (${fmt(mid)}). The pullback gave back too much of the move, so it's not a flag. Momentum is gone.` };
          if (dir * (day.c[k] - top) <= 0) continue;
          if (k - p - 1 < FLAG.FLAG_MIN) { noPause = true; break; } // no pause: not a flag, look for another
          const rv = FLAG.TOD ? rvolTod(day, k) : relVol(day, k);
          if (FLAG.TRIG !== 'vol' && !strongOrTrigger(day, k, dir)) return { ...b0, valid: false,
            why: `The ${at(day, k)} candle broke out of the flag, but it was a weak candle (small body or long wick against the move). Weak breakouts often fail.` };
          if (FLAG.TRIG !== 'candle' && rv < FLAG.BRK_RV) return { ...b0, valid: false,
            why: `The ${at(day, k)} candle broke out of the flag, but on only ${rv.toFixed(1)}× volume. Weak breakouts often fail.` };
          return { ...b0, valid: true, dir, trigIdx: k, refStop: extreme(day, dir, p + 1, k),
            ...(FLAG.TARGET === '2R' ? {} : { target: { price: top + dir * pole, why: `a measured move: the pole's length (${fmt(pole)}) added to the breakout level` } }),
            why: `A ${(pole / base * 100).toFixed(1)}% pole from ${at(day, bIdx)} to ${at(day, p)}, a ${k - p - 1}-candle flag, then the ${at(day, k)} candle broke ${dir > 0 ? 'above' : 'below'} the pole on ${rv.toFixed(1)}× volume.` };
        }
        if (noPause) continue;
        return { ...b0, valid: false, why: `The flag dragged on for more than ${FLAG.FLAG_MAX_MIN} minutes without breaking out. The move lost steam.` };
      }
    }
    return null;
  },
};
