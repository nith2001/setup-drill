import type { Day, Indicators } from './types';

export function emaArr(c: number[], n: number): number[] {
  const k = 2 / (n + 1), out = new Array<number>(c.length).fill(NaN);
  let e = c[0];
  for (let i = 0; i < c.length; i++) { e = i ? c[i] * k + e * (1 - k) : c[0]; if (i >= n - 1) out[i] = e; }
  return out;
}

export function smaArr(c: number[], n: number): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}

export function rsiArr(c: number[], n = 14): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
    if (i >= n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

/** MACD line, signal line and histogram. Values before slow+signal-2 bars are NaN. */
export function macdArr(c: number[], fast = 12, slow = 26, signal = 9) {
  const ef = emaArr(c, fast), es = emaArr(c, slow), warm = slow + signal - 2;
  const raw = c.map((_, i) => ef[i] - es[i]);
  const sigRaw = emaArr(raw.map((v) => (isFinite(v) ? v : 0)), signal);
  const macd = raw.map((v, i) => (i >= warm ? v : NaN));
  const sig = sigRaw.map((v, i) => (i >= warm ? v : NaN));
  return { macd, signal: sig, hist: macd.map((v, i) => v - sig[i]) };
}

/** Indicators the setup rules use, computed on the day's 1-min closes (no prior-day warmup). Cached on the day. */
export function indicators(day: Day): Indicators {
  if (day._ind) return day._ind;
  const c = day.c, m = macdArr(c, 12, 26, 9);
  day._ind = { e9: emaArr(c, 9), e20: emaArr(c, 20), sma50: smaArr(c, 50), rsi: rsiArr(c, 14), macd: m.macd, sig: m.signal, hist: m.hist };
  return day._ind;
}
