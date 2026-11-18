// `npm run audit`: pool sizes and textbook-trade results per setup on the cached real data (5-min rules).
// AUDIT_SETUPS=orb,flag limits the setups; AUDIT_BIAS=legacy uses the old month + week bias for comparison.
// Runs under Vitest only to reuse its TypeScript setup.
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { biasOf } from '../src/core/bias';
import { idealTrade } from '../src/core/ideal';
import type { Day } from '../src/core/types';
import { evaluateAll, SETUPS } from '../src/setups';

export interface Row { n: number; win: number; R: number }
export const add = (r: Row, x: number) => { r.n++; r.R += x; if (x > 0) r.win++; };
export const fmtRow = (r: Row) => `${String(r.n).padStart(4)} ${String(r.n ? Math.round((100 * r.win) / r.n) : 0).padStart(3)}% ${(r.n ? r.R / r.n : 0).toFixed(2).padStart(5)}R`;

/** Textbook trade result in R: target, stop (-1), or the close if neither was hit. */
export function tradeR(d: Day, e: Parameters<typeof idealTrade>[1]) {
  const t = idealTrade(d, e);
  return t.outcome === 'target' ? t.rr : t.outcome === 'stop' ? -1 : (t.side * (d.c[d.c.length - 1] - t.entry)) / (t.risk || 1);
}

export function loadDays(): Day[] {
  const raw = JSON.parse(readFileSync('data/days.json', 'utf8'));
  const days = (raw.days ?? raw) as Day[];
  if (process.env.AUDIT_BIAS === 'legacy') for (const d of days) if (d.ctx) d.ctx = { ...d.ctx, h4: undefined };
  return days;
}

test.skipIf(process.env.CHECK !== 'audit')('audit', () => {
  const days = loadDays(), out = (s: string) => process.stdout.write(s + '\n');
  const only = process.env.AUDIT_SETUPS?.split(',');
  const kinds: Record<string, number> = {};
  for (const d of days) { const b = biasOf(d); kinds[b?.kind ?? 'none'] = (kinds[b?.kind ?? 'none'] ?? 0) + 1; }
  out(`\n${days.length} days, bias: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  out(`${''.padEnd(26)} ${'SPY/QQQ valid win avg'.padEnd(22)} | ${'all valid win avg'.padEnd(20)} | 2024 | 2025+`);
  const idx = (d: Day) => d.sym === 'SPY' || d.sym === 'QQQ';
  for (const s of SETUPS) {
    if (only && !only.includes(s.id)) continue;
    const r = { idx: { n: 0, win: 0, R: 0 }, all: { n: 0, win: 0, R: 0 }, y24: { n: 0, win: 0, R: 0 }, y25: { n: 0, win: 0, R: 0 } };
    for (const d of days) for (const e of evaluateAll(s.id, d, { orMin: 15, barMin: 5 })) {
      if (!e.valid) continue;
      const x = tradeR(d, e);
      add(r.all, x); if (idx(d)) add(r.idx, x);
      if (d.date < '2025') add(r.y24, x); else add(r.y25, x);
    }
    out(`${s.label.padEnd(26)} ${fmtRow(r.idx)}      | ${fmtRow(r.all)}    | ${fmtRow(r.y24)} | ${fmtRow(r.y25)}`);
  }
}, 3600000);
