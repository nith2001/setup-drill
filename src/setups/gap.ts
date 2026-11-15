import { hhmm, vwapAt } from '../core/day';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';

const MIN_GAP = 0.015;
const RANGE_MIN = 5; // first-N-minute range
const DEADLINE = 35; // bar index (10:05)

export const gap: SetupDef = {
  id: 'gap',
  group: 'Price action',
  label: 'Gap & Go',
  blurb: 'Stocks that gapped 1.5%+. Only some of them go.',
  rule: () => `Gap ≥${MIN_GAP * 100}%. A 1-min candle <b>closes</b> through the first-${RANGE_MIN}-min high (gap up) or low (gap down), on the <b>right side of VWAP</b>, by 10:05. Enter within 3 bars. Stop: beyond the trigger candle, no wider than the other side of the ${RANGE_MIN}-min range.`,
  evaluate(day) {
    if (day.pc == null || day.c.length < 60) return null;
    const g = (day.o[0] - day.pc) / day.pc;
    if (Math.abs(g) < MIN_GAP) return null;
    const dir: Side = g > 0 ? 1 : -1;
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < RANGE_MIN; i++) { hi = Math.max(hi, day.h[i]); lo = Math.min(lo, day.l[i]); }
    const base = { startIdx: RANGE_MIN, windowEnd: DEADLINE + GRACE, levels: { hi, lo } };
    let near: number | null = null;
    for (let i = RANGE_MIN; i <= DEADLINE; i++) {
      const broke = dir > 0 ? day.c[i] > hi : day.c[i] < lo;
      if (!broke) continue;
      const vw = vwapAt(day, i), sideOk = dir > 0 ? day.c[i] > vw : day.c[i] < vw;
      if (sideOk) return { ...base, valid: true, dir, trigIdx: i, refStop: dir > 0 ? lo : hi,
        why: `Gapped ${(g * 100).toFixed(1)}%; ${hhmm(i)} closed ${dir > 0 ? 'above the 5-min high' : 'below the 5-min low'} on the right side of VWAP.` };
      if (near == null) near = i;
    }
    return { ...base, valid: false,
      why: near != null ? `${hhmm(near)} broke the 5-min level but on the wrong side of VWAP.` : `Gapped ${(g * 100).toFixed(1)}% but never closed through the 5-min ${dir > 0 ? 'high' : 'low'} by 10:05.` };
  },
};
