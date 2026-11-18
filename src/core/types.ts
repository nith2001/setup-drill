export type Side = 1 | -1;

/** One regular-session day: 1-minute bars from 09:30 ET. Missing minutes are filled flat with 0 volume. */
export interface Day {
  sym: string;
  date: string; // YYYY-MM-DD
  pc: number | null; // previous close
  /** Daily context from sessions before this date (filled by the data sync). */
  ctx?: DayCtx;
  /** Set on aggregated series (see barsOf): minutes per bar, and closes before the session for indicator warmup. */
  barMin?: number;
  warm?: number[];
  _tf?: Record<number, Day>;
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

/** Prior day high/low/close and daily SMAs of closes before this date. No lookahead. */
export interface DayCtx {
  pdh: number; pdl: number; pdc: number; sma50: number | null; sma200: number | null;
  /** Prior session's 5-min closes (for indicator warmup on 5-min rules). */
  prev5?: number[];
  /** Daily closes of the last 21 sessions before this date, oldest first (higher-timeframe bias). */
  closes?: number[];
  /** Average volume of each 5-min slot of the session (78, from 09:30) over the prior 20 sessions (time-of-day RVOL). */
  vol5?: number[];
  /** The last 7 sessions as 4-hour candles (09:30–13:30, 13:30–16:00), oldest first (week bias). */
  h4?: Ohlc;
  /** The last 60 sessions' daily candles, oldest first (older support / resistance for the bias). */
  daily?: Ohlc & { d: string[] };
}

/** Compact candles: parallel arrays. */
export interface Ohlc { o: number[]; h: number[]; l: number[]; c: number[] }

export interface Dataset {
  meta: { source: string; note?: string; symbols?: string[]; generated?: string; tried?: string[]; triedIndex?: string[] };
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
  /** Minutes per candle the rule was evaluated on (1 or 5). Indices are always 1-min. */
  barMin?: number;
  levels: { hi?: number; lo?: number };
  /** Teaching annotations shown after the rep: labelled swing points and the levels the rule used. */
  marks?: { idx: number; text: string; above?: boolean }[];
  /** `idx`: the bar from which the level is known (tutorials draw it from then on). */
  lines?: { price: number; text: string; idx?: number }[];
}
export interface ValidEval extends EvalBase {
  valid: true; dir: Side; trigIdx: number; refStop: number;
  /** Where a trader would take profit and why (structure or measured move). Absent = fixed 2R. */
  target?: { price: number; why: string };
}
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
  /** Bar the entry filled in (may be the forming bar after entryIdx). Display only. */
  entryBar?: number;
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
