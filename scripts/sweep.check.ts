import { test } from 'vitest';
import type { Day } from '../src/core/types';
import { evaluateAll } from '../src/setups';
import { TOL } from '../src/setups/util';
import { add, fmtRow, loadDays, tradeR, type Row } from './audit.check';

export function sweep(id: string, cfg: Record<string, unknown>, V: [string, Record<string, unknown>][], days: Day[]) {
  const base = { ...cfg }, out = (s: string) => process.stdout.write(s + '\n');
  out(`\n${id}`);
  for (const [name, v] of V) {
    Object.assign(cfg, base, v);
    const all: Row = { n: 0, win: 0, R: 0 }, idx: Row = { n: 0, win: 0, R: 0 }, a: Row = { n: 0, win: 0, R: 0 }, b: Row = { n: 0, win: 0, R: 0 };
    for (const d of days) for (const e of evaluateAll(id, d, { orMin: 15, barMin: 5 })) if (e.valid) {
      const x = tradeR(d, e); add(all, x);
      if (d.sym === 'SPY' || d.sym === 'QQQ') add(idx, x);
      add(d.date < '2025' ? a : b, x);
    }
    out(`${name.padEnd(30)} ALL ${fmtRow(all)} | SPYQQQ ${fmtRow(idx)} | <2025 ${fmtRow(a)} | 2025+ ${fmtRow(b)}`);
  }
  Object.assign(cfg, base);
}

test.skipIf(process.env.CHECK !== 'sweep')('sweep', () => {
  const days = loadDays();
  for (const id of ['srReject', 'srFlip', 'orb', 'trend123', 'rangeFade']) sweep(id, TOL, [['pct 0.05% (old)', {}], ['pct 0.02%', { pct: 0.0002 }], ['pct 0.01%', { pct: 0.0001 }], ['ticks only', { pct: 0 }]], days);
}, 3600000);
