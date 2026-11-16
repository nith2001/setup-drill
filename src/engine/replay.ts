// One rep: replay clock, orders, fills and grading. No DOM; the UI subscribes to changes.
import { nextBarEnd, type TF } from '../core/candles';
import { evalBar, slippage } from '../core/fills';
import { gradeDecision, scoreRep, type Parts } from '../core/grading';
import { r2 } from '../core/math';
import type { Day, Eval, Side, Trade } from '../core/types';
import type { SetupDef } from '../setups';

export interface OpenPos {
  side: Side; qty: number; entry: number; stop: number; stop0: number; target: number | null;
  risk: number; // per share at entry
  mfe: number; mae: number; entryIdx: number;
}

/** Order-ticket settings (persisted by the UI). */
export interface OrderSettings {
  account: number; // starting balance
  riskMode: 'usd' | 'pct';
  risk: number; // $ or % of balance
  rr: number; // reward:risk for the take-profit
  tpOn: boolean;
  /** How live P&L is displayed while in a trade (UI only). */
  pnlView: 'ticks' | 'usd' | 'r';
}
export const DEFAULT_ORDER: OrderSettings = { account: 50000, riskMode: 'usd', risk: 250, rr: 2, tpOn: true, pnlView: 'ticks' };

/** Minimum distance of the automatic (undragged) stop, as a fraction of price. */
export const AUTO_STOP_MIN = 0.0015;

/** Intraday buying power as a multiple of balance (pattern-day-trader margin). */
export const BUYING_POWER = 4;

/** What the order ticket would send right now. */
export interface Plan {
  side: Side; entry: number; stop: number; target: number | null; qty: number;
  riskUsd: number; rewardUsd: number | null; bpUsed: number; error: string | null;
}

export interface RepResult {
  score: number | null; grade: string; correct: boolean | null; verdict: string | null;
  parts?: Parts; notes: string[]; netR: number; netUsd: number;
}

export interface RepInit { setup: string; def: SetupDef | null; day: Day; ev: Eval | null; startIdx: number; endIdx: number; orMin: number; order?: OrderSettings }

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

  order: OrderSettings;
  cur = 0;
  pos: OpenPos | null = null;
  trades: Trade[] = [];
  /** Ticket side and planned bracket. null stop = follow the default (5-bar extreme). */
  orderSide: Side = 1;
  stopPx: number | null = null;
  tgtPx: number | null = null;
  speed = 2;
  playing = false;
  done = false;
  result: RepResult | null = null;
  /** Bumps on every change; React uses it to re-render. */
  version = 0;
  /** 1 on first run of this chart; +1 on each restart. */
  attempt = 1;
  /** Journal entry id of the last finished run (set by the app). */
  journalId: string | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  /** Called once when the rep ends (for history / stats). */
  onEnd?: (r: Replay) => void;

  constructor(init: RepInit) {
    this.setup = init.setup; this.def = init.def; this.day = init.day; this.ev = init.ev;
    this.startIdx = init.startIdx; this.endIdx = init.endIdx; this.orMin = init.orMin;
    this.order = { ...DEFAULT_ORDER, ...init.order };
    this.cur = init.startIdx - 1;
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; for (const fn of this.listeners) fn(); }

  get last() { return this.day.c[this.cur]; }
  get netR() { return this.trades.reduce((a, t) => a + t.R, 0); }
  get realized() { return this.trades.reduce((a, t) => a + t.pnl, 0); }
  get openPnl() { return this.pos ? this.pos.side * (this.last - this.pos.entry) * this.pos.qty : 0; }
  get balance() { return this.order.account + this.realized; }
  get equity() { return this.balance + this.openPnl; }
  get indicatorDrill() { return this.def?.group === 'Indicators'; }
  /** Opening range, once complete (not on indicator drills). */
  get openingRange() {
    if (this.cur < this.orMin - 1) return null;
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < this.orMin; i++) { hi = Math.max(hi, this.day.h[i]); lo = Math.min(lo, this.day.l[i]); }
    return { hi, lo, minutes: this.orMin };
  }
  /** Lowest low / highest high of the last 5 one-minute bars. */
  get fiveBar() {
    let lo = Infinity, hi = -Infinity;
    for (let i = Math.max(0, this.cur - 4); i <= this.cur; i++) { lo = Math.min(lo, this.day.l[i]); hi = Math.max(hi, this.day.h[i]); }
    return { lo: r2(lo - 0.01), hi: r2(hi + 0.01) };
  }

  // ---------- Clock ----------
  /** Advance to 1-min bar `target` (clamped), filling stops/targets minute by minute. */
  advanceTo(target: number) {
    if (this.done) return;
    const to = Math.min(target, this.endIdx);
    while (this.cur < to) { this.cur++; this.checkFill(); }
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

  /** Same chart from the start: clears trades and the grade. */
  restart() {
    this.pause();
    if (this.done || this.trades.length) this.attempt++;
    this.cur = this.startIdx - 1; this.pos = null; this.trades = []; this.stopPx = null; this.tgtPx = null;
    this.done = false; this.result = null; this.journalId = null;
    this.emit();
  }

  dispose() { this.pause(); this.listeners.clear(); }

  // ---------- Ticket ----------
  setOrder(patch: Partial<OrderSettings>) {
    this.order = { ...this.order, ...patch };
    if (patch.rr != null || patch.tpOn != null) this.tgtPx = null; // R:R edits reset a dragged target
    this.emit();
  }

  selectSide(side: Side) {
    if (this.orderSide === side) return;
    this.orderSide = side;
    if (this.stopPx != null && side * (this.last - this.stopPx) <= 0) this.stopPx = null;
    this.tgtPx = null;
    this.emit();
  }

  /** The order the ticket would send now, including size and any validation error. */
  get plan(): Plan { return this.planFor(this.orderSide); }

  /** Order for a given side using the ticket settings (planned stop/target only apply to the ticket's side). */
  planFor(side: Side): Plan {
    const own = side === this.orderSide;
    const px = this.last, entry = r2(px + side * slippage(px));
    // Default stop: beyond the 5-bar extreme, but never closer than AUTO_STOP_MIN (a starting point to drag).
    const minGap = entry * AUTO_STOP_MIN;
    const stop = (own ? this.stopPx : null) ?? (side > 0 ? r2(Math.min(this.fiveBar.lo, entry - minGap)) : r2(Math.max(this.fiveBar.hi, entry + minGap)));
    const perShare = side * (entry - stop);
    const target = !this.order.tpOn ? null : (own ? this.tgtPx : null) ?? (perShare > 0 ? r2(entry + side * perShare * this.order.rr) : null);
    const riskBudget = this.order.riskMode === 'usd' ? this.order.risk : (this.balance * this.order.risk) / 100;
    let error: string | null = null, qty = 0;
    if (perShare <= 0) error = side > 0 ? 'Stop must be below price to buy' : 'Stop must be above price to short';
    else if (perShare < entry * 0.0005) error = 'Stop is too tight';
    else {
      qty = Math.min(Math.floor(riskBudget / perShare), Math.floor((this.balance * BUYING_POWER) / entry));
      if (qty < 1) error = 'Risk is too small for this stop distance';
    }
    return {
      side, entry, stop, target, qty, error,
      riskUsd: qty * Math.max(0, perShare),
      rewardUsd: target != null ? qty * side * (target - entry) : null,
      bpUsed: (qty * entry) / (this.balance * BUYING_POWER),
    };
  }

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

  /** Planned stop (flat) or live stop (in a trade). Returns an error message or null. */
  setStop(px: number): string | null {
    if (this.done || !isFinite(px)) return null;
    px = r2(px);
    if (this.pos) {
      if (this.pos.side * (this.last - px) <= 0) return 'Stop would be on the wrong side of price';
      this.pos.stop = px;
    } else {
      if (this.orderSide * (this.last - px) <= 0) return this.orderSide > 0 ? 'A buy needs its stop below price' : 'A short needs its stop above price';
      this.stopPx = px;
    }
    this.emit();
    return null;
  }

  /** Planned or live take-profit. null removes it. Returns an error message or null. */
  setTarget(px: number | null): string | null {
    if (this.done) return null;
    if (px != null) {
      px = r2(px);
      const side = this.pos?.side ?? this.orderSide;
      if (side * (px - this.last) <= 0) return 'Take-profit must be on the profit side of price';
    }
    if (this.pos) this.pos.target = px;
    else { this.tgtPx = px; if (px != null && !this.order.tpOn) this.order = { ...this.order, tpOn: true }; }
    this.emit();
    return null;
  }

  breakeven(): string | null { return this.pos ? this.setStop(this.pos.entry) : null; }

  /** Market order using the ticket. Returns an error message or null. */
  enter(side: Side = this.orderSide): string | null {
    if (this.done || this.pos) return null;
    if (side !== this.orderSide) this.selectSide(side);
    const p = this.plan;
    if (p.error) { this.emit(); return p.error; }
    this.pos = { side, qty: p.qty, entry: p.entry, stop: p.stop, stop0: p.stop, target: p.target, risk: side * (p.entry - p.stop), mfe: 0, mae: 0, entryIdx: this.cur };
    this.stopPx = null; this.tgtPx = null;
    this.emit();
    return null;
  }

  flatten() { if (this.pos) { this.close(r2(this.last - this.pos.side * slippage(this.last)), 'manual'); this.emit(); } }

  private close(price: number, reason: string) {
    const p = this.pos!;
    this.trades.push({
      side: p.side, qty: p.qty, entry: p.entry, stop0: p.stop0, exit: price, pnl: p.side * (price - p.entry) * p.qty,
      R: (p.side * (price - p.entry)) / p.risk, mfeR: p.mfe / p.risk, maeR: Math.min(p.mae / p.risk, 5),
      entryIdx: p.entryIdx, exitIdx: this.cur, reason,
    });
    this.pos = null; this.stopPx = null; this.tgtPx = null;
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
    const sc = scoreRep(this.trades), ev = this.ev, netUsd = this.realized;
    const usd = `${netUsd >= 0 ? '+' : '−'}$${Math.abs(netUsd).toFixed(2)}`;
    if (ev) {
      const g = gradeDecision(ev, this.trades, this.day);
      const notes = [`<b>${ev.valid ? 'Valid setup' : 'No valid setup'}:</b> ${ev.why}`, ...g.notes];
      if (this.trades.length) notes.push(`Outcome (not graded): <b class="${sc.netR > 0 ? 'up' : sc.netR < 0 ? 'down' : ''}">${(sc.netR >= 0 ? '+' : '') + sc.netR.toFixed(2)}R (${usd})</b>. A good decision can lose and a bad one can win.`);
      return { score: g.score, grade: g.verdict, correct: g.correct, verdict: g.verdict, parts: g.parts, notes, netR: sc.netR, netUsd };
    }
    const notes = [...(sc.notes ?? [])];
    if (sc.captureAvg != null && this.trades.some((t) => t.R > 0)) notes.push(`You kept ${Math.round(sc.captureAvg * 100)}% of the best move available while you were in.`);
    const s = sc.score;
    return {
      score: s, correct: null, verdict: null, notes, netR: sc.netR, netUsd,
      grade: s == null ? 'No trades' : s >= 85 ? 'Excellent' : s >= 70 ? 'Solid' : s >= 50 ? 'Okay' : 'Rough',
      parts: sc.parts && { Result: [sc.parts.result, 50], Capture: [sc.parts.capture, 20], 'Heat taken': [sc.parts.heat, 15], Discipline: [sc.parts.discipline, 15] },
    };
  }
}
