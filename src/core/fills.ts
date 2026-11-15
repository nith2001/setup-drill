import type { Day, Fill, OHLC, Side } from './types';

export interface FillPos { side: Side; stop: number; target: number | null }

/** Evaluate one bar for an open position. Conservative: if stop and target are both inside the bar, stop wins. */
export function evalBar(pos: FillPos, bar: OHLC): Fill | null {
  const { side, stop, target } = pos;
  const { o, h, l } = bar;
  if (side > 0) {
    if (o <= stop) return { price: o, reason: 'stop', gap: true };
    if (target != null && o >= target) return { price: o, reason: 'target', gap: true };
    if (l <= stop) return { price: stop, reason: 'stop' };
    if (target != null && h >= target) return { price: target, reason: 'target' };
  } else {
    if (o >= stop) return { price: o, reason: 'stop', gap: true };
    if (target != null && o <= target) return { price: o, reason: 'target', gap: true };
    if (h >= stop) return { price: stop, reason: 'stop' };
    if (target != null && l <= target) return { price: target, reason: 'target' };
  }
  return null;
}

/** Slippage applied to market entries/exits. */
export const slippage = (px: number) => Math.max(0.01, px * 0.0002);

/** Mechanical simulation for benchmark trades. Returns R (gross, no costs). */
export function simulateTrade(day: Day, side: Side, entryIdx: number, entryPrice: number, stop: number, rMult: number | null, evalFrom: number) {
  const risk = Math.abs(entryPrice - stop);
  if (!(risk > 0)) return null;
  const target = rMult ? entryPrice + side * risk * rMult : null;
  const pos = { side, stop, target };
  let mfe = 0, mae = 0, exitIdx = day.c.length - 1;
  let exit: { price: number; reason: string } | null = null;
  for (let i = evalFrom; i < day.c.length; i++) {
    const bar = { o: day.o[i], h: day.h[i], l: day.l[i], c: day.c[i] };
    const res = evalBar(pos, bar);
    const fav = side > 0 ? bar.h - entryPrice : entryPrice - bar.l;
    const adv = side > 0 ? entryPrice - bar.l : bar.h - entryPrice;
    if (res) {
      if (res.reason === 'target') { mfe = Math.max(mfe, side * (res.price - entryPrice)); mae = Math.max(mae, adv); }
      else mae = Math.max(mae, risk, side * (entryPrice - res.price)); // stop bar: no favorable credit
      exit = res; exitIdx = i; break;
    }
    mfe = Math.max(mfe, fav); mae = Math.max(mae, adv);
  }
  if (!exit) exit = { price: day.c[day.c.length - 1], reason: 'eod' };
  const R = (side * (exit.price - entryPrice)) / risk;
  return { R, exitIdx, exitPrice: exit.price, reason: exit.reason, mfeR: mfe / risk, maeR: Math.min(mae / risk, 5), entryIdx, entryPrice, stop, side };
}
