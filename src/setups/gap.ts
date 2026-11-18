import { vwapAt } from '../core/day';
import type { Side } from '../core/types';
import { GRACE, type SetupDef } from './types';
import { at, bars, ruleHtml } from './util';

/** Tunable thresholds (the audit sweeps these). */
export const GAP = {
  MIN_GAP: 0.015,
  RANGE_MIN: 5, // first-N-minute range
  DEADLINE_MIN: 35, // 10:05
};


export const gap: SetupDef = {
  id: 'gap',
  openOnly: true,
  group: 'Price action',
  label: 'Gap & Go',
  preset: { vwap: true, pd: true },
  blurb: 'Stocks that gapped 1.5%+. Only some of them go.',
  rule: (o) => ruleHtml(o, [
    ['Setup', [`Opens <b>≥${GAP.MIN_GAP * 100}%</b> away from yesterday's close`, `Mark the first ${GAP.RANGE_MIN}-min high (gap up) or low (gap down)`]],
    ['Entry', ['A candle <b>closes through</b> that level by 10:05', 'Price on the <b>right side of VWAP</b> (above it for gap ups)', 'Enter within 3 candles']],
    ['Risk', [`Stop: beyond the trigger candle (no wider than the other side of the ${GAP.RANGE_MIN}-min range)`, 'Target: 2R']],
    ['Skip it if', ['No close through the level by 10:05', 'Price is on the wrong side of VWAP']],
  ]),
  evaluate(day, o) {
    if (o.from || day.pc == null || day.c.length < bars(day, 60)) return null;
    const g = (day.o[0] - day.pc) / day.pc;
    if (Math.abs(g) < GAP.MIN_GAP) return null;
    const dir: Side = g > 0 ? 1 : -1, nb = bars(day, GAP.RANGE_MIN), deadline = bars(day, GAP.DEADLINE_MIN);
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < nb; i++) { hi = Math.max(hi, day.h[i]); lo = Math.min(lo, day.l[i]); }
    const base = { startIdx: nb, windowEnd: deadline + GRACE, levels: { hi, lo }, marks: [{ idx: nb - 1, text: 'first 5 min', above: dir > 0 }],
      lines: [{ price: dir > 0 ? hi : lo, text: `${GAP.RANGE_MIN}-min ${dir > 0 ? 'high' : 'low'}`, idx: nb - 1 }] };
    let near: number | null = null;
    for (let i = nb; i <= deadline; i++) {
      const broke = dir > 0 ? day.c[i] > hi : day.c[i] < lo;
      if (!broke) continue;
      const vw = vwapAt(day, i), sideOk = dir > 0 ? day.c[i] > vw : day.c[i] < vw;
      if (sideOk) return { ...base, valid: true, dir, trigIdx: i, refStop: dir > 0 ? Math.min(lo, day.l[i]) : Math.max(hi, day.h[i]),
        why: `Gapped ${(g * 100).toFixed(1)}%; the ${at(day, i)} candle closed ${dir > 0 ? 'above the 5-min high' : 'below the 5-min low'} on the right side of VWAP.` };
      if (near == null) near = i;
    }
    return { ...base, valid: false,
      why: near != null ? `The ${at(day, near)} candle broke the 5-min level but on the wrong side of VWAP.` : `Gapped ${(g * 100).toFixed(1)}% but never closed through the 5-min ${dir > 0 ? 'high' : 'low'} by 10:05.` };
  },
};
