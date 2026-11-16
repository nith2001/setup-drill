export type Side = 1 | -1;

/** One regular-session day: 1-minute bars from 09:30 ET. Missing minutes are filled flat with 0 volume. */
export interface Day {
  sym: string;
  date: string; // YYYY-MM-DD
  pc: number | null; // previous close
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  // caches filled lazily by prepDay / indicators
  _cumPV?: Float64Array;
  _cumV?: Float64Array;
  _ind?: Indicators;
}

export interface Dataset {
  meta: { source: string; note?: string; symbols?: string[]; generated?: string; tried?: string[] };
  days: Day[];
}

export interface Indicators {
  e9: number[];
  e20: number[];
  sma50: number[];
  rsi: number[];
  macd: number[];
  sig: number[];
  hist: number[];
}

export interface OHLC { o: number; h: number; l: number; c: number }

export interface Fill { price: number; reason: 'stop' | 'target'; gap?: true }

/** Result of a setup rule on a day. `null` from an evaluator means the day lacks the context. */
interface EvalBase {
  startIdx: number; // first bar shown in the rep
  windowEnd: number; // last bar of the rep (rule deadline + grace)
  why: string; // explanation revealed at the end
  levels: { hi?: number; lo?: number };
}
export interface ValidEval extends EvalBase { valid: true; dir: Side; trigIdx: number; refStop: number }
export interface NoTradeEval extends EvalBase { valid: false }
export type Eval = ValidEval | NoTradeEval;

/** A completed trade in a rep. */
export interface Trade {
  side: Side;
  entry: number;
  stop0: number; // stop at entry time
  exit: number;
  R: number;
  mfeR: number;
  maeR: number;
  entryIdx: number;
  exitIdx: number;
  reason: string;
  qty: number;
  /** Dollar P&L (qty × price move). */
  pnl: number;
}

/** Background data sync status, served by the dev server at /api/status. */
export interface SyncStatus {
  hasKeys: boolean;
  state: 'idle' | 'syncing' | 'done' | 'error';
  days: number; // trading days cached
  target: number;
  message: string;
  version: number; // bumps each time the cache file is rewritten
}
