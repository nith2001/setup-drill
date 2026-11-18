import { biasAllows } from '../core/bias';
import { extreme, vwapAt } from '../core/day';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { rrOf } from '../core/ideal';
import { at, avgRange, bars, fmt, from, MIN_RR, ruleHtml, triggerCandle, triggerNames } from './util';

/** Tunable thresholds (the audit sweeps these). */
export const RF = {
  SCAN: false, // ignore edges the bias doesn't allow (keep watching the other edge)
  POS: 0.3, // the range is spotted while price is in its middle (this far from either edge)
  W_MIN: 60, // the range must hold this long
  MIN_H: 2.5, // range height in average candles, at least
  MAX_H: 6, // and at most
  ZONE: 0.2, // top/bottom 20% of the range counts as touching the edge
  EDGE_MIN: 90, // time after the range is set for the edge test
  CONFIRM: 3, // candles for the turn
};


/** Separate visits to a zone (entries into it). */
function visits(inZone: (j: number) => boolean, from: number, to: number) {
  let n = 0;
  for (let j = from; j <= to; j++) if (inZone(j) && !(j > from && inZone(j - 1))) n++;
  return n;
}

// A sideways range with VWAP inside: sell the top, buy the bottom, unless it breaks.
export const rangeFade: SetupDef = {
  id: 'rangeFade',
  group: 'Support & resistance',
  label: 'Range Fade',
  style: 'range',
  preset: { vwap: true },
  blurb: 'Price is stuck in a box. Fade the edge when it turns, pass when it breaks out.',
  rule: (o) => ruleHtml(o, [
    ['Range', [`${RF.W_MIN}+ min inside a box ${RF.MIN_H}–${RF.MAX_H} average candles tall`, 'Touches the top and the bottom <b>at least twice each</b>', '<b>VWAP inside</b> the box (no trend)', 'Draw it!']],
    ['Trigger', ['Price reaches an edge', `Within ${RF.CONFIRM} candles: a reversal candle back into the range (at the bottom: <b>bullish engulfing</b> or <b>hammer</b>; at the top: bearish engulfing or shooting star)`, 'Enter at that candle\'s close']],
    ['Risk', ["Stop: beyond the edge's extreme", 'Target: just inside the other side of the range']],
    ['Skip it if', ['A candle closes outside the box (breakout)', 'No reversal candle shows up', `The other side is less than ${MIN_RR}R away`]],
  ]),
  evaluate(day, o) {
    const n = day.c.length, W = bars(day, RF.W_MIN);
    if (n < bars(day, 200)) return null;
    for (let i = from(o, W + bars(day, 10)); i < bars(day, 330); i++) {
      const hi = Math.max(...day.h.slice(i - W + 1, i + 1)), lo = Math.min(...day.l.slice(i - W + 1, i + 1));
      const H = hi - lo, A = avgRange(day, i, W), px = day.c[i];
      if (H < RF.MIN_H * A || H > RF.MAX_H * A || H / px < 0.0015) continue;
      const pos = (day.c[i] - lo) / H;
      if (pos < RF.POS || pos > 1 - RF.POS) continue; // start mid-range, not at an edge
      const vw = vwapAt(day, i);
      if (vw < lo || vw > hi) continue;
      if (visits((j) => day.h[j] >= hi - RF.ZONE * H, i - W + 1, i) < 2 || visits((j) => day.l[j] <= lo + RF.ZONE * H, i - W + 1, i) < 2) continue;

      const deadline = i + bars(day, RF.EDGE_MIN), tol = H * 0.05;
      if (deadline + RF.CONFIRM + GRACE + 1 >= n) return null;
      const r0 = { idx: i - W + 1, text: 'range starts', above: false };
      const base = { startIdx: i + 1, windowEnd: deadline + RF.CONFIRM + GRACE, levels: { hi, lo }, marks: [r0],
        lines: [{ price: hi, text: 'range high', idx: i }, { price: lo, text: 'range low', idx: i }, { price: (hi + lo) / 2, text: 'mid', idx: i }] };
      const boxNote = `Range ${fmt(lo)}–${fmt(hi)} from ${at(day, i - W + 1)}.`;
      for (let t = i + 1; t <= deadline; t++) {
        const out: Side | 0 = day.c[t] > hi + tol ? 1 : day.c[t] < lo - tol ? -1 : 0;
        if (out) return { ...base, valid: false, marks: [r0, { idx: t, text: 'breakout', above: out > 0 }],
          why: `${boxNote} The ${at(day, t)} candle closed ${out > 0 ? 'above' : 'below'} it. A breakout, not a fade.` };
        const dir: Side | 0 = day.h[t] >= hi - 0.1 * H ? -1 : day.l[t] <= lo + 0.1 * H ? 1 : 0;
        if (!dir || (RF.SCAN && !biasAllows(o.bias, dir, 'strict', 'range'))) continue;
        const edge = dir > 0 ? 'bottom' : 'top';
        for (let k = t; k <= t + RF.CONFIRM; k++) {
          if (dir * (day.c[k] - (dir > 0 ? lo : hi)) < -tol) return { ...base, valid: false, marks: [r0, { idx: t, text: 'edge', above: dir < 0 }],
            why: `${boxNote} Price reached the ${edge} at ${at(day, t)}, then the ${at(day, k)} candle closed outside the range. It broke instead of turning.` };
          const pat = triggerCandle(day, k, dir);
          if (!pat) continue;
          const stop = extreme(day, dir, t, k), tgt = dir > 0 ? hi - 0.1 * H : lo + 0.1 * H, rr = rrOf(dir, day.c[k], stop, tgt);
          const em = [r0, { idx: t, text: 'edge', above: dir < 0 }];
          if (rr < MIN_RR) return { ...base, valid: false, marks: em,
            why: `${boxNote} Price turned at the ${edge} at ${at(day, k)}, but the other side of the range was only ${Math.max(0, rr).toFixed(1)}R away. Not enough room.` };
          return {
            ...base, valid: true, dir, trigIdx: k, refStop: stop, marks: em,
            target: { price: tgt, why: `just inside the other side of the range (${fmt(tgt)}), where price turned before` },
            why: `${boxNote} Price tested the ${edge} at ${at(day, t)} and the ${at(day, k)} candle was a ${pat}: the trigger.` };
        }
        return { ...base, valid: false, marks: [r0, { idx: t, text: 'edge', above: dir < 0 }],
          why: `${boxNote} Price sat at the ${edge} from ${at(day, t)} but no reversal candle (${triggerNames(dir)}) showed up within ${RF.CONFIRM} candles.` };
      }
      return { ...base, valid: false, why: `${boxNote} Price stayed in the middle and never reached an edge within ${RF.EDGE_MIN} minutes. Nothing to fade.` };
    }
    return null;
  },
};
