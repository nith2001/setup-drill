import assert from 'node:assert';
import { test } from 'vitest';
import { etMin, toDay, weekdays, type AlpacaBar } from '../src/data/alpaca';

test('etMin: 14:30Z in winter (EST) is 09:30 ET = minute 0; summer uses EDT', () => {
  assert.strictEqual(etMin('2025-03-04T14:30:00Z'), 0);
  assert.strictEqual(etMin('2025-07-01T13:31:00Z'), 1);
});

test('toDay: keeps regular session only and fills missing minutes flat with 0 volume', () => {
  const bars: AlpacaBar[] = [];
  bars.push({ t: '2025-03-04T14:29:00Z', o: 1, h: 1, l: 1, c: 1, v: 5 }); // premarket, dropped
  for (let m = 0; m < 200; m++) {
    if (m === 50) continue; // gap
    const t = new Date(Date.UTC(2025, 2, 4, 14, 30 + m)).toISOString();
    bars.push({ t, o: 100 + m, h: 101 + m, l: 99 + m, c: 100.5 + m, v: 1000 });
  }
  const d = toDay('X', '2025-03-04', bars, 99)!;
  assert.strictEqual(d.c.length, 200);
  assert.strictEqual(d.o[0], 100);
  assert.strictEqual(d.v[50], 0);
  assert.strictEqual(d.c[50], d.c[49]);
  assert.strictEqual(d.pc, 99);
  assert.strictEqual(toDay('X', '2025-03-04', bars.slice(0, 100), 99), null, 'too few bars');
});

test('weekdays: skips weekends', () => {
  assert.deepStrictEqual(weekdays(new Date('2025-03-07'), new Date('2025-03-11')), ['2025-03-07', '2025-03-10']);
});
