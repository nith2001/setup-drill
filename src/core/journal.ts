// Trade journal: one entry per finished rep, with its trades, grade, notes and tags.
// Pure data + stats; storage lives in server/journal.ts (file) and ui/journal.ts (client).
import { hhmm } from './day';
import type { Side } from './types';

export const JOURNAL_VERSION = 1;

export interface JournalTrade {
  side: Side; qty: number; entry: number; exit: number; stop0: number;
  /** ET clock times, e.g. "09:47" */
  inAt: string; outAt: string;
  ticks: number; pnl: number; R: number; reason: string;
}

export interface JournalEntry {
  id: string;
  /** When the rep was finished (ms since epoch). */
  ts: number;
  setup: string; setupLabel: string;
  sym: string; date: string;
  /** For setup drills: did the chart contain a valid setup? null for free play. */
  valid: boolean | null;
  score: number | null; grade: string; verdict: string | null; correct: boolean | null;
  netR: number; netUsd: number;
  /** Account size the rep was sized against. */
  account: number;
  trades: JournalTrade[];
  /** 1 for the first run of a chart, 2+ after "Restart chart". */
  attempt: number;
  notes: string;
  tags: string[];
}

/** Quick self-review tags offered after each rep. */
export const TAGS = ['Followed plan', 'Great read', 'Patient', 'Chased', 'Early entry', 'Moved stop', 'Cut winner early', 'Hesitated', 'FOMO', 'Revenge'];

export const newEntryId = (ts: number) => `${ts.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const tradeFromRaw = (t: { side: Side; qty: number; entry: number; exit: number; stop0: number; entryIdx: number; exitIdx: number; pnl: number; R: number; reason: string }): JournalTrade => ({
  side: t.side, qty: t.qty, entry: t.entry, exit: t.exit, stop0: t.stop0,
  inAt: hhmm(t.entryIdx), outAt: hhmm(t.exitIdx),
  ticks: Math.round((t.side * (t.exit - t.entry)) / 0.01), pnl: t.pnl, R: t.R, reason: t.reason,
});

// ---------- Stats ----------
export interface Summary {
  reps: number; trades: number; wins: number; losses: number;
  winRate: number | null; netUsd: number; netR: number; avgR: number | null;
  avgWinUsd: number | null; avgLossUsd: number | null; profitFactor: number | null;
  avgScore: number | null; calls: number; rightCalls: number; callRate: number | null;
  bestUsd: number | null; worstUsd: number | null;
}

export function summarize(es: JournalEntry[]): Summary {
  const ts = es.flatMap((e) => e.trades);
  const wins = ts.filter((t) => t.pnl > 0), losses = ts.filter((t) => t.pnl < 0);
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  const scored = es.filter((e) => e.score != null), calls = es.filter((e) => e.correct != null);
  const grossWin = sum(wins.map((t) => t.pnl)), grossLoss = -sum(losses.map((t) => t.pnl));
  return {
    reps: es.length, trades: ts.length, wins: wins.length, losses: losses.length,
    winRate: ts.length ? wins.length / ts.length : null,
    netUsd: sum(ts.map((t) => t.pnl)), netR: sum(ts.map((t) => t.R)),
    avgR: ts.length ? sum(ts.map((t) => t.R)) / ts.length : null,
    avgWinUsd: wins.length ? grossWin / wins.length : null,
    avgLossUsd: losses.length ? -grossLoss / losses.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgScore: scored.length ? sum(scored.map((e) => e.score!)) / scored.length : null,
    calls: calls.length, rightCalls: calls.filter((e) => e.correct).length,
    callRate: calls.length ? calls.filter((e) => e.correct).length / calls.length : null,
    bestUsd: ts.length ? Math.max(...ts.map((t) => t.pnl)) : null,
    worstUsd: ts.length ? Math.min(...ts.map((t) => t.pnl)) : null,
  };
}

/** Cumulative $ after each trade, in time order (for the equity curve). */
export function equityCurve(es: JournalEntry[]): number[] {
  let acc = 0;
  const out = [0];
  for (const e of [...es].sort((a, b) => a.ts - b.ts)) for (const t of e.trades) out.push((acc += t.pnl));
  return out;
}

/** Consecutive calendar days (ending today or yesterday) with at least one rep. */
export function streakDays(es: JournalEntry[], now = Date.now()): number {
  const days = new Set(es.map((e) => new Date(e.ts).toDateString()));
  let n = 0, d = new Date(now);
  if (!days.has(d.toDateString())) d = new Date(+d - 864e5);
  while (days.has(d.toDateString())) { n++; d = new Date(+d - 864e5); }
  return n;
}

/** Tag → number of reps carrying it, most common first. */
export function tagCounts(es: JournalEntry[]): [string, number][] {
  const m = new Map<string, number>();
  for (const e of es) for (const t of e.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

/** One row per trade, for spreadsheets. */
export function toCsv(es: JournalEntry[]): string {
  const head = ['finished', 'setup', 'symbol', 'chart_date', 'attempt', 'valid_setup', 'grade', 'score', 'side', 'qty', 'entry', 'exit', 'stop', 'in', 'out', 'ticks', 'pnl_usd', 'R', 'exit_reason', 'tags', 'notes'];
  const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [head.join(',')];
  for (const e of [...es].sort((a, b) => a.ts - b.ts)) {
    const base = [new Date(e.ts).toISOString(), e.setupLabel, e.sym, e.date, e.attempt, e.valid ?? '', e.grade, e.score ?? ''];
    const tail = [e.tags.join('; '), e.notes];
    if (!e.trades.length) rows.push([...base, '', '', '', '', '', '', '', '', '', '', '', ...tail].map(q).join(','));
    for (const t of e.trades) rows.push([...base, t.side > 0 ? 'long' : 'short', t.qty, t.entry, t.exit, t.stop0, t.inAt, t.outAt, t.ticks, t.pnl.toFixed(2), t.R.toFixed(2), t.reason, ...tail].map(q).join(','));
  }
  return rows.join('\n') + '\n';
}
