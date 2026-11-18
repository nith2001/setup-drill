import assert from 'node:assert';
import { test } from 'vitest';
import { aggregate } from '../src/core/day';
import { genDataset } from '../src/core/demo';
import { evalBar, simulateTrade } from '../src/core/fills';
import { gradeDecision, scoreRep } from '../src/core/grading';
import { emaArr, rsiArr, smaArr } from '../src/core/indicators';
import type { Day, Eval, OHLC, ValidEval } from '../src/core/types';
import { evaluate, evaluateAll, SETUPS } from '../src/setups';

const bar = (o: number, h: number, l: number, c: number): OHLC => ({ o, h, l, c });

test('evalBar long: stop, target, gap, and both-hit => stop first', () => {
  const pos = { side: 1 as const, stop: 99, target: 102 };
  assert.strictEqual(evalBar(pos, bar(100, 101, 99.5, 100.5)), null);
  assert.deepStrictEqual(evalBar(pos, bar(100, 101, 98.9, 99.5)), { price: 99, reason: 'stop' });
  assert.deepStrictEqual(evalBar(pos, bar(100, 102.5, 99.5, 102)), { price: 102, reason: 'target' });
  assert.strictEqual(evalBar(pos, bar(100, 103, 98, 101))!.reason, 'stop');
  assert.deepStrictEqual(evalBar(pos, bar(98, 99, 97, 98)), { price: 98, reason: 'stop', gap: true });
  assert.deepStrictEqual(evalBar(pos, bar(103, 104, 102.5, 103)), { price: 103, reason: 'target', gap: true });
});

test('evalBar short mirrors long', () => {
  const pos = { side: -1 as const, stop: 101, target: 98 };
  assert.strictEqual(evalBar(pos, bar(100, 100.5, 99.5, 100)), null);
  assert.deepStrictEqual(evalBar(pos, bar(100, 101.2, 99.5, 100)), { price: 101, reason: 'stop' });
  assert.deepStrictEqual(evalBar(pos, bar(100, 100.5, 97.5, 98)), { price: 98, reason: 'target' });
  assert.strictEqual(evalBar(pos, bar(100, 102, 97, 99))!.reason, 'stop');
});

function mkDay(closes: number[], date = '2025-03-04'): Day {
  const o = closes.map((c, i) => (i ? closes[i - 1] : c));
  const h = closes.map((c, i) => Math.max(c, o[i]) + 0.05);
  const l = closes.map((c, i) => Math.min(c, o[i]) - 0.05);
  return { sym: 'T', date, pc: closes[0], o, h, l, c: closes, v: closes.map(() => 1000) };
}

test('simulateTrade: long hits 2R target', () => {
  const closes = Array(20).fill(100).concat([100.5, 101, 101.5, 102, 102.5, 103, 103.5, 104]);
  const r = simulateTrade(mkDay(closes), 1, 20, 100.5, 99.5, 2, 20)!;
  assert.ok(Math.abs(r.R - 2) < 1e-9, 'R=' + r.R);
  assert.strictEqual(r.reason, 'target');
});

test('simulateTrade: eod exit when nothing hit', () => {
  const r = simulateTrade(mkDay(Array(40).fill(100)), 1, 10, 100, 90, 2, 10)!;
  assert.strictEqual(r.reason, 'eod');
  assert.ok(Math.abs(r.R) < 1e-9);
});

function orbDay(breakVol: number) {
  // 15-bar opening range 99.45..100.55, 10 quiet bars, a breakout close at 25 on the chosen volume, a push up,
  // a pullback to the range high (retest at 32), a bullish engulfing candle at 33 (the trigger), then drift up.
  const closes: number[] = [];
  for (let i = 0; i < 15; i++) closes.push(100 + (i % 2 ? 0.5 : -0.5));
  for (let i = 0; i < 10; i++) closes.push(100);
  closes.push(101.5, 101.8, 102.2, 102.4, 102.3, 101.6, 101.0, 100.7, 101.2);
  for (let i = 0; i < 200; i++) closes.push(101.2 + i * 0.02);
  const d = mkDay(closes);
  d.v = closes.map((_, i) => (i < 15 ? 3000 : 1000));
  d.v[25] = breakVol;
  return d;
}

test('ORB retest: breakout on volume, retest of the range high, engulfing trigger; weak breakout = no trade', () => {
  const ok = evaluate('orb', orbDay(2000), { orMin: 15 }) as ValidEval;
  assert.strictEqual(ok.valid, true, ok.why);
  assert.strictEqual(ok.dir, 1);
  assert.strictEqual(ok.trigIdx, 33);
  assert.match(ok.why, /bullish engulfing/);
  assert.deepStrictEqual(ok.marks!.map((m) => m.text), ['range set', 'breakout', 'retest']);
  const weak = evaluate('orb', orbDay(1100), { orMin: 15 })!;
  assert.strictEqual(weak.valid, false);
  assert.match(weak.why, /1\.\d× volume/);
});

test('triggerCandle: engulfing and hammer, both directions', async () => {
  const { triggerCandle } = await import('../src/setups/util');
  const d = (o: number[], h: number[], l: number[], c: number[]) => ({ o, h, l, c }) as never;
  assert.strictEqual(triggerCandle(d([101, 100.5], [101.1, 101.6], [100.4, 100.4], [100.5, 101.5]), 1, 1), 'bullish engulfing');
  assert.strictEqual(triggerCandle(d([100, 101], [100.6, 101.1], [99.9, 99.9], [100.5, 99.8]), 1, -1), 'bearish engulfing');
  assert.strictEqual(triggerCandle(d([100, 100], [100.2, 100.25], [99.8, 99.0], [100, 100.2]), 1, 1), 'hammer');
  assert.strictEqual(triggerCandle(d([100, 100], [100.2, 101.0], [99.8, 99.75], [100, 99.8]), 1, -1), 'shooting star');
  assert.strictEqual(triggerCandle(d([100, 100], [100.2, 100.6], [99.8, 99.9], [100, 100.5]), 1, 1), null, 'a plain green candle is not a trigger');
});

test('gradeDecision: pass/force on no-trade days; take/miss/chase on valid days', () => {
  const day = orbDay(2000), ev = evaluate('orb', day, { orMin: 15 }) as Eval;
  const noEv = evaluate('orb', orbDay(1100), { orMin: 15 }) as Eval;
  assert.strictEqual(gradeDecision(noEv, [], day).score, 100);
  const forced = gradeDecision(noEv, [{ side: 1, entryIdx: 33, stop0: 100 }], day);
  assert.strictEqual(forced.correct, false);
  assert.ok(forced.score <= 20);
  // perfect take: on the trigger bar, stop just below the retest low
  const take = gradeDecision(ev, [{ side: 1, entryIdx: 33, stop0: 100.6 }], day);
  assert.strictEqual(take.correct, true);
  assert.strictEqual(take.score, 100);
  const tooTight = gradeDecision(ev, [{ side: 1, entryIdx: 33, stop0: 101.0 }], day);
  assert.ok(tooTight.score < 100 && tooTight.correct);
  const missed = gradeDecision(ev, [], day);
  assert.strictEqual(missed.verdict, 'Missed setup');
  assert.ok(missed.score <= 15);
  const chased = gradeDecision(ev, [{ side: 1, entryIdx: 40, stop0: 100.6 }], day);
  assert.strictEqual(chased.verdict, 'Chased');
  assert.strictEqual(chased.parts.Discipline[0], 15, 'a chased entry is not also an extra trade');
  const takePlusLate = gradeDecision(ev, [{ side: 1, entryIdx: 33, stop0: 100.6 }, { side: 1, entryIdx: 48, stop0: 101 }], day);
  assert.strictEqual(takePlusLate.parts.Discipline[0], 11, 'an extra late trade after a good take costs discipline');
  const wrongWay = gradeDecision(ev, [{ side: -1, entryIdx: 34, stop0: 102 }], day);
  assert.strictEqual(wrongWay.correct, false);
  for (const g of [forced, take, tooTight, missed, chased, wrongWay]) assert.ok(g.score >= 0 && g.score <= 100);
});

test('scoreRep: pass, strong trade, and revenge/overtrading penalties', () => {
  assert.strictEqual(scoreRep([]).passed, true);
  const good = scoreRep([{ R: 2, mfeR: 2.2, maeR: 0.2, entryIdx: 10, exitIdx: 40 }]);
  assert.ok(good.score! >= 85, 'good ' + good.score);
  const bad = scoreRep([
    { R: -1, mfeR: 0.1, maeR: 1, entryIdx: 10, exitIdx: 15 },
    { R: -1, mfeR: 0.1, maeR: 1, entryIdx: 17, exitIdx: 22 },
    { R: -1, mfeR: 0.1, maeR: 1, entryIdx: 24, exitIdx: 30 },
  ]);
  assert.ok(bad.score! < 30, 'bad ' + bad.score);
  assert.ok(bad.notes!.length >= 1);
  assert.ok(good.score! <= 100 && bad.score! >= 0);
});

test('aggregate: 5m buckets and partial last bucket', () => {
  const d = mkDay(Array.from({ length: 12 }, (_, i) => 100 + i));
  const agg = aggregate(d, 7, 5); // bars 0..7 -> buckets [0-4],[5-7]
  assert.strictEqual(agg.length, 2);
  assert.strictEqual(agg[0].open, d.o[0]);
  assert.strictEqual(agg[0].close, d.c[4]);
  assert.strictEqual(agg[1].close, d.c[7]);
  assert.strictEqual(agg[1].time - agg[0].time, 300);
  assert.strictEqual(agg[0].time, Date.UTC(2025, 2, 4, 9, 30) / 1000);
});

test('indicator math: EMA/SMA/RSI sanity', () => {
  const c = Array.from({ length: 60 }, (_, i) => 100 + i);
  const sma = smaArr(c, 5);
  assert.ok(Number.isNaN(sma[3]));
  assert.strictEqual(sma[4], 102);
  assert.ok(Math.abs(emaArr(Array(30).fill(50), 9)[29] - 50) < 1e-9);
  assert.strictEqual(rsiArr(c, 14)[59], 100);
  const r = rsiArr(Array.from({ length: 60 }, (_, i) => 100 + (i % 2)), 14)[59];
  assert.ok(r > 40 && r < 60, 'rsi ' + r);
});

test('synthetic dataset is sane', () => {
  const ds = genDataset(7, '2025-06-30', 60);
  assert.strictEqual(ds.days.length, 6 * 60);
  for (const d of ds.days) {
    assert.strictEqual(d.c.length, 390);
    for (let i = 0; i < 390; i++) {
      assert.ok(d.h[i] >= Math.max(d.o[i], d.c[i]) - 1e-9);
      assert.ok(d.l[i] <= Math.min(d.o[i], d.c[i]) + 1e-9);
      assert.ok(d.l[i] > 0);
    }
  }
});

// Runs for every registered setup, so a new setup gets these checks for free.
const demo = genDataset(11, '2025-06-30', 60);
for (const s of SETUPS) for (const barMin of [1, 5]) {
  test(`${s.id} (${barMin}-min): demo data yields valid and no-trade charts with consistent windows`, () => {
    let valid = 0, noTrade = 0;
    for (const d of demo.days) {
      let prevEnd = -1;
      for (const e of evaluateAll(s.id, d, { orMin: 15, barMin })) {
        if (e.valid) valid++; else noTrade++;
        assert.ok(e.startIdx >= 5 && e.windowEnd > e.startIdx && e.windowEnd < d.c.length, 'window');
        assert.ok(e.startIdx > prevEnd, 'events on one day do not overlap');
        prevEnd = e.windowEnd;
        if (e.valid) {
          assert.ok(e.trigIdx >= e.startIdx && e.trigIdx < e.windowEnd, 'trigger inside window');
          // The trigger candle spans barMin minutes ending at trigIdx; refStop must be at or beyond its extreme.
          const lo = Math.min(...d.l.slice(e.trigIdx - barMin + 1, e.trigIdx + 1)), hi = Math.max(...d.h.slice(e.trigIdx - barMin + 1, e.trigIdx + 1));
          assert.ok(e.dir > 0 ? e.refStop <= lo + 1e-9 : e.refStop >= hi - 1e-9, 'refStop beyond trigger candle');
        }
      }
    }
    // ORB retest happens at most once a day and needs breakout + retest + trigger, so it's rare (≈1.4% of real days).
    assert.ok(valid >= (s.id === 'orb' ? 1 : 3) && noTrade >= 3, `valid=${valid} noTrade=${noTrade}`);
  });
}

test('every setup has a complete lesson', async () => {
  const { LESSONS } = await import('../src/setups/lessons');
  for (const s of SETUPS) {
    const l = LESSONS[s.id];
    assert.ok(l, `${s.id} has a lesson`);
    assert.ok(l.idea && l.look.length && l.entry && l.stop && l.target && l.manage && l.mistakes.length, `${s.id} lesson complete`);
  }
});

test('restartDupes: keeps the first run of each chart, drops later restarts', async () => {
  const { restartDupes } = await import('../src/core/journal');
  const e = (id: string, ts: number, attempt: number, extra = {}) => ({ id, ts, attempt, setup: 'ema', sym: 'NFLX', date: '2024-08-27', start: 40, ...extra }) as never;
  assert.deepStrictEqual(restartDupes([e('a', 1, 1), e('b', 2, 2), e('c', 3, 3), e('d', 4, 2, { sym: 'SPY' }), e('f', 5, 1)]), ['b', 'c']);
});

test('biasOf: month and week must agree; no history = no bias', async () => {
  const { biasOf } = await import('../src/core/bias');
  const mk = (closes: number[]) => ({ ctx: { pdh: 0, pdl: 0, pdc: 0, sma50: null, sma200: null, closes } }) as never;
  const up = Array.from({ length: 21 }, (_, i) => 100 + i);
  assert.strictEqual(biasOf(mk(up))!.dir, 1);
  assert.strictEqual(biasOf(mk(up.map((x) => 200 - x)))!.dir, -1);
  const mixed = [...up.slice(0, 16), 115, 114.5, 114, 113.5, 113]; // month up, last week down
  const b = biasOf(mk(mixed))!;
  assert.strictEqual(b.month, 1); assert.strictEqual(b.week, -1); assert.strictEqual(b.dir, 0);
  assert.strictEqual(biasOf(mk(up.slice(0, 10))), null);
});

test('biasOf (4-hour week + older levels): trend, rejection at a tested level, sideways', async () => {
  const { biasOf, biasAllows } = await import('../src/core/bias');
  // 60 flat-ish daily candles with two older highs near 110 (resistance) and lows near 90.
  const N = 60, d: string[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [];
  for (let i = 0; i < N; i++) {
    d.push(`2024-01-${String(i + 1).padStart(2, '0')}`);
    const top = i === 10 || i === 25 ? 110 : 102, bot = i === 15 || i === 30 ? 90 : 98;
    o.push(100); h.push(top); l.push(bot); c.push(100);
  }
  const daily = { d, o, h, l, c };
  const mk = (hh: number[], ll: number[], cc: number[]) => ({ ctx: { pdh: 0, pdl: 0, pdc: 0, sma50: null, sma200: null, daily, h4: { o: cc, h: hh, l: ll, c: cc } } }) as never;
  const rise = (a: number) => Array.from({ length: 10 }, (_, i) => a + i);
  // Steady climb, nowhere near the older levels: long.
  const up = biasOf(mk(rise(70).map((x) => x + 1), rise(70).map((x) => x - 1), rise(70)))!;
  assert.strictEqual(up.dir, 1); assert.strictEqual(up.kind, 'up');
  assert.ok(biasAllows(up, 1) && !biasAllows(up, -1));
  // Climb into 110, then close well back below it: rejected, short.
  const hh = [...rise(100).slice(0, 8), 110.5, 107], ll = hh.map((x) => x - 2), cc = [...rise(100).slice(0, 8), 108, 105];
  const rej = biasOf(mk(hh, ll, cc))!;
  assert.strictEqual(rej.dir, -1); assert.ok(rej.level && rej.level.side === 'resistance');
  // Inside week (lower high, higher low): sideways, range setups trade both ways, trend setups pass.
  const side = biasOf(mk([71, 73, 72, 73, 72, 71, 72, 71, 72, 71], [67, 66, 67, 66, 67, 68, 67, 68, 67, 68], Array(10).fill(70)))!;
  assert.strictEqual(side.kind, 'range');
  assert.ok(biasAllows(side, 1, 'strict', 'range') && biasAllows(side, -1, 'strict', 'range'));
  assert.ok(!biasAllows(side, 1) && !biasAllows(side, -1));
});
