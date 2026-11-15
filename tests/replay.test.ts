import assert from 'node:assert';
import { test } from 'vitest';
import { buildCandles, historyFromDays, nextBarEnd } from '../src/core/candles';
import { genDataset } from '../src/core/demo';
import { applyPreset, DEFAULT_INDICATORS, vwapSeries } from '../src/core/overlays';
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
  assert.strictEqual(buildCandles(1, hist, day, upto).length, 60);
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

test('applyPreset switches on what a drill needs without losing user MAs', () => {
  const c = applyPreset(DEFAULT_INDICATORS, { mas: [{ type: 'ema', period: 9 }, { type: 'sma', period: 13 }], rsi: true, vwap: false });
  assert.ok(c.mas.find((m) => m.id === 'ema9')!.on);
  assert.ok(c.mas.some((m) => m.type === 'sma' && m.period === 13 && m.on));
  assert.strictEqual(c.mas.length, DEFAULT_INDICATORS.mas.length + 1);
  assert.ok(c.rsi.on && !c.vwap);
  assert.ok(!DEFAULT_INDICATORS.mas[0].on, 'defaults not mutated');
});

function mkRep() {
  return new Replay({ setup: 'random', def: null, day, ev: null, startIdx: 20, endIdx: 200, orMin: 15 });
}

test('Replay: stop required, entry, stop-out, and restart clears everything', () => {
  const r = mkRep();
  r.advanceTo(30);
  assert.match(r.enter(1)!, /stop first/);
  assert.match(r.setStop(r.last + 1) ?? r.enter(1)!, /below price/);
  r.setStop(r.last * 0.995);
  assert.strictEqual(r.enter(1), null);
  assert.ok(r.pos);
  // walk until the position closes or the window ends
  r.advanceTo(199);
  assert.ok(r.trades.length === 1 || r.pos, 'trade closed or still open');
  r.end();
  assert.ok(r.done && r.result);
  r.restart();
  assert.strictEqual(r.cur, 19);
  assert.ok(!r.done && !r.result && !r.pos && r.trades.length === 0 && r.stopPx == null);
});

test('Replay: stepBar on 5m lands on candle boundaries; end at endIdx grades', () => {
  const r = mkRep();
  r.stepBar(5); assert.strictEqual(r.cur, 24);
  r.stepBar(5); assert.strictEqual(r.cur, 29);
  r.stepBar('D');
  assert.strictEqual(r.cur, 200);
  assert.ok(r.done && r.result);
});
