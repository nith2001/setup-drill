// How live trade numbers are shown: ticks (futures-style), dollars, or R multiples.
export type PnlView = 'ticks' | 'usd' | 'r';
export const PNL_VIEWS: [PnlView, string][] = [['ticks', 'Ticks'], ['usd', '$'], ['r', 'R']];
/** Minimum price increment for US stocks. */
export const TICK = 0.01;

export const toTicks = (priceMove: number) => Math.round(priceMove / TICK);
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
export const money = (v: number) => `${sign(v)}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Format a signed per-share price move (positive = in your favor).
 * qty and riskPerShare are used for the $ and R views.
 */
export function fmtMove(view: PnlView, move: number, qty: number, riskPerShare: number): string {
  if (view === 'usd') return money(move * qty);
  if (view === 'r') { const r = riskPerShare > 0 ? move / riskPerShare : 0; return `${sign(r)}${Math.abs(r).toFixed(2)}R`; }
  const t = toTicks(move);
  return `${sign(t)}${Math.abs(t)} tick${Math.abs(t) === 1 ? '' : 's'}`;
}

/** Reward : risk of a bracket as it stands (target vs the current stop), e.g. "2.0:1". null if the stop is past entry. */
export function rrRatio(side: number, entry: number, stop: number, target: number): string | null {
  const risk = side * (entry - stop);
  return risk > 0 ? `${(side * (target - entry) / risk).toFixed(1)}:1` : null;
}
