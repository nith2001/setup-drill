import { rvolTod } from '../core/day';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { at, bars, fmt, ruleHtml, triggerCandle } from './util';

const WINDOW_MIN = 90; // minutes after the range closes in which a breakout counts
const MIN_RANGE_PCT = 0.001; // ranges narrower than 0.1% are skipped
const BODY = 0.6; // a strong breakout candle's body is at least 60% of its range...
const CLOSE_POS = 0.75; // ...and it closes in the top quarter (bottom quarter for shorts)
/** Time-of-day volume needed on the breakout candle (mutable so audits can try other values). */
// At least normal volume for that time of day. Audited on real data (2026-11-16): 1.0× beat 1.2× and the
// textbook 1.5× (SPY/QQQ +0.41R over 53 trades vs +0.13R over 21); stricter volume only removed good breakouts.
export const ORB_BREAK = { volMin: 1.0 };

/** The breakout candle is the trigger: a strong candle (big body, closes near the extreme) or an engulfing candle. */
function strongCandle(day: { o: number[]; h: number[]; l: number[]; c: number[] }, k: number, dir: Side): string | null {
  const o = day.o[k], c = day.c[k], h = day.h[k], l = day.l[k], range = h - l;
  if (!(range > 0) || dir * (c - o) <= 0) return null;
  if (Math.abs(c - o) >= BODY * range && (dir > 0 ? (c - l) : (h - c)) / range >= CLOSE_POS) return `strong ${dir > 0 ? 'bullish' : 'bearish'} candle`;
  const pat = triggerCandle(day as never, k, dir);
  return pat && pat.includes('engulfing') ? pat : null;
}

// Regular ORB on the owner's model: bias → opening range → the first close outside it, in the bias direction,
// on a strong candle with time-of-day volume ≥ RV_MIN. That candle is the trigger. Mirror for shorts.
export const orbBreak: SetupDef = {
  id: 'orbBreak',
  openOnly: true,
  group: 'Price action',
  label: 'ORB Breakout',
  preset: { or: true },
  blurb: 'With your bias, buy the first strong close outside the opening range on real volume. Skip weak breakouts.',
  rule: (o) => ruleHtml(o, [
    ['1. Range', [`Mark the high and low of the first ${o.orMin} min`, 'Inside the range: do nothing']],
    ['2. Trigger', [`The <b>first candle that closes above</b> the range, within ${WINDOW_MIN} min`, `It's a <b>strong candle</b>: body at least ${BODY * 100}% of its range, closing in the top quarter (or a bullish engulfing)`, `Volume ≥ ${ORB_BREAK.volMin}× <b>normal for that time of day</b>`, 'Enter at its close']],
    ['Risk', ['Stop: below the breakout candle', 'Target: 2R', 'A close back inside the range = failed breakout: get out']],
    ['Skip it if', ['The first breakout candle is weak (small body or a long wick back toward the range)', 'Volume is below normal for that time', 'It breaks against your bias']],
  ], 'mirror it below the range low'),
  evaluate(day, o) {
    if (o.from) return null; // once a day
    const n = day.c.length, nb = bars(day, o.orMin), deadline = nb + bars(day, WINDOW_MIN);
    if (n < deadline + GRACE + 5) return null;
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < nb; i++) { hi = Math.max(hi, day.h[i]); lo = Math.min(lo, day.l[i]); }
    if (!(hi - lo > 0) || (hi - lo) / day.c[0] < MIN_RANGE_PCT) return null;
    // No range lines here: the drill's OR indicator already draws them.
    const base = { startIdx: nb, windowEnd: deadline + GRACE, levels: { hi, lo } };
    for (let i = nb; i <= deadline; i++) {
      const dir: Side | 0 = day.c[i] > hi ? 1 : day.c[i] < lo ? -1 : 0;
      if (!dir) continue;
      const marks = [{ idx: nb - 1, text: 'range set', above: true }, { idx: i, text: 'breakout', above: dir < 0 }];
      const edge = `the opening range ${dir > 0 ? 'high' : 'low'} (${fmt(dir > 0 ? hi : lo)})`, rv = rvolTod(day, i);
      const pat = strongCandle(day, i, dir);
      if (!pat) return { ...base, valid: false, marks,
        why: `The ${at(day, i)} candle closed ${dir > 0 ? 'above' : 'below'} ${edge}, but it was a weak candle (small body or a long wick back toward the range). Weak breakouts are the ones that fall back in, so it's a pass.` };
      if (rv < ORB_BREAK.volMin) return { ...base, valid: false, marks,
        why: `The ${at(day, i)} candle closed ${dir > 0 ? 'above' : 'below'} ${edge} as a ${pat}, but on only ${rv.toFixed(1)}× normal volume for that time of day. No real participation, so it's a pass.` };
      return { ...base, valid: true, dir, trigIdx: i, refStop: dir > 0 ? day.l[i] : day.h[i], marks,
        why: `The ${at(day, i)} candle closed ${dir > 0 ? 'above' : 'below'} ${edge} as a ${pat} on ${rv.toFixed(1)}× normal volume for that time of day: the trigger.` };
    }
    return { ...base, valid: false, marks: [{ idx: nb - 1, text: 'range set', above: true }], why: `Price never closed outside the opening range within ${WINDOW_MIN} minutes.` };
  },
};
