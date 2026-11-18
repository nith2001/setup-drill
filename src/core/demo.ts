// Synthetic demo data so the app works with no data source.
import { gauss, mulberry32, r2 } from './math';
import type { Dataset, Day } from './types';

export const DEMO_SOURCE = 'synthetic demo';

/** The `count` weekdays ending at endDateStr, oldest first. */
export function nextWeekdays(endDateStr: string, count: number): string[] {
  const out: string[] = [];
  const [y, m, d] = endDateStr.split('-').map(Number);
  let dt = new Date(Date.UTC(y, m - 1, d));
  while (out.length < count) {
    const wd = dt.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(dt.toISOString().slice(0, 10));
    dt = new Date(dt.getTime() - 86400000);
  }
  return out.reverse();
}

interface Profile { sigma: number; vol: number }

export function genDay(rng: () => number, sym: string, date: string, prevClose: number, profile: Profile): Day {
  const N = 390;
  const o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
  const gap = rng() < 0.22 ? gauss(rng) * 0.016 + (rng() < 0.5 ? -0.01 : 0.01) : gauss(rng) * 0.003;
  let price = prevClose * (1 + gap);
  const drift = rng() < 0.3 ? (rng() < 0.5 ? -1 : 1) * (0.00004 + rng() * 0.00007) : 0;
  const baseSig = profile.sigma * (0.8 + rng() * 0.6);
  const meanRevTo = price; // mild mean reversion on chop days
  for (let i = 0; i < N; i++) {
    const u = i < 30 ? 2.2 - (i / 30) * 1.2 : i > 360 ? 1 + ((i - 360) / 30) * 0.6 : 0.85 + 0.15 * Math.sin(i / 60);
    const sig = baseSig * u;
    const open = price;
    let ret = gauss(rng) * sig + drift;
    if (drift === 0) ret += ((meanRevTo - price) / price) * 0.01;
    if (rng() < 0.012) ret += gauss(rng) * sig * 4; // occasional momentum burst
    const close = Math.max(0.5, open * (1 + ret));
    const ex = Math.abs(gauss(rng)) * sig * 0.7;
    const hi = Math.max(open, close) * (1 + ex * rng());
    const lo = Math.min(open, close) * (1 - ex * rng());
    o[i] = r2(open); c[i] = r2(close); h[i] = r2(Math.max(hi, open, close)); l[i] = r2(Math.min(lo, open, close));
    if (h[i] < Math.max(o[i], c[i])) h[i] = Math.max(o[i], c[i]);
    if (l[i] > Math.min(o[i], c[i])) l[i] = Math.min(o[i], c[i]);
    const vm = profile.vol * u * Math.exp(gauss(rng) * 0.5) * (1 + (Math.abs(ret) / sig) * 0.3);
    v[i] = Math.max(100, Math.round(vm));
    price = close;
  }
  return { sym, date, pc: r2(prevClose), o, h, l, c, v };
}

export function genDataset(seed: number, endDate: string, nDays: number): Dataset {
  const rng = mulberry32(seed);
  const profiles: [string, number, Profile][] = [
    ['DEMO1', 180, { sigma: 0.0007, vol: 90000 }], ['DEMO2', 420, { sigma: 0.0006, vol: 60000 }],
    ['DEMO3', 95, { sigma: 0.0011, vol: 150000 }], ['DEMO4', 260, { sigma: 0.0009, vol: 80000 }],
    ['DEMO5', 52, { sigma: 0.0013, vol: 220000 }], ['DEMO6', 340, { sigma: 0.0008, vol: 50000 }],
  ];
  const dates = nextWeekdays(endDate, nDays);
  const days: Day[] = [];
  for (const [sym, start, prof] of profiles) {
    // Synthetic daily closes before the first day, so daily SMAs exist from day one.
    const closes: number[] = [];
    for (let k = 0, p = start * (1 + gauss(rng) * 0.15); k < 220; k++) { p *= 1 + gauss(rng) * 0.015 + (start / p - 1) * 0.02; closes.push(r2(p)); }
    let pc = start, ph = start * 1.01, pl = start * 0.99, prev5: number[] = [];
    const vols: number[][] = []; // 5-min slot volumes of earlier sessions (time-of-day baseline)
    closes.push(pc);
    for (const date of dates) {
      const sma = (n: number) => r2(closes.slice(-n).reduce((x, y) => x + y, 0) / n);
      const d = genDay(rng, sym, date, pc, prof);
      const recent = vols.slice(-20);
      const vol5 = recent.length >= 5 ? Array.from({ length: 78 }, (_, k) => Math.round(recent.reduce((a, v) => a + (v[k] ?? 0), 0) / recent.length)) : undefined;
      d.ctx = { pdh: r2(ph), pdl: r2(pl), pdc: r2(pc), sma50: sma(50), sma200: sma(200), prev5, closes: closes.slice(-21), vol5 };
      days.push(d);
      pc = d.c[d.c.length - 1]; ph = Math.max(...d.h); pl = Math.min(...d.l);
      prev5 = d.c.filter((_, i) => i % 5 === 4);
      vols.push(Array.from({ length: 78 }, (_, k) => d.v.slice(k * 5, k * 5 + 5).reduce((a, b) => a + b, 0)));
      closes.push(pc);
    }
  }
  return { meta: { source: DEMO_SOURCE, note: 'Randomly generated — not real prices.', symbols: profiles.map((p) => p[0]) }, days };
}

export const randomDemoDataset = () => genDataset(Math.floor(Math.random() * 1e9), new Date().toISOString().slice(0, 10), 60);
