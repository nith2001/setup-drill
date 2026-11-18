// The textbook trade for a valid setup, and how it played out. Used by examples and tutorials.
import type { Day, Side, ValidEval } from './types';

export interface IdealTrade {
  side: Side; entry: number; stop: number; target: number; risk: number;
  /** Reward-to-risk of the target. */
  rr: number;
  /** Why the target sits where it does. */
  targetWhy: string;
  /** 'target' or 'stop' when one was hit (stop wins ties), else 'open' at the end of the day. */
  outcome: 'target' | 'stop' | 'open';
  exitIdx: number;
}

/** Enter on the trigger close, stop at the rule's structural stop, target from the setup (or `rr` × risk). */
export function idealTrade(day: Day, ev: ValidEval, rr = 2): IdealTrade {
  const side = ev.dir, entry = day.c[ev.trigIdx], stop = ev.refStop, risk = Math.abs(entry - stop);
  const target = ev.target?.price ?? entry + side * rr * risk, n = day.c.length;
  const targetWhy = ev.target?.why ?? `a fixed ${rr}R: no obvious level ahead, so the target is a multiple of the risk`;
  const x = { side, entry, stop, target, risk, rr: risk ? (side * (target - entry)) / risk : 0, targetWhy };
  for (let i = ev.trigIdx + 1; i < n; i++) {
    const lo = day.l[i], hi = day.h[i];
    if (side > 0 ? lo <= stop : hi >= stop) return { ...x, outcome: 'stop', exitIdx: i };
    if (side > 0 ? hi >= target : lo <= target) return { ...x, outcome: 'target', exitIdx: i };
  }
  return { ...x, outcome: 'open', exitIdx: n - 1 };
}

/** Reward-to-risk of a trade entered at `entry` with `stop`, aiming at `target`. */
export const rrOf = (dir: Side, entry: number, stop: number, target: number) => (dir * (target - entry)) / Math.abs(entry - stop || 1e-9);
