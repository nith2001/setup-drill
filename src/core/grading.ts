import { hhmm } from './day';
import { idealTrade } from './ideal';
import { clamp } from './math';
import type { Day, Eval, Side, Trade } from './types';

/** score parts: name -> [points, max] */
export type Parts = Record<string, [number, number]>;

export interface DecisionGrade { score: number; correct: boolean; verdict: string; parts: Parts; notes: string[] }

type GradedTrade = Pick<Trade, 'entryIdx' | 'stop0'> & { side: Side };

/**
 * Setup drills: was it right to take / not take, and was the take executed per the rule?
 * Outcome (P&L) is deliberately not part of this score.
 */
export function gradeDecision(ev: Eval, trades: GradedTrade[], day: Day): DecisionGrade {
  const notes: string[] = [];
  if (!ev.valid) {
    if (!trades.length) return { score: 100, correct: true, verdict: 'Correct pass', parts: { Decision: [100, 100] }, notes: ['No valid setup on this chart. Sitting out was right.'] };
    const s = Math.max(0, 20 - 10 * (trades.length - 1));
    notes.push(`There was no valid setup, but you took ${trades.length} trade${trades.length > 1 ? 's' : ''}.`);
    return { score: s, correct: false, verdict: 'Forced trade', parts: { Decision: [s, 100] }, notes };
  }
  // Candles: the rule may run on 5-min candles. Indices are 1-min; "3 bars" means 3 rule candles.
  const { dir, trigIdx } = ev, bm = ev.barMin ?? 1, lim = 3 * bm;
  const barsLate = (idx: number) => Math.ceil((idx - trigIdx) / bm);
  const good = trades.find((t) => t.side === dir && t.entryIdx >= trigIdx && t.entryIdx <= trigIdx + lim);
  const others = trades.filter((t) => t !== good);
  const early = others.filter((t) => t.entryIdx < trigIdx).length;
  const wrongDir = others.filter((t) => t.side !== dir && t.entryIdx >= trigIdx).length;
  const late = others.find((t) => t.side === dir && t.entryIdx > trigIdx + lim);
  let decision = 0, timing = 0, stop = 0, correct = false, verdict: string;
  if (good) {
    decision = 50; correct = true; verdict = 'Good take';
    timing = 15 - 5 * barsLate(good.entryIdx);
    let trigExt = dir > 0 ? Infinity : -Infinity; // the trigger candle's low (long) / high (short)
    for (let i = Math.max(0, trigIdx - bm + 1); i <= trigIdx; i++) trigExt = dir > 0 ? Math.min(trigExt, day.l[i]) : Math.max(trigExt, day.h[i]);
    const buf = day.c[trigIdx] * 0.0005;
    const beyondTrig = dir > 0 ? good.stop0 <= trigExt + buf : good.stop0 >= trigExt - buf;
    const notTooWide = dir > 0 ? good.stop0 >= ev.refStop - buf : good.stop0 <= ev.refStop + buf;
    if (beyondTrig && notTooWide) { stop = 20; notes.push('Stop placed per the rule.'); }
    else if (!beyondTrig) { stop = 5; notes.push(`Stop was inside the trigger candle (needed ${dir > 0 ? '≤' : '≥'} ${trigExt.toFixed(2)}).`); }
    else { stop = 10; notes.push(`Stop was wider than the rule allows (limit ${ev.refStop.toFixed(2)}).`); }
    const lateBy = barsLate(good.entryIdx);
    if (lateBy > 0) notes.push(`Entered ${lateBy} candle${lateBy > 1 ? 's' : ''} after the trigger.`);
  } else if (late) {
    decision = 15; verdict = 'Chased';
    notes.push(`Right idea, but you entered ${barsLate(late.entryIdx)} candles after the trigger (limit 3).`);
  } else {
    verdict = 'Missed setup';
    notes.push("A valid setup triggered and you didn't take it.");
  }
  // Valid setups lose too. Say so, so a correct loss never feels like a mistake.
  const x = idealTrade(day, ev);
  if (x.outcome === 'stop') {
    if (good) notes.push(`This one lost: the textbook trade was stopped out at ${hhmm(x.exitIdx)}. That's fine. It was a valid setup and you took it the right way. Valid setups still lose; the edge comes from taking every one with the same risk. You're graded on the decision, not the result.`);
    else notes.push(`The textbook trade would have been stopped out at ${hhmm(x.exitIdx)} this time, but it was still a valid setup. You can't know which ones lose in advance, so the right call is to take them all.`);
  }
  const chased = good ? undefined : late; // a chased entry is already penalized above, not as an extra trade
  const extra = others.filter((t) => t !== chased).length;
  const discipline = Math.max(0, 15 - 8 * (early + wrongDir) - 4 * Math.max(0, extra - early - wrongDir));
  if (early) notes.push(`${early} trade${early > 1 ? 's' : ''} taken before the setup triggered.`);
  if (wrongDir) notes.push(`${wrongDir} trade${wrongDir > 1 ? 's' : ''} against the setup's direction.`);
  const score = clamp(Math.round(decision + timing + stop + discipline), 0, 100);
  return { score, correct, verdict, parts: { Decision: [decision, 50], Timing: [timing, 15], Stop: [stop, 20], Discipline: [discipline, 15] }, notes };
}

type ScoredTrade = Pick<Trade, 'R' | 'mfeR' | 'maeR' | 'entryIdx' | 'exitIdx'>;

export interface FreePlayScore {
  passed: boolean;
  score: number | null;
  netR: number;
  parts?: { result: number; capture: number; heat: number; discipline: number };
  captureAvg?: number | null;
  heatAvg?: number | null;
  notes?: string[];
}

/** Free play: scored on P&L in R, capture of the available move, heat taken, and discipline. */
export function scoreRep(trades: ScoredTrade[]): FreePlayScore {
  if (!trades.length) return { passed: true, score: null, netR: 0 };
  const netR = trades.reduce((a, t) => a + t.R, 0);
  const result = clamp(25 + 12.5 * netR, 0, 50);

  const capt = trades.filter((t) => t.mfeR >= 0.5);
  let captureAvg: number | null = null, capture = 10;
  if (capt.length) {
    captureAvg = capt.reduce((a, t) => a + (t.R > 0 ? clamp(t.R / t.mfeR, 0, 1) : 0), 0) / capt.length;
    capture = 20 * captureAvg;
  }
  const winners = trades.filter((t) => t.R > 0);
  let heatAvg: number | null = null, heat = 7.5;
  if (winners.length) {
    heatAvg = winners.reduce((a, t) => a + (1 - Math.min(1, t.maeR)), 0) / winners.length;
    heat = 15 * heatAvg;
  }
  let discipline = 15;
  const notes: string[] = [];
  if (trades.length > 2) { const p = Math.min(10, (trades.length - 2) * 4); discipline -= p; notes.push(`${trades.length} trades (−${p}): overtrading`); }
  let revenge = 0;
  for (let i = 1; i < trades.length; i++) {
    const p = trades[i - 1];
    if (p.R < 0 && trades[i].entryIdx - p.exitIdx <= 3) revenge++;
  }
  if (revenge) { const p = Math.min(10, revenge * 5); discipline -= p; notes.push(`${revenge} quick re-entr${revenge > 1 ? 'ies' : 'y'} after a loss (−${p})`); }
  discipline = clamp(discipline, 0, 15);
  const score = Math.round(result + capture + heat + discipline);
  return { passed: false, score, netR, parts: { result, capture, heat, discipline }, captureAvg, heatAvg, notes };
}
