// `npm run reports`: lists chart reports (reports/reports.jsonl) and re-runs the CURRENT rule on each chart,
// so you can see whether a rule change fixed it. Runs under Vitest only to reuse its TypeScript setup.
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'vitest';
import { hhmm } from '../src/core/day';
import type { Day } from '../src/core/types';
import { evaluateAll } from '../src/setups';

test('chart reports', () => {
  const file = 'reports/reports.jsonl';
  const out = (s = '') => process.stdout.write(s + '\n');
  if (!existsSync(file)) return out('\nNo reports yet (reports/reports.jsonl).\n');
  const reports = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const raw = JSON.parse(readFileSync('data/days.json', 'utf8'));
  const days = (raw.days ?? raw) as Day[];
  out(`\n${reports.length} report(s)\n`);
  reports.forEach((r, n) => {
    out(`#${n + 1} ${r.savedAt?.slice(0, 16)}  ${r.label} (${r.mode})  ${r.sym} ${r.date}  rule on ${r.ruleCandles}-min candles`);
    out(`   reasons: ${(r.reasons ?? []).join('; ') || '-'}`);
    if (r.note) out(`   note: ${r.note}`);
    if (r.rule) out(`   then: ${r.rule.valid ? `VALID ${r.rule.dir} trigger ${r.rule.trigger}` : 'NO TRADE'} | ${(r.rule.marks ?? []).map((m: { text: string; candle: string }) => `${m.text}@${m.candle}`).join(' ')}`);
    const day = days.find((d) => d.sym === r.sym && d.date === r.date);
    if (!day || r.setup === 'random') return out('   now:  (no rule to re-run)\n');
    const evs = evaluateAll(r.setup, day, { orMin: 15, barMin: r.ruleCandles ?? 5 });
    const bm = r.ruleCandles ?? 5, t = (i: number) => hhmm(i - bm + 1);
    // The event covering the reported window, if any.
    const ev = evs.find((e) => r.rule && e.startIdx <= r.rule.windowEnd && e.windowEnd >= r.rule.startIdx);
    out(`   now:  ${!ev ? 'no event on this part of the chart any more' : `${ev.valid ? `VALID ${ev.dir > 0 ? 'long' : 'short'} trigger ${t(ev.trigIdx)}` : 'NO TRADE'} | ${(ev.marks ?? []).map((m) => `${m.text}@${t(m.idx)}`).join(' ')}`}`);
    if (ev) out(`          ${ev.why}`);
    out();
  });
});
