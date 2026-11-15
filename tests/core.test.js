const test = require('node:test');
const assert = require('node:assert');
const Core = require('../src/core.js');

const bar = (o, h, l, c) => ({ o, h, l, c });

test('evalBar long: stop, target, gap, and both-hit => stop first', () => {
  const pos = { side: 1, entry: 100, stop: 99, target: 102 };
  assert.strictEqual(Core.evalBar(pos, bar(100, 101, 99.5, 100.5)), null);
  assert.deepStrictEqual(Core.evalBar(pos, bar(100, 101, 98.9, 99.5)), { price: 99, reason: 'stop' });
  assert.deepStrictEqual(Core.evalBar(pos, bar(100, 102.5, 99.5, 102)), { price: 102, reason: 'target' });
  const both = Core.evalBar(pos, bar(100, 103, 98, 101));
  assert.strictEqual(both.reason, 'stop');
  const gapDown = Core.evalBar(pos, bar(98, 99, 97, 98));
  assert.deepStrictEqual(gapDown, { price: 98, reason: 'stop', gap: true });
  const gapUp = Core.evalBar(pos, bar(103, 104, 102.5, 103));
  assert.deepStrictEqual(gapUp, { price: 103, reason: 'target', gap: true });
});

test('evalBar short mirrors long', () => {
  const pos = { side: -1, entry: 100, stop: 101, target: 98 };
  assert.strictEqual(Core.evalBar(pos, bar(100, 100.5, 99.5, 100)), null);
  assert.deepStrictEqual(Core.evalBar(pos, bar(100, 101.2, 99.5, 100)), { price: 101, reason: 'stop' });
  assert.deepStrictEqual(Core.evalBar(pos, bar(100, 100.5, 97.5, 98)), { price: 98, reason: 'target' });
  assert.strictEqual(Core.evalBar(pos, bar(100, 102, 97, 99)).reason, 'stop');
});

function mkDay(closes, date = '2025-03-04') {
  const n = closes.length;
  const o = closes.map((c, i) => (i ? closes[i - 1] : c));
  const h = closes.map((c, i) => Math.max(c, o[i]) + 0.05);
  const l = closes.map((c, i) => Math.min(c, o[i]) - 0.05);
  return { sym: 'T', date, pc: closes[0], o, h, l, c: closes, v: closes.map(() => 1000) };
}

test('simulateTrade: long hits 2R target', () => {
  // flat then rally
  const closes = Array(20).fill(100).concat([100.5, 101, 101.5, 102, 102.5, 103, 103.5, 104]);
  const d = mkDay(closes);
  const r = Core.simulateTrade(d, 1, 20, 100.5, 99.5, 2, 20);
  assert.ok(Math.abs(r.R - 2) < 1e-9, 'R=' + r.R);
  assert.strictEqual(r.reason, 'target');
});

test('simulateTrade: eod exit when nothing hit', () => {
  const closes = Array(40).fill(100);
  const d = mkDay(closes);
  const r = Core.simulateTrade(d, 1, 10, 100, 90, 2, 10);
  assert.strictEqual(r.reason, 'eod');
  assert.ok(Math.abs(r.R) < 1e-9);
});

function orbDay(breakVol) {
  // 15-bar range 99.4..100.6 (high volume), 10 quiet bars inside, then a close above on chosen volume, then drift up
  const closes = [];
  for (let i = 0; i < 15; i++) closes.push(100 + (i % 2 ? 0.5 : -0.5));
  for (let i = 0; i < 10; i++) closes.push(100);
  closes.push(101.5);
  for (let i = 0; i < 140; i++) closes.push(101.5 + i * 0.02);
  const d = mkDay(closes);
  d.v = closes.map((_, i) => (i < 15 ? 3000 : 1000));
  d.v[25] = breakVol;
  return d;
}

test('ORB rule: break on volume is valid, break without volume is a no-trade day', () => {
  const ok = Core.evaluate('orb', orbDay(2000), { orMin: 15 });
  assert.strictEqual(ok.valid, true);
  assert.strictEqual(ok.dir, 1);
  assert.strictEqual(ok.trigIdx, 25);
  assert.strictEqual(ok.startIdx, 15);
  const weak = Core.evaluate('orb', orbDay(1100), { orMin: 15 });
  assert.strictEqual(weak.valid, false);
  assert.match(weak.why, /1\.\d× volume/);
});

test('gradeDecision: pass/force on no-trade days; take/miss/chase on valid days', () => {
  const day = orbDay(2000), ev = Core.evaluate('orb', day, { orMin: 15 });
  const noEv = Core.evaluate('orb', orbDay(1100), { orMin: 15 });
  assert.strictEqual(Core.gradeDecision(noEv, [], day).score, 100);
  const forced = Core.gradeDecision(noEv, [{ side: 1, entryIdx: 25, stop0: 99 }], day);
  assert.strictEqual(forced.correct, false);
  assert.ok(forced.score <= 20);
  // perfect take: on the trigger bar, stop below trigger low and above OR low
  const take = Core.gradeDecision(ev, [{ side: 1, entryIdx: 25, stop0: 99.9 }], day);
  assert.strictEqual(take.correct, true);
  assert.strictEqual(take.score, 100);
  // a losing perfect trade is graded identically: outcome isn't scored
  const takeLoss = Core.gradeDecision(ev, [{ side: 1, entryIdx: 25, stop0: 99.9, R: -1 }], day);
  assert.strictEqual(takeLoss.score, 100);
  const tooTight = Core.gradeDecision(ev, [{ side: 1, entryIdx: 25, stop0: 101.4 }], day);
  assert.ok(tooTight.score < 100 && tooTight.correct);
  const missed = Core.gradeDecision(ev, [], day);
  assert.strictEqual(missed.verdict, 'Missed setup');
  assert.ok(missed.score <= 15);
  const chased = Core.gradeDecision(ev, [{ side: 1, entryIdx: 32, stop0: 100 }], day);
  assert.strictEqual(chased.verdict, 'Chased');
  const wrongWay = Core.gradeDecision(ev, [{ side: -1, entryIdx: 26, stop0: 102 }], day);
  assert.strictEqual(wrongWay.correct, false);
  for (const g of [forced, take, tooTight, missed, chased, wrongWay]) assert.ok(g.score >= 0 && g.score <= 100);
});

test('scoreRep: pass, strong trade, and revenge/overtrading penalties', () => {
  assert.strictEqual(Core.scoreRep([]).passed, true);
  const good = Core.scoreRep([{ R: 2, mfeR: 2.2, maeR: 0.2, entryIdx: 10, exitIdx: 40 }]);
  assert.ok(good.score >= 85, 'good ' + good.score);
  const bad = Core.scoreRep([
    { R: -1, mfeR: 0.1, maeR: 1, entryIdx: 10, exitIdx: 15 },
    { R: -1, mfeR: 0.1, maeR: 1, entryIdx: 17, exitIdx: 22 },
    { R: -1, mfeR: 0.1, maeR: 1, entryIdx: 24, exitIdx: 30 },
  ]);
  assert.ok(bad.score < 30, 'bad ' + bad.score);
  assert.ok(bad.notes.length >= 1);
  assert.ok(good.score <= 100 && bad.score >= 0);
});

test('aggregate: 5m buckets and partial last bucket', () => {
  const closes = Array.from({ length: 12 }, (_, i) => 100 + i);
  const d = mkDay(closes);
  const agg = Core.aggregate(d, 7, 5); // bars 0..7 -> buckets [0-4],[5-7]
  assert.strictEqual(agg.length, 2);
  assert.strictEqual(agg[0].open, d.o[0]);
  assert.strictEqual(agg[0].close, d.c[4]);
  assert.strictEqual(agg[1].close, d.c[7]);
  assert.strictEqual(agg[1].time - agg[0].time, 300);
  assert.strictEqual(agg[0].time, Date.UTC(2025, 2, 4, 9, 30) / 1000);
});

test('synthetic dataset is sane and produces setups', () => {
  const ds = Core.genDataset(7, '2025-06-30', 60);
  assert.strictEqual(ds.days.length, 6 * 60);
  for (const d of ds.days) {
    assert.strictEqual(d.c.length, 390);
    for (let i = 0; i < 390; i++) {
      assert.ok(d.h[i] >= Math.max(d.o[i], d.c[i]) - 1e-9);
      assert.ok(d.l[i] <= Math.min(d.o[i], d.c[i]) + 1e-9);
      assert.ok(d.l[i] > 0);
    }
  }
  const counts = {};
  for (const k of ['orb', 'gap', 'vwap']) {
    counts[k] = { valid: 0, noTrade: 0 };
    for (const d of ds.days) { const e = Core.evaluate(k, d, { orMin: 15 }); if (e) counts[k][e.valid ? 'valid' : 'noTrade']++; }
  }
  console.log('valid / no-trade days in 360 synthetic days:', JSON.stringify(counts));
  for (const k of Object.keys(counts)) assert.ok(counts[k].valid >= 5 && counts[k].noTrade >= 5, k);
});

test('indicator math: EMA/SMA/RSI sanity', () => {
  const c = Array.from({ length: 60 }, (_, i) => 100 + i);
  const sma = Core.smaArr(c, 5);
  assert.ok(Number.isNaN(sma[3]));
  assert.strictEqual(sma[4], 102);
  const ema = Core.emaArr(Array(30).fill(50), 9);
  assert.ok(Math.abs(ema[29] - 50) < 1e-9);
  const rsiUp = Core.rsiArr(c, 14);
  assert.strictEqual(rsiUp[59], 100);
  const zig = Array.from({ length: 60 }, (_, i) => 100 + (i % 2));
  const r = Core.rsiArr(zig, 14)[59];
  assert.ok(r > 40 && r < 60, 'rsi ' + r);
});

test('indicator setups produce both valid and no-trade charts on demo data', () => {
  const ds = Core.genDataset(11, '2025-06-30', 60);
  const counts = {};
  for (const k of ['ema', 'macd', 'rsi']) {
    counts[k] = { valid: 0, noTrade: 0 };
    for (const d of ds.days) {
      const e = Core.evaluate(k, d);
      if (!e) continue;
      counts[k][e.valid ? 'valid' : 'noTrade']++;
      assert.ok(e.startIdx >= 20 && e.windowEnd > e.startIdx && e.windowEnd < d.c.length);
      if (e.valid) {
        assert.ok(e.trigIdx >= e.startIdx && e.trigIdx < e.windowEnd);
        assert.ok(e.dir > 0 ? e.refStop <= d.l[e.trigIdx] : e.refStop >= d.h[e.trigIdx], k + ' refStop beyond trigger');
      }
    }
  }
  console.log('indicator setups:', JSON.stringify(counts));
  for (const k of Object.keys(counts)) assert.ok(counts[k].valid >= 10 && counts[k].noTrade >= 10, k);
});
