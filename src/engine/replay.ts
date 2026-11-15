// One rep: replay clock, orders, fills and grading. No DOM; the UI subscribes to changes.
import { nextBarEnd, type TF } from '../core/candles';
import { evalBar, slippage } from '../core/fills';
import { gradeDecision, scoreRep, type Parts } from '../core/grading';
import { r2 } from '../core/math';
import type { Day, Eval, Side, Trade } from '../core/types';
import type { SetupDef } from '../setups';

export interface OpenPos { side: Side; entry: number; stop: number; stop0: number; target: number | null; risk: number; mfe: number; mae: number; entryIdx: number }

export interface RepResult { score: number | null; grade: string; correct: boolean | null; verdict: string | null; parts?: Parts; notes: string[]; netR: number }

export interface RepInit { setup: string; def: SetupDef | null; day: Day; ev: Eval | null; startIdx: number; endIdx: number; orMin: number }

/** Replay speeds in minutes of market time per second. */
export const SPEEDS = [1, 2, 5, 10, 30, 60];

let nextId = 1;

export class Replay {
  readonly id = nextId++;
  readonly setup: string;
  readonly def: SetupDef | null;
  readonly day: Day;
  readonly ev: Eval | null;
  readonly startIdx: number;
  readonly endIdx: number;
  private readonly orMin: number;

  cur = 0;
  pos: OpenPos | null = null;
  trades: Trade[] = [];
  stopPx: number | null = null;
  tgtR = 2;
  speed = 2;
  playing = false;
  done = false;
  result: RepResult | null = null;
  /** Bumps on every change; React uses it to re-render. */
  version = 0;

  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  /** Called once when the rep ends (for history / stats). */
  onEnd?: (r: Replay) => void;

  constructor(init: RepInit) {
    this.setup = init.setup; this.def = init.def; this.day = init.day; this.ev = init.ev;
    this.startIdx = init.startIdx; this.endIdx = init.endIdx; this.orMin = init.orMin;
    this.cur = init.startIdx - 1;
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; for (const fn of this.listeners) fn(); }

  get last() { return this.day.c[this.cur]; }
  get netR() { return this.trades.reduce((a, t) => a + t.R, 0); }
  get indicatorDrill() { return !!this.def?.preset; }
  /** Opening range, once complete (not on indicator drills). */
  get openingRange() {
    if (this.indicatorDrill || this.cur < this.orMin - 1) return null;
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < this.orMin; i++) { hi = Math.max(hi, this.day.h[i]); lo = Math.min(lo, this.day.l[i]); }
    return { hi, lo, minutes: this.orMin };
  }

  // ---------- Clock ----------
  /** Advance to 1-min bar `target` (clamped), filling stops/targets minute by minute. */
  advanceTo(target: number) {
    if (this.done) return;
    const to = Math.min(target, this.endIdx);
    while (this.cur < to) {
      this.cur++;
      this.checkFill();
    }
    if (this.cur >= this.endIdx) this.end();
    else this.emit();
  }
  /** Step one candle of the chart's timeframe. */
  stepBar(tf: TF) { this.advanceTo(nextBarEnd(this.cur, tf, this.endIdx)); }
  stepMinute() { this.advanceTo(this.cur + 1); }

  play() {
    if (this.done || this.playing) return;
    this.playing = true;
    const tps = Math.min(this.speed, 20), per = this.speed / tps; // ticks/sec, minutes/tick
    let carry = 0;
    this.timer = setInterval(() => { carry += per; const n = Math.floor(carry); carry -= n; if (n) this.advanceTo(this.cur + n); }, 1000 / tps);
    this.emit();
  }
  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.playing) { this.playing = false; this.emit(); }
  }
  togglePlay() { if (this.playing) this.pause(); else this.play(); }
  setSpeed(s: number) { const was = this.playing; this.pause(); this.speed = s; if (was) this.play(); else this.emit(); }
  setTargetR(r: number) { this.tgtR = r; this.emit(); }

  /** Same chart from the start: clears trades and the grade. */
  restart() {
    this.pause();
    this.cur = this.startIdx - 1; this.pos = null; this.trades = []; this.stopPx = null;
    this.done = false; this.result = null;
    this.emit();
  }

  dispose() { this.pause(); this.listeners.clear(); }

  // ---------- Orders ----------
  private checkFill() {
    const p = this.pos;
    if (!p) return;
    const d = this.day, i = this.cur, b = { o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i] };
    const res = evalBar(p, b);
    const fav = p.side > 0 ? b.h - p.entry : p.entry - b.l, adv = p.side > 0 ? p.entry - b.l : b.h - p.entry;
    if (res) {
      if (res.reason === 'target') { p.mfe = Math.max(p.mfe, p.side * (res.price - p.entry)); p.mae = Math.max(p.mae, adv); }
      else p.mae = Math.max(p.mae, p.side * (p.entry - res.price));
      this.close(res.price, res.reason);
    } else { p.mfe = Math.max(p.mfe, fav); p.mae = Math.max(p.mae, adv); }
  }

  /** Set the planned stop (flat) or move the live stop. Returns an error message or null. */
  setStop(px: number): string | null {
    if (this.done || !isFinite(px)) return null;
    px = r2(px);
    if (this.pos) {
      if (this.pos.side * (this.last - px) <= 0) return 'Stop would be on the wrong side of price';
      this.pos.stop = px;
    } else this.stopPx = px;
    this.emit();
    return null;
  }

  /** Market order with the planned stop and target. Returns an error message or null. */
  enter(side: Side): string | null {
    if (this.done || this.pos) return null;
    if (this.stopPx == null) return 'Place a stop first: click the chart';
    const px = this.last, entry = r2(px + side * slippage(px)), risk = side * (entry - this.stopPx);
    if (risk <= 0) return side > 0 ? 'Stop must be below price to buy' : 'Stop must be above price to short';
    if (risk < entry * 0.0005) return 'Stop is too tight';
    const target = this.tgtR ? r2(entry + side * risk * this.tgtR) : null;
    this.pos = { side, entry, stop: this.stopPx, stop0: this.stopPx, target, risk, mfe: 0, mae: 0, entryIdx: this.cur };
    this.emit();
    return null;
  }

  flatten() { if (this.pos) { this.close(r2(this.last - this.pos.side * slippage(this.last)), 'manual'); this.emit(); } }

  private close(price: number, reason: string) {
    const p = this.pos!;
    this.trades.push({ side: p.side, entry: p.entry, stop0: p.stop0, exit: price, R: (p.side * (price - p.entry)) / p.risk, mfeR: p.mfe / p.risk, maeR: Math.min(p.mae / p.risk, 5), entryIdx: p.entryIdx, exitIdx: this.cur, reason });
    this.pos = null; this.stopPx = null;
  }

  // ---------- End / grading ----------
  end() {
    if (this.done) return;
    this.pause();
    if (this.pos) this.close(this.last, 'end');
    this.done = true;
    this.result = this.grade();
    this.onEnd?.(this);
    this.emit();
  }

  private grade(): RepResult {
    const sc = scoreRep(this.trades), ev = this.ev;
    if (ev) {
      const g = gradeDecision(ev, this.trades, this.day);
      const notes = [`<b>${ev.valid ? 'Valid setup' : 'No valid setup'}:</b> ${ev.why}`, ...g.notes];
      if (this.trades.length) notes.push(`Outcome (not graded): <b class="${sc.netR > 0 ? 'up' : sc.netR < 0 ? 'down' : ''}">${(sc.netR >= 0 ? '+' : '') + sc.netR.toFixed(2)}R</b>. A good decision can lose and a bad one can win.`);
      return { score: g.score, grade: g.verdict, correct: g.correct, verdict: g.verdict, parts: g.parts, notes, netR: sc.netR };
    }
    const notes = [...(sc.notes ?? [])];
    if (sc.captureAvg != null && this.trades.some((t) => t.R > 0)) notes.push(`You kept ${Math.round(sc.captureAvg * 100)}% of the best move available while you were in.`);
    const s = sc.score;
    return {
      score: s, correct: null, verdict: null, notes, netR: sc.netR,
      grade: s == null ? 'No trades' : s >= 85 ? 'Excellent' : s >= 70 ? 'Solid' : s >= 50 ? 'Okay' : 'Rough',
      parts: sc.parts && { Result: [sc.parts.result, 50], Capture: [sc.parts.capture, 20], 'Heat taken': [sc.parts.heat, 15], Discipline: [sc.parts.discipline, 15] },
    };
  }
}
