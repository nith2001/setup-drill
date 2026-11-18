import { biasAllows, type BiasMode } from '../core/bias';
import { rvolTod, vwapAt } from '../core/day';
import { emaArr } from '../core/indicators';
import type { Day, Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { at, avgRange, bars, ext, fmt, from, isSwing, ruleHtml, triggerCandle } from './util';

const LEG_MAX_MIN = 120; // max time from 1 to 2
const LEG_PCT = 0.0015; // leg 1→2 at least 0.15%
const WINDOW_MIN = 120; // time after 2 is confirmed for the break
const MIN_LEG_CANDLES = 3; // 1→2 takes at least this many candles

/** Tunable parts of the rule (the audit sweeps these). */
export const T123 = {
  legAtr: 2, // leg 1→2 at least this many average candles
  minPullback: 0.25, // point 3 retraces at least this much of 1→2
  minPb: 2, // point 3 is at least this many candles after 2
  /** engulf: engulfing candle beyond 2. candle: engulfing, hammer or a strong candle beyond 2. close: any close beyond 2. */
  trigger: 'candle' as 'engulf' | 'candle' | 'close',
  wait: 3, // after the first close beyond 2, the trigger must come within this many candles
  bias: 'strict' as BiasMode,
  /** Only look for patterns in the bias direction (so a counter-bias pattern doesn't hide a later good one). */
  scanBias: false,
  /** Optional confluences (20 EMA side, VWAP side, volume on the break): at least this many. */
  confMin: 0,
  /** break: enter when price breaks 2. pullback: enter at point 3 on a reversal candle (stop below 3). */
  entry: 'break' as 'break' | 'pullback',
  /** Target: fixed 2R, or the measured move (2 plus the 1→2 leg). */
  target: '2R' as '2R' | 'measured',
};

/** A candle that closes strongly in `dir`: body at least half its range, close in the top third. */
function strong(day: Day, k: number, dir: Side) {
  const r = day.h[k] - day.l[k], body = dir * (day.c[k] - day.o[k]);
  return r > 0 && body >= 0.5 * r && (dir > 0 ? day.c[k] - day.l[k] : day.h[k] - day.c[k]) >= (2 / 3) * r;
}
function trig(day: Day, k: number, dir: Side): string | null {
  if (T123.trigger === 'close') return 'close';
  if (T123.trigger === 'engulf') return engulfing(day, k, dir) ? `${dir > 0 ? 'bullish' : 'bearish'} engulfing candle` : null;
  return triggerCandle(day, k, dir) ?? (strong(day, k, dir) ? `strong ${dir > 0 ? 'bullish' : 'bearish'} candle` : null);
}
/** Which optional confluences line up at candle k. */
function confluences(day: Day, k: number, dir: Side, e20: number[]): string[] {
  const out: string[] = [];
  if (Number.isFinite(e20[k]) && dir * (day.c[k] - e20[k]) > 0) out.push('20 EMA');
  if (dir * (day.c[k] - vwapAt(day, k)) > 0) out.push('VWAP');
  if (rvolTod(day, k) >= 1) out.push('volume');
  return out;
}

/** Bullish (dir 1) / bearish (dir -1) engulfing: the candle closes in `dir` and its body covers the previous body. */
function engulfing(day: { o: number[]; c: number[] }, k: number, dir: Side) { // same as util triggerCandle's engulfing case
  const o = day.o[k], c = day.c[k], po = day.o[k - 1], pc = day.c[k - 1], tol = Math.max(0.01, c * 0.0001);
  return dir * (c - o) > 0 && dir * (pc - po) <= 0 && dir * (o - pc) <= tol && dir * (c - po) > 0;
}

const trigWord = (dir: Side) => T123.trigger === 'engulf' ? `${dir > 0 ? 'bullish' : 'bearish'} engulfing candle` : `${dir > 0 ? 'bullish' : 'bearish'} trigger candle`;

// Owner's model: bias first (4-hour trend over the past month and week), then the pattern
// (swing low 1 → swing high 2 → higher low 3), then the trigger (an engulfing candle closing above 2).
// Mirror for shorts.
export const trend123: SetupDef = {
  id: 'trend123',
  group: 'Price action',
  label: '1-2-3 Pattern',
  preset: {},
  get biasMode() { return T123.bias; },
  blurb: 'Trade with your 4h bias: swing low, swing high, higher low, then a strong candle breaking 2.',
  rule: (o) => ruleHtml(o, [
    ['Pattern', ['<b>1</b>: a swing low', `<b>2</b>: the next swing high, at least ${T123.legAtr} average candles above 1 (and ${MIN_LEG_CANDLES}+ candles later)`, `<b>3</b>: a real pullback: a <b>swing low at least ${T123.minPb} candles after 2</b>, confirmed by the next 2 candles holding above it`, `It retraces at least ${T123.minPullback * 100}% of 1→2 and <b>stays above 1</b>`]],
    ['Trigger', [`<b>4</b>: within ${WINDOW_MIN} min a <b>trigger candle closes above 2</b>: a <b>bullish engulfing</b> candle, a <b>hammer</b>, or a <b>strong bullish candle</b> (body at least half its range, closing in its top third)`, `A weak break (small body, long top wick): wait up to ${T123.wait} candles for a trigger candle, then let it go`, 'Enter at the trigger candle\'s close']],
    ['Risk', ['Stop: below point 3', 'Target: 2R; trail the rest under higher lows']],
    ['Skip it if', ['Price closes below 1', 'Price breaks 2 before point 3 is confirmed (no real pullback)', 'The pullback is too shallow']],
  ], 'mirror it (lower high, break below 2)'),
  evaluate(day, o) {
    const n = day.c.length, K = (day.barMin ?? 1) >= 5 ? 2 : 3; // candles each side that confirm a swing
    if (n < bars(day, 200)) return null;
    const e20 = T123.confMin ? emaArr(day.c, 20) : [];
    for (let p1 = from(o, bars(day, 10)); p1 < bars(day, 300); p1++) {
      for (const dir of [1, -1] as Side[]) {
        if (T123.scanBias && !biasAllows(o.bias, dir, T123.bias)) continue;
        if (!isSwing(day, p1, K, (-dir) as Side)) continue;
        const x1 = ext(day, p1, (-dir) as Side);
        // Point 2: the first opposite swing after 1, with 1 holding in between.
        let p2 = -1;
        for (let j = p1 + 1; j <= p1 + bars(day, LEG_MAX_MIN) && j < n - K; j++) {
          if (dir * (ext(day, j, (-dir) as Side) - x1) < 0) break;
          if (isSwing(day, j, K, dir)) { p2 = j; break; }
        }
        if (p2 < 0 || p2 - p1 < MIN_LEG_CANDLES) continue;
        const x2 = ext(day, p2, dir), leg = dir * (x2 - x1);
        if (leg < Math.max(T123.legAtr * avgRange(day, p2), x1 * LEG_PCT)) continue;

        const shown = p2 + K, deadline = shown + bars(day, WINDOW_MIN);
        if (deadline + GRACE + 2 >= n) return null;
        const base = { startIdx: shown + 1, windowEnd: deadline + GRACE, levels: {}, lines: [{ price: x2, text: '2 (break level)', idx: p2 }, { price: x1, text: '1', idx: p1 }] };
        const marks = (i3: number, trig?: number) => [
          { idx: p1, text: '1', above: dir < 0 }, { idx: p2, text: '2', above: dir > 0 }, { idx: i3, text: '3', above: dir < 0 },
          ...(trig != null ? [{ idx: trig, text: '4', above: dir > 0 }] : []),
        ];
        let x3 = x2, i3 = p2, broke = -1;
        const tgt = () => T123.target === 'measured' ? { target: { price: x2 + dir * leg, why: `the measured move: 2 plus the 1→2 leg (${fmt(x2 + dir * leg)})` } } : {};
        for (let k = p2 + 1; k <= deadline; k++) {
          if (dir * (ext(day, k, (-dir) as Side) - x3) < 0) { x3 = ext(day, k, (-dir) as Side); i3 = k; }
          if (dir * (day.c[k] - x1) < 0) return { ...base, valid: false, marks: marks(i3),
            why: `The ${at(day, k)} candle closed ${dir > 0 ? 'below' : 'above'} point 1 (${fmt(x1)}), so there was no ${dir > 0 ? 'higher low' : 'lower high'}. The trend structure failed.` };
          if (T123.entry === 'pullback' && dir * (day.c[k] - x2) <= 0) {
            // Early entry at point 3: a deep enough pullback that holds, then a reversal candle.
            const depth3 = dir * (x2 - x3) / leg, pat = depth3 >= T123.minPullback && i3 - p2 >= T123.minPb ? triggerCandle(day, k, dir) : null;
            const conf = pat && T123.confMin ? confluences(day, k, dir, e20) : [];
            if (pat && conf.length >= T123.confMin) return { ...base, valid: true, dir, trigIdx: k, refStop: x3, marks: marks(i3, k), ...tgt(),
              why: `1 at ${at(day, p1)}, 2 at ${at(day, p2)}, then a ${Math.round(depth3 * 100)}% pullback to 3 at ${at(day, i3)} that held above 1, and a ${pat} at ${at(day, k)}: the trigger to buy point 3${conf.length ? ` (with ${conf.join(', ')})` : ''}.` };
            continue;
          }
          if (T123.entry === 'pullback') return { ...base, valid: false, marks: marks(i3),
            why: `Price went back ${dir > 0 ? 'above' : 'below'} 2 at ${at(day, k)} without a reversal candle at point 3 first. No trigger at 3, and chasing the break isn't this entry.` };
          if (dir * (day.c[k] - x2) <= 0) continue;
          // Point 3 must be a confirmed swing before the break: far enough after 2, with K candles holding above it.
          if (i3 - p2 < T123.minPb || i3 + K > k) return { ...base, valid: false, marks: marks(i3),
            why: `Price broke 2 at ${at(day, k)}, only ${k - p2} candles after it. There was no real pullback, so no confirmed point 3 to define the risk. Chasing that isn't the setup.` };
          const depth = dir * (x2 - x3) / leg;
          if (depth < T123.minPullback) return { ...base, valid: false, marks: marks(i3),
            why: `Price broke 2 after only a ${Math.round(depth * 100)}% pullback, so there was no real point 3 to define the risk. Chasing that isn't the setup.` };
          // Trigger: at most T123.wait candles after the first close beyond 2.
          if (broke < 0) broke = k;
          const pat = trig(day, k, dir);
          const conf = T123.confMin ? confluences(day, k, dir, e20) : [];
          if (!pat || conf.length < T123.confMin) {
            if (k - broke >= T123.wait) return { ...base, valid: false, marks: marks(i3),
              why: !pat ? `Price closed beyond 2 at ${at(day, broke)}, but no ${trigWord(dir)} followed within ${T123.wait} candles. No trigger, and chasing it later isn't the setup.`
                : `Price broke 2 at ${at(day, broke)}, but without enough confluence (needs ${T123.confMin} of 20 EMA, VWAP, volume). Too thin to take.` };
            continue;
          }
          const how = pat === 'close' ? `the ${at(day, k)} candle closed ${dir > 0 ? 'above' : 'below'} 2` : `a ${pat} at ${at(day, k)} closed ${dir > 0 ? 'above' : 'below'} 2`;
          return { ...base, valid: true, dir, trigIdx: k, refStop: x3, marks: marks(i3, k), ...tgt(),
            why: `1 at ${at(day, p1)}, 2 at ${at(day, p2)}, a ${Math.round(depth * 100)}% pullback to 3 at ${at(day, i3)} that held, then ${how}${conf.length ? ` (with ${conf.join(', ')})` : ''}.` };
        }
        return { ...base, valid: false, marks: marks(i3), why: `Price never closed beyond point 2 within ${WINDOW_MIN} minutes.` };
      }
    }
    return null;
  },
};
