// One rep: replay clock, orders, fills and grading. No DOM; the UI subscribes to changes.
import { idealTrade } from '../core/ideal';
import { nextBarEnd, type TF } from '../core/candles';
import { slippage } from '../core/fills';
import { minutePath, partialBar, TICKS } from '../core/path';
import { gradeDecision, scoreRep, type Parts } from '../core/grading';
import { r2 } from '../core/math';
import type { Day, Eval, Side, Trade } from '../core/types';
import type { SetupDef } from '../setups';

export interface OpenPos {
  side: Side; qty: number; entry: number; stop: number; stop0: number; target: number | null;
  risk: number; // per share at entry
  /** Shares in one contract (the size that risks one R at entry). qty / unitQty = contracts. */
  unitQty: number;
  mfe: number; mae: number; entryIdx: number;
  /** The bar the fill happened in (the forming bar when entered mid-candle). For display. */
  entryBar: number;
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
  /** Size in contracts: one contract risks `risk` at the stop (1R). Starts at 1 every rep. */
  contracts: number;
}
export const DEFAULT_ORDER: OrderSettings = { account: 50000, riskMode: 'usd', risk: 250, rr: 2, tpOn: true, pnlView: 'ticks', contracts: 1 };
/** Most contracts per trade. */
export const MAX_CONTRACTS = 10;

/** Price move per share that equals 1R for a position (1R = one contract's risk at entry). */
export const rPerShare = (p: { risk: number; qty: number; unitQty: number }) => (p.risk * p.unitQty) / p.qty;

/** Minimum distance of the automatic (undragged) stop, as a fraction of price. */
export const AUTO_STOP_MIN = 0.0015;

/** Intraday buying power as a multiple of balance (pattern-day-trader margin). */
export const BUYING_POWER = 4;

/** What the order ticket would send right now. */
export interface Plan {
  side: Side; entry: number; stop: number; target: number | null; qty: number;
  /** Shares in one contract (risks one R); qty = unitQty × contracts unless buying power caps it. */
  unitQty: number;
  riskUsd: number; rewardUsd: number | null; bpUsed: number; error: string | null;
}

export interface RepResult {
  score: number | null; grade: string; correct: boolean | null; verdict: string | null;
  parts?: Parts; notes: string[]; netR: number; netUsd: number;
}

export interface RepInit { setup: string; def: SetupDef | null; day: Day; ev: Eval | null; startIdx: number; endIdx: number; orMin: number; order?: OrderSettings;
  /** Study mode: a valid chart shown fully played out with the ideal trade; no trading, no grade. */
  example?: boolean;
  /** Candle size (minutes) the trader works on; the default stop uses the last 5 such candles. */
  barMin?: number;
  /** Guided tutorial: like an example (no trading) but starts at the beginning and plays forward. */
  tutorial?: boolean }

/** Replay speeds as multiples of real time: 1 = a 1-min candle takes a real minute to form. */
export const SPEEDS = [1, 2, 5, 10, 30, 60, 300];
export const speedLabel = (s: number) => (s === 1 ? '1× real time' : `${s}×`);

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
  readonly example: boolean;
  readonly tutorial: boolean;
  readonly barMin: number;
  /** Playback stops when it reaches this 1-min bar (tutorial steps). */
  pauseAt: number | null = null;
  /** Drop to real-time speed when a trade is opened (so trades are managed live). */
  autoSlow = true;

  order: OrderSettings;
  cur = 0;
  pos: OpenPos | null = null;
  trades: Trade[] = [];
  /** Ticket side and planned bracket. null stop = follow the default (5-bar extreme). */
  orderSide: Side = 1;
  stopPx: number | null = null;
  tgtPx: number | null = null;
  speed = 1;
  /**
   * Progress through the forming 1-min bar cur+1, in ticks (0 = its open … TICKS = its close).
   * -1 = no bar forming (between minutes). Price moves along a simulated path inside each bar.
   */
  sub = -1;
  playing = false;
  done = false;
  result: RepResult | null = null;
  /** Bumps on every change; React uses it to re-render. */
  version = 0;
  /** 1 on first run of this chart; +1 on each restart. */
  attempt = 1;
  /** Bumps on every Restart (the chart re-frames only then). */
  restarts = 0;
  /** Journal entry id of this run, if it was saved (set by the app). */
  journalId: string | null = null;
  /** The first finished run of this chart was saved; restarts are practice and aren't journaled. */
  journaled = false;

  private timer: ReturnType<typeof setInterval> | null = null;
  private paths = new Map<number, number[]>();
  private listeners = new Set<() => void>();
  /** Called once when the rep ends (for history / stats). */
  onEnd?: (r: Replay) => void;

  constructor(init: RepInit) {
    this.setup = init.setup; this.def = init.def; this.day = init.day; this.ev = init.ev;
    this.startIdx = init.startIdx; this.endIdx = init.endIdx; this.orMin = init.orMin;
    this.order = { ...DEFAULT_ORDER, ...init.order };
    this.cur = init.startIdx - 1;
    this.tutorial = !!init.tutorial;
    this.example = !!init.example || this.tutorial;
    this.barMin = init.barMin ?? 1;
    if (this.example && !this.tutorial) { this.cur = this.endIdx; this.done = true; }
  }

  /** The textbook trade for a valid setup: enter on the trigger close, stop at the rule's structural stop, 2R target. */
  get ideal() { return this.ev?.valid ? idealTrade(this.day, this.ev) : null; }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; for (const fn of this.listeners) fn(); }

  /** Simulated tick path of 1-min bar i (cached). */
  path(i: number) {
    let p = this.paths.get(i);
    if (!p) { p = minutePath(this.day, i); this.paths.set(i, p); }
    return p;
  }
  /** The bar currently forming (cur+1) as OHLCV so far, or null between minutes. */
  get forming() { return this.sub >= 0 ? { idx: this.cur + 1, ...partialBar(this.day, this.cur + 1, this.path(this.cur + 1), this.sub) } : null; }
  /** Where the rep stops: the setup window's end, or, while a trade is still open, the market close. */
  get lastIdx() { return this.pos && this.cur >= this.endIdx ? this.day.c.length - 1 : this.endIdx; }
  /** True while the rep has run past its window to let an open trade finish. */
  get overtime() { return !this.done && this.cur >= this.endIdx && !!this.pos; }
  /** Market clock: seconds into the forming minute (0 between minutes). */
  get seconds() { return this.sub >= 0 ? Math.floor((this.sub / TICKS) * 60) : 0; }
  /** Last traded price: the current tick inside a forming bar, else the last close. */
  get last() { return this.sub >= 0 ? this.path(this.cur + 1)[this.sub] : this.day.c[this.cur]; }
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
  /** Lowest low / highest high of the last 5 candles (of `barMin` minutes). */
  get fiveBar() {
    let lo = Infinity, hi = -Infinity;
    for (let i = Math.max(0, this.cur - 5 * this.barMin + 1); i <= this.cur; i++) { lo = Math.min(lo, this.day.l[i]); hi = Math.max(hi, this.day.h[i]); }
    return { lo: r2(lo - 0.01), hi: r2(hi + 0.01) };
  }

  // ---------- Clock ----------
  /**
   * Move the market forward `n` ticks along the simulated path, filling stops/targets on each tick.
   * Stops early at the end of the rep or at `pauseAt`. Returns false once it can't go further.
   */
  private stepTicks(n: number): boolean {
    for (let s = 0; s < n; s++) {
      if (this.done) return false;
      if (this.sub < 0) {
        if (this.cur >= this.lastIdx) { this.end(); return false; }
        this.sub = 0; // the next bar opens
      } else this.sub++;
      const i = this.cur + 1;
      this.checkTick(i, this.sub);
      if (this.sub >= TICKS) {
        this.cur = i; this.sub = -1; // bar complete
        // Past the window, an open trade keeps the rep going until it's stopped, hits its target, or the day ends.
        if (this.cur >= this.lastIdx) { this.end(); return false; }
        if (this.pauseAt != null && this.cur >= this.pauseAt) { this.pauseAt = null; this.pause(); return false; }
      }
    }
    return true;
  }

  /** Jump to the close of 1-min bar `target` (clamped), playing every tick in between for fills. */
  advanceTo(target: number) {
    if (this.done) return;
    if (!this.pos && this.cur >= this.endIdx) { this.end(); return; } // flat again after running past the window
    const to = Math.min(target, this.pos ? this.day.c.length - 1 : this.endIdx);
    while (this.cur < to && this.stepTicks(TICKS + 1 - Math.max(0, this.sub + 1))) { /* bar by bar */ }
    this.emit();
  }
  /** Step one candle of the chart's timeframe. */
  stepBar(tf: TF) { this.advanceTo(nextBarEnd(this.cur, tf, this.pos ? this.day.c.length - 1 : this.endIdx)); }
  stepMinute() { this.advanceTo(this.cur + 1); }

  play() {
    if (this.done || this.playing) return;
    this.playing = true;
    // Market time runs at `speed` × real time: TICKS ticks per market minute.
    let carry = 0, t0 = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now(), dt = Math.min(1, (now - t0) / 1000);
      t0 = now;
      carry += dt * this.speed * (TICKS / 60);
      const n = Math.floor(carry);
      if (!n) return;
      carry -= n;
      this.stepTicks(n);
      this.emit();
    }, 50);
    this.emit();
  }
  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.playing) { this.playing = false; this.emit(); }
  }
  togglePlay() { if (this.playing) this.pause(); else this.play(); }
  setSpeed(s: number) { const was = this.playing; this.pause(); this.speed = s; if (was) this.play(); else this.emit(); }

  /** Contracts for the next order, 1 to MAX_CONTRACTS. */
  get contracts() { return Math.max(1, Math.min(MAX_CONTRACTS, Math.round(this.order.contracts || 1))); }

  /** Same chart from the start: clears trades and the grade. */
  restart() {
    this.pause();
    if (this.done || this.trades.length) this.attempt++;
    this.restarts++;
    this.cur = this.startIdx - 1; this.sub = -1; this.pos = null; this.trades = []; this.stopPx = null; this.tgtPx = null;
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
    let error: string | null = null, qty = 0, unitQty = 0;
    if (perShare <= 0) error = side > 0 ? 'Stop must be below price to buy' : 'Stop must be above price to short';
    else if (perShare < entry * 0.0005) error = 'Stop is too tight';
    else {
      unitQty = Math.floor(riskBudget / perShare);
      qty = Math.min(unitQty * this.contracts, Math.floor((this.balance * BUYING_POWER) / entry));
      if (unitQty < 1 || qty < 1) error = 'Risk is too small for this stop distance';
    }
    return {
      side, entry, stop, target, qty, unitQty, error,
      riskUsd: qty * Math.max(0, perShare),
      rewardUsd: target != null ? qty * side * (target - entry) : null,
      bpUsed: (qty * entry) / (this.balance * BUYING_POWER),
    };
  }

  // ---------- Orders ----------
  /** Check the open position against tick k of bar i. A bar's open (k = 0) can gap through the stop or target. */
  private checkTick(i: number, k: number) {
    const p = this.pos;
    if (!p) return;
    const px = this.path(i)[k], gap = k === 0;
    const move = p.side * (px - p.entry);
    p.mfe = Math.max(p.mfe, move); p.mae = Math.max(p.mae, -move);
    if (p.side * (px - p.stop) <= 0) this.close(gap ? px : p.stop, 'stop', i);
    else if (p.target != null && p.side * (px - p.target) >= 0) this.close(gap ? px : p.target, 'target', i);
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
    if (this.example) return 'This is an example to study. Start a rep from Practice to trade it.';
    if (this.done || this.pos) return null;
    if (side !== this.orderSide) this.selectSide(side);
    const p = this.plan;
    if (p.error) { this.emit(); return p.error; }
    // entryIdx = the last completed bar (grading: entering while the trigger candle is still forming is early).
    this.pos = { side, qty: p.qty, unitQty: p.unitQty, entry: p.entry, stop: p.stop, stop0: p.stop, target: p.target, risk: side * (p.entry - p.stop), mfe: 0, mae: 0, entryIdx: this.cur,
      entryBar: this.sub >= 0 ? this.cur + 1 : this.cur };
    this.stopPx = null; this.tgtPx = null;
    if (this.autoSlow && this.speed > 1) this.setSpeed(1);
    this.emit();
    return null;
  }

  /** Next faster (+1) or slower (-1) speed. */
  nudgeSpeed(d: 1 | -1) {
    const i = SPEEDS.indexOf(this.speed), j = Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + d));
    this.setSpeed(SPEEDS[j]);
  }

  flatten() {
    if (!this.pos) return;
    this.close(r2(this.last - this.pos.side * slippage(this.last)), 'manual', this.sub >= 0 ? this.cur + 1 : this.cur);
    if (this.cur >= this.endIdx) this.end(); // past the window the rep only ran on for this trade
    else this.emit();
  }

  private close(price: number, reason: string, at = this.cur) {
    // R = dollars ÷ one contract's risk at entry: two contracts stopped out = −2R.
    const p = this.pos!, r1 = rPerShare(p);
    this.trades.push({
      side: p.side, qty: p.qty, entry: p.entry, stop0: p.stop0, exit: price, pnl: p.side * (price - p.entry) * p.qty,
      R: (p.side * (price - p.entry)) / r1, mfeR: p.mfe / r1, maeR: Math.min(p.mae / r1, 5),
      entryIdx: p.entryIdx, entryBar: p.entryBar, exitIdx: at, reason,
    });
    this.pos = null; this.stopPx = null; this.tgtPx = null;
  }

  // ---------- End / grading ----------
  end() {
    if (this.done) return;
    this.pause();
    if (this.pos) this.close(this.last, 'end');
    this.sub = -1;
    this.done = true;
    if (this.example) { this.emit(); return; }
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
