// Simulated price path inside a 1-minute bar, for real-time replay.
// The data only has each minute's open/high/low/close, so the path in between is generated:
// it starts at the open, touches the high and the low (in a plausible order), wanders in 1-cent
// steps in between, and ends exactly at the close. Seeded by sym/date/minute, so a restart replays
// the same path.
import type { Day } from './types';

/** Price updates per minute (one every half-second at real-time speed). */
export const TICKS = 120;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Small fast seeded RNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cents = (x: number) => Math.round(x * 100) / 100;

/** TICKS+1 prices for 1-min bar i: [0] = open, [TICKS] = close, high and low each reached exactly once at least. */
export function minutePath(day: Day, i: number): number[] {
  const o = day.o[i], h = day.h[i], l = day.l[i], c = day.c[i];
  const out = new Array<number>(TICKS + 1);
  if (!(h > l)) return out.fill(c);
  const r = rng(hash(`${day.sym}|${day.date}|${i}`));
  // Which extreme comes first: up bars usually dip first, down bars usually pop first.
  const lowFirst = c >= o ? r() < 0.7 : r() < 0.3;
  const t1 = 4 + Math.floor(r() * (TICKS * 0.45));
  const t2 = Math.min(TICKS - 4, t1 + 4 + Math.floor(r() * (TICKS - t1 - 8)));
  const anchors: [number, number][] = [[0, o], [t1, lowFirst ? l : h], [t2, lowFirst ? h : l], [TICKS, c]];
  const range = h - l;
  for (let a = 0; a < anchors.length - 1; a++) {
    const [ta, pa] = anchors[a], [tb, pb] = anchors[a + 1], n = tb - ta;
    // Brownian bridge from pa to pb: random walk, then tilt it so it lands exactly on pb.
    const walk = [0];
    for (let k = 1; k <= n; k++) walk.push(walk[k - 1] + (r() - 0.5) * range * 0.18);
    for (let k = 0; k <= n; k++) {
      const p = pa + (pb - pa) * (k / n) + walk[k] - walk[n] * (k / n);
      out[ta + k] = cents(Math.min(h, Math.max(l, p)));
    }
  }
  for (const [t, p] of anchors) out[t] = p; // exact OHLC at the anchors
  return out;
}

/** OHLCV of bar i formed up to tick k (of TICKS). */
export function partialBar(day: Day, i: number, path: number[], k: number) {
  let hi = -Infinity, lo = Infinity;
  for (let j = 0; j <= k; j++) { if (path[j] > hi) hi = path[j]; if (path[j] < lo) lo = path[j]; }
  return { o: path[0], h: hi, l: lo, c: path[k], v: Math.round(day.v[i] * (k / TICKS)) };
}
