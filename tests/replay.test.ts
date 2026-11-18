import assert from 'node:assert';
import { test } from 'vitest';
import { buildCandles, historyFromDays, nextBarEnd } from '../src/core/candles';
import { genDataset } from '../src/core/demo';
import { DEFAULT_INDICATORS, presetConfig, vwapSeries } from '../src/core/overlays';
import { Replay } from '../src/engine/replay';

const ds = genDataset(3, '2025-06-30', 30);
const day = ds.days[29]; // DEMO1, last date: 29 earlier days of history
const hist = historyFromDays(ds.days, day.sym, day.date);

test('historyFromDays: only earlier days of the same symbol', () => {
  assert.strictEqual(hist.daily.length, 29);
  assert.ok(hist.daily.every((c) => c.date < day.date));
  assert.strictEqual(hist.m5[0].c.length, 78); // 390 / 5
});

test('buildCandles: each timeframe has the right candle counts and today is partial', () => {
  const upto = 59; // first hour revealed
  assert.strictEqual(buildCandles(1, hist, day, upto).length, 2 * 390 + 60, 'previous 2 sessions + today');
  assert.strictEqual(buildCandles(5, hist, day, upto).length, 29 * 78 + 12);
  assert.strictEqual(buildCandles(15, hist, day, upto).length, 29 * 26 + 4);
  assert.strictEqual(buildCandles(60, hist, day, upto).length, 29 * 7 + 1); // 6.5h -> 7 hourly buckets
  assert.strictEqual(buildCandles(240, hist, day, upto).length, 29 * 2 + 1);
  const d = buildCandles('D', hist, day, upto);
  assert.strictEqual(d.length, 30);
  const today = d[d.length - 1];
  assert.strictEqual(today.close, day.c[upto], 'forming daily candle closes at the current bar');
  assert.strictEqual(today.high, Math.max(...day.h.slice(0, upto + 1)));
});

test('nextBarEnd: completes the current candle, then whole candles', () => {
  assert.strictEqual(nextBarEnd(2, 5, 389), 4);
  assert.strictEqual(nextBarEnd(4, 5, 389), 9);
  assert.strictEqual(nextBarEnd(10, 1, 389), 11);
  assert.strictEqual(nextBarEnd(10, 'D', 300), 300);
  assert.strictEqual(nextBarEnd(385, 15, 389), 389, 'clamped to the end');
});

test('vwapSeries resets each day', () => {
  const cs = buildCandles(5, hist, day, 100);
  const v = vwapSeries(cs);
  const firstToday = cs.findIndex((c) => c.date === day.date);
  const c0 = cs[firstToday];
  assert.ok(Math.abs(v[firstToday] - (c0.high + c0.low + c0.close) / 3) < 1e-9);
});

test('presetConfig shows exactly what a drill lists', () => {
  const c = presetConfig({ mas: [{ type: 'ema', period: 9 }, { type: 'sma', period: 13 }], rsi: true });
  assert.ok(c.mas.find((m) => m.id === 'ema9')!.on);
  assert.ok(c.mas.some((m) => m.type === 'sma' && m.period === 13 && m.on));
  assert.ok(!c.mas.find((m) => m.id === 'ema20')!.on, 'unlisted MAs off');
  assert.strictEqual(c.mas.length, DEFAULT_INDICATORS.mas.length + 1);
  assert.ok(c.rsi.on && !c.vwap && !c.macd.on && c.volume);
  assert.ok(presetConfig({ pd: true, dsma: true, vwap: true }).pd && presetConfig({ vwap: true }).vwap);
  assert.ok(!DEFAULT_INDICATORS.vwap && !DEFAULT_INDICATORS.pd && !DEFAULT_INDICATORS.mas[0].on, 'defaults off and not mutated');
});

function mkRep() {
  return new Replay({ setup: 'random', def: null, day, ev: null, startIdx: 20, endIdx: 200, orMin: 15 });
}

test('Replay: planned bracket, sizing from $ risk, entry, restart clears everything', () => {
  const r = mkRep();
  r.advanceTo(30);
  // default plan follows the 5-bar low; then use an explicit stop: 2R target, $250 risk
  assert.ok(r.plan.stop <= r.fiveBar.lo && r.plan.error === null, 'auto stop at or beyond the 5-bar low');
  r.setStop(r.last * 0.99);
  const p0 = r.plan;
  assert.strictEqual(p0.error, null);
  assert.ok(p0.stop < p0.entry && p0.target! > p0.entry);
  assert.ok(Math.abs((p0.target! - p0.entry) / (p0.entry - p0.stop) - 2) < 0.02);
  assert.ok(p0.riskUsd <= 250 && p0.riskUsd > 250 - (p0.entry - p0.stop) - 0.01, 'qty floors to the risk budget');
  // wrong-side stop rejected
  assert.match(r.setStop(r.last + 1)!, /below price/);
  // % risk sizes off the balance
  r.setOrder({ riskMode: 'pct', risk: 1 });
  assert.ok(r.plan.riskUsd <= 500 && r.plan.riskUsd > 400);
  // dragged target sticks; R:R change resets it
  r.setTarget(r.last * 1.05);
  assert.strictEqual(r.plan.target, Math.round(r.last * 1.05 * 100) / 100);
  r.setOrder({ rr: 3 });
  assert.ok(Math.abs((r.plan.target! - r.plan.entry) / (r.plan.entry - r.plan.stop) - 3) < 0.02);
  // short side flips the default stop above price
  r.selectSide(-1);
  assert.ok(r.plan.stop > r.plan.entry, 'long stop dropped, default short stop is above');
  r.selectSide(1);
  r.setStop(r.last * 0.995);
  const qty = r.plan.qty;
  assert.strictEqual(r.enter(1), null);
  assert.ok(r.pos && r.pos.qty === qty);
  r.advanceTo(199);
  r.end();
  assert.ok(r.done && r.result && r.trades.length === 1);
  const t = r.trades[0];
  assert.ok(Math.abs(t.pnl - t.side * (t.exit - t.entry) * t.qty) < 1e-6);
  assert.ok(Math.abs(r.balance - (50000 + t.pnl)) < 1e-6);
  r.restart();
  assert.strictEqual(r.cur, 19);
  assert.ok(!r.done && !r.result && !r.pos && r.stopPx == null);
  assert.deepStrictEqual([r.trades.length, r.balance], [0, 50000]);
});

test('Replay: buying power caps size', () => {
  const r = mkRep();
  r.advanceTo(30);
  r.setOrder({ risk: 1e9 });
  assert.ok(r.plan.qty * r.plan.entry <= 200000 + 1e-6);
});

test('Replay: stepBar on 5m lands on candle boundaries; end at endIdx grades', () => {
  const r = mkRep();
  r.stepBar(5); assert.strictEqual(r.cur, 24);
  r.stepBar(5); assert.strictEqual(r.cur, 29);
  r.stepBar('D');
  assert.strictEqual(r.cur, 200);
  assert.ok(r.done && r.result);
});

test('fmtMove: ticks, dollars and R', async () => {
  const { fmtMove } = await import('../src/ui/pnl');
  assert.strictEqual(fmtMove('ticks', 0.23, 100, 0.5), '+23 ticks');
  assert.strictEqual(fmtMove('ticks', -0.01, 100, 0.5), '−1 tick');
  assert.strictEqual(fmtMove('usd', -0.5, 100, 0.5), '−$50.00');
  assert.strictEqual(fmtMove('r', 1, 100, 0.5), '+2.00R');
});

test('journal: summary, equity curve, csv', async () => {
  const { summarize, equityCurve, toCsv } = await import('../src/core/journal');
  const t = (pnl: number, R: number) => ({ side: 1 as const, qty: 10, entry: 1, exit: 1, stop0: 0.9, inAt: '09:40', outAt: '09:50', ticks: 0, pnl, R, reason: 'manual' });
  const e = (ts: number, trades: ReturnType<typeof t>[], correct: boolean | null) => ({
    id: String(ts), ts, setup: 'orb', setupLabel: 'ORB', sym: 'X', date: '2025-01-02', valid: true, score: 80, grade: 'ok', verdict: null, correct,
    netR: 0, netUsd: 0, account: 50000, trades, attempt: 1, notes: 'a, "quoted" note', tags: ['Chased'],
  });
  const es = [e(2, [t(-50, -1)], false), e(1, [t(100, 2), t(20, 0.4)], true)];
  const s = summarize(es);
  assert.deepStrictEqual([s.trades, s.wins, s.losses, s.netUsd, s.calls, s.rightCalls], [3, 2, 1, 70, 2, 1]);
  assert.ok(Math.abs(s.profitFactor! - 120 / 50) < 1e-9);
  assert.deepStrictEqual(equityCurve(es), [0, 100, 120, 70], 'time ordered');
  const csv = toCsv(es).trim().split('\n');
  assert.strictEqual(csv.length, 4);
  assert.ok(csv[1].endsWith('"a, ""quoted"" note"'));
});

test('journal store: add, patch, dedupe, delete (file)', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { journalStore } = await import('../server/journal');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jr-')), 'j.json');
  const st = journalStore(file);
  const base = { ts: 1, setup: 'random', setupLabel: 'Free', sym: 'X', date: 'd', valid: null, score: null, grade: '', verdict: null, correct: null, netR: 0, netUsd: 0, account: 50000, trades: [], attempt: 1, notes: '', tags: [] };
  assert.strictEqual(st.add([{ ...base, id: 'a' }, { ...base, id: 'b' }]), 2);
  assert.strictEqual(st.add([{ ...base, id: 'a' }]), 0, 'duplicate ids ignored');
  assert.ok(st.patch('a', { notes: 'hi', tags: ['FOMO'] }));
  assert.ok(st.remove('b'));
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(saved.entries.map((x: { id: string; notes: string }) => [x.id, x.notes]), [['a', 'hi']]);
});

test('minutePath: starts at the open, ends at the close, touches high and low, stays inside, repeats', async () => {
  const { minutePath, TICKS } = await import('../src/core/path');
  for (let i = 0; i < day.c.length; i += 7) {
    const p = minutePath(day, i);
    assert.strictEqual(p.length, TICKS + 1);
    assert.strictEqual(p[0], day.o[i]); assert.strictEqual(p[TICKS], day.c[i]);
    if (day.h[i] > day.l[i]) { assert.ok(p.includes(day.h[i]) && p.includes(day.l[i]), `bar ${i} reaches H and L`); }
    assert.ok(p.every((x) => x >= day.l[i] - 1e-9 && x <= day.h[i] + 1e-9), `bar ${i} inside its range`);
    assert.deepStrictEqual(minutePath(day, i), p, 'same path every time');
  }
});

test('Replay real-time: forming bar ticks along the path, completes to real OHLC, chart merges it', async () => {
  const { TICKS } = await import('../src/core/path');
  const r = mkRep();
  r.advanceTo(30);
  assert.strictEqual(r.sub, -1);
  (r as any).stepTicks(TICKS / 2 + 1); // open + half the minute
  const f = r.forming!;
  assert.strictEqual(f.idx, 31);
  assert.ok(f.h <= day.h[31] && f.l >= day.l[31] && r.last === f.c && r.seconds === 30);
  const cs = buildCandles(1, hist, day, r.cur, undefined, f);
  assert.strictEqual(cs[cs.length - 1].close, f.c, 'forming bar is the last 1m candle');
  const c5 = buildCandles(5, hist, day, r.cur, undefined, f);
  assert.strictEqual(c5[c5.length - 1].close, f.c, 'and is merged into its 5m candle');
  r.advanceTo(31);
  assert.strictEqual(r.cur, 31); assert.strictEqual(r.sub, -1); assert.strictEqual(r.last, day.c[31]);
});

test('Replay real-time: stops fill on the tick path; auto-slow drops to 1× on entry', () => {
  const r = mkRep();
  r.advanceTo(30);
  r.setSpeed(60);
  r.setStop(r.last - 0.05);
  assert.strictEqual(r.enter(1), null);
  assert.strictEqual(r.speed, 1, 'auto-slow');
  const stop = r.pos!.stop;
  r.advanceTo(199);
  const t = r.trades[0];
  assert.ok(t, 'trade closed');
  if (t.reason === 'stop') assert.ok(t.exit === stop || t.exit < stop, 'filled at the stop (or a gap below it)');
  assert.ok(t.exitIdx > 30);
});

test('Replay: an open trade keeps the rep going past its window until it closes or the day ends', () => {
  // Wide bracket so it stays open past the window.
  const r = new Replay({ setup: 'random', def: null, day, ev: null, startIdx: 20, endIdx: 60, orMin: 15 });
  r.advanceTo(50);
  r.setStop(r.last * 0.5);
  r.setTarget(r.last * 2);
  assert.strictEqual(r.enter(1), null);
  r.advanceTo(60);
  assert.ok(!r.done && r.overtime, 'still running at the window end');
  r.advanceTo(80);
  assert.strictEqual(r.cur, 80);
  r.flatten();
  r.stepMinute();
  assert.ok(r.done && r.trades[0].reason === 'manual', 'ends once flat past the window');
  // Never entered: ends at the window as before.
  const q = new Replay({ setup: 'random', def: null, day, ev: null, startIdx: 20, endIdx: 60, orMin: 15 });
  q.stepBar('D');
  assert.ok(q.done && q.cur === 60);
  // Still open at the close: closed at the last price.
  const s = new Replay({ setup: 'random', def: null, day, ev: null, startIdx: 20, endIdx: 60, orMin: 15 });
  s.advanceTo(50); s.setStop(s.last * 0.5); s.setTarget(s.last * 2); s.enter(1);
  s.stepBar('D'); s.stepBar('D');
  assert.ok(s.done && s.cur === day.c.length - 1 && s.trades[0].reason === 'end');
});

test('contracts: size scales by contract and R is measured against one contract', () => {
  const mk = (contracts: number) => {
    const r = new Replay({ setup: 'random', def: null, day, ev: null, startIdx: 60, endIdx: 389, orMin: 15, order: { account: 50000, riskMode: 'usd', risk: 250, rr: 2, tpOn: false, pnlView: 'ticks', contracts } });
    r.advanceTo(80);
    return r;
  };
  const one = mk(1), two = mk(2);
  const p1 = one.planFor(1), p2 = two.planFor(1);
  assert.strictEqual(p2.unitQty, p1.unitQty);
  assert.strictEqual(p2.qty, 2 * p1.qty);
  assert.ok(Math.abs(p2.riskUsd - 2 * p1.riskUsd) < 1e-6);
  assert.strictEqual(two.enter(1), null);
  two.advanceTo(389); // runs until stopped or the close
  const t = two.trades[0];
  assert.ok(t, 'trade closed');
  const perContract = (t.exit - t.entry) / (t.entry - t.stop0);
  assert.ok(Math.abs(t.R - 2 * perContract) < 1e-6, `R ${t.R} = 2 × ${perContract}`);
});
