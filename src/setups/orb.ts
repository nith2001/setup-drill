import { hhmm, relVol } from '../core/day';
import type { Side } from '../core/types';
import { GRACE, RV_MIN, type SetupDef } from './types';

const WINDOW_MIN = 90; // minutes after the range closes in which a break counts
const MIN_RANGE_PCT = 0.0015; // ranges narrower than this are skipped

export const orb: SetupDef = {
  id: 'orb',
  group: 'Price action',
  label: 'Opening Range Breakout',
  blurb: 'Take it only if it qualifies. Some charts have no valid setup.',
  rule: (o) => `A 1-min candle <b>closes</b> outside the first ${o.orMin}-min range on <b>≥${RV_MIN}× volume</b> (vs prior 10 bars), within ${WINDOW_MIN} min. Enter within 3 bars, in the break's direction. Stop: beyond the breakout candle, no wider than the other side of the range.`,
  evaluate(day, { orMin }) {
    const n = day.c.length, deadline = orMin + WINDOW_MIN;
    if (n < deadline + GRACE + 5) return null;
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < orMin; i++) { hi = Math.max(hi, day.h[i]); lo = Math.min(lo, day.l[i]); }
    if (!(hi - lo > 0) || (hi - lo) / day.c[0] < MIN_RANGE_PCT) return null;
    const base = { startIdx: orMin, windowEnd: deadline + GRACE, levels: { hi, lo } };
    let near: { i: number; dir: Side; rv: number } | null = null;
    for (let i = orMin; i <= deadline; i++) {
      const dir: Side | 0 = day.c[i] > hi ? 1 : day.c[i] < lo ? -1 : 0;
      if (!dir) continue;
      const rv = relVol(day, i);
      if (rv >= RV_MIN) return { ...base, valid: true, dir, trigIdx: i, refStop: dir > 0 ? lo : hi,
        why: `${hhmm(i)} candle closed ${dir > 0 ? 'above' : 'below'} the range on ${rv.toFixed(1)}× volume.` };
      if (!near || rv > near.rv) near = { i, dir, rv };
    }
    return { ...base, valid: false,
      why: near ? `Closest: ${hhmm(near.i)} closed ${near.dir > 0 ? 'above' : 'below'} the range, but on only ${near.rv.toFixed(1)}× volume.` : 'Price never closed outside the opening range.' };
  },
};
