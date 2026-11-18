// App-wide state: settings, rep history, the loaded dataset and its setup pools.
import { prepDay } from '../core/day';
import { idealTrade } from '../core/ideal';
import { DEFAULT_INDICATORS, presetConfig, type IndicatorConfig, type Preset } from '../core/overlays';
import type { Dataset, Eval } from '../core/types';
import { DEFAULT_ORDER, type OrderSettings } from '../engine/replay';
import { journal } from './journalStore';
import { INDEX_SYMBOLS } from '../core/universe';
import { FREE_PLAY, SETUP_BY_ID, SETUPS, evaluateAll, quietWindow } from '../setups';

/** localStorage JSON wrapper that never throws (private mode, blocked storage). */
export const store = {
  get<T>(k: string, d: T): T {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
  },
  set(k: string, v: unknown) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
  },
};

/**
 * fpStart: 1 = free play starts at a random time (open to 2h before close), 0 = at the open.
 * ruleTf: candle size (minutes) setup rules run on. universe: which symbols reps come from.
 */
export type Universe = 'index' | 'stocks' | 'all';
export interface Settings { orMin: number; blind: number; fpStart: number; ruleTf: number; universe: Universe; autoSlow: number }
export const settings: Settings = Object.assign({ orMin: 15, blind: 1, fpStart: 1, ruleTf: 5, universe: 'all' as Universe, autoSlow: 1 }, store.get<Partial<Settings>>('drill.settings', {}));
// One-time (2026-11-16): the owner asked to practice on SPY/QQQ plus the stocks, so a saved
// "SPY/QQQ only" switches to everything once. Changing it in Settings afterwards sticks.
if (!store.get('drill.universeAll', false)) {
  store.set('drill.universeAll', true);
  if (settings.universe === 'index') { settings.universe = 'all'; store.set('drill.settings', settings); }
}
export const saveSettings = () => store.set('drill.settings', settings);

/** Saved ticket settings. Contracts always start at 1 (sizing up is a per-trade choice). */
export const loadOrder = (): OrderSettings => ({ ...DEFAULT_ORDER, ...store.get<Partial<OrderSettings>>('drill.order', {}), contracts: 1 });
export const saveOrder = (o: OrderSettings) => store.set('drill.order', o);
/** Indicator config for a setup drill (remembered per setup, starting from its preset) or for free play. */
const indKey = (setupId?: string) => (setupId ? `drill.ind2.${setupId}` : 'drill.indicators2');
export function loadIndicators(def?: { id: string; preset: Preset }): IndicatorConfig {
  const base = def ? presetConfig(def.preset) : structuredClone(DEFAULT_INDICATORS);
  return { ...base, ...store.get<Partial<IndicatorConfig>>(indKey(def?.id), {}) };
}
export const saveIndicators = (c: IndicatorConfig, setupId?: string) => store.set(indKey(setupId), c);
export const resetIndicators = (def: { id: string; preset: Preset }) => { store.set(indKey(def.id), null); return presetConfig(def.preset); };


interface PoolEntry { i: number; ev?: Eval }
type Pools = Record<string, { valid: PoolEntry[]; none: PoolEntry[] }>;

export const app: { data: Dataset; pools: Pools; free: PoolEntry[] } = { data: { meta: { source: '' }, days: [] }, pools: {}, free: [] };

const isIndex = (sym: string) => INDEX_SYMBOLS.includes(sym);
/** Days in the chosen universe exist in this dataset? (Falls back to everything if not.) */
export const universeAvailable = (u: Universe) => u === 'all' || app.data.days.some((d) => isIndex(d.sym) === (u === 'index'));

/**
 * Load a dataset and index every valid / no-trade event of each setup, on `settings.ruleTf`-minute
 * candles, for days in the chosen universe. Re-run when those settings change.
 */
export function setData(ds: Dataset) {
  app.data = ds;
  app.free = [];
  app.pools = Object.fromEntries(SETUPS.map((s) => [s.id, { valid: [], none: [] }]));
  const u = universeAvailable(settings.universe) ? settings.universe : 'all';
  const opts = { orMin: settings.orMin, barMin: settings.ruleTf };
  ds.days.forEach((d, i) => {
    if (d.c.length < 200 || (u !== 'all' && isIndex(d.sym) !== (u === 'index'))) return;
    prepDay(d);
    app.free.push({ i });
    for (const s of SETUPS) for (const ev of evaluateAll(s.id, d, opts)) app.pools[s.id][ev.valid ? 'valid' : 'none'].push({ i, ev });
  });
}

export const poolSize = (id: string) => (id === FREE_PLAY.id ? app.free.length : (app.pools[id]?.valid.length ?? 0) + (app.pools[id]?.none.length ?? 0));

/** Share of no-trade picks that are quiet charts (the setup never starts) rather than near-misses. */
export const QUIET_SHARE = 1 / 3;

/** A quiet chart for a setup on a random day it has charts on, or undefined if none turns up. */
function pickQuiet(id: string): PoolEntry | undefined {
  const P = app.pools[id], days = [...new Set([...P.valid, ...P.none].map((p) => p.i))];
  for (let t = 0; t < 30 && days.length; t++) {
    const i = days[Math.floor(Math.random() * days.length)];
    const ev = quietWindow(id, app.data.days[i], { orMin: settings.orMin, barMin: settings.ruleTf });
    if (ev) return { i, ev };
  }
  return undefined;
}

/**
 * 50/50 valid vs no-trade for setups, avoiding days seen in the last 60 reps. A third of the no-trade half are
 * quiet charts where the setup never even starts.
 */
export function pickDay(id: string): PoolEntry | undefined {
  let pool: PoolEntry[];
  if (id === FREE_PLAY.id || !SETUP_BY_ID[id]) pool = app.free;
  else {
    const P = app.pools[id];
    pool = (Math.random() < 0.5 && P.valid.length) || !P.none.length ? P.valid : P.none;
    if (pool === P.none && Math.random() < QUIET_SHARE) { const q = pickQuiet(id); if (q) return q; }
  }
  // Avoid charts from recent reps (same day and same setup event).
  const key = (sym: string, date: string, start: number | string) => `${sym}|${date}|${start}`;
  const recent = new Set(journal.entries.slice(-60).map((x) => key(x.sym, x.date, x.start ?? '')));
  const fresh = pool.filter((p) => !recent.has(key(app.data.days[p.i].sym, app.data.days[p.i].date, p.ev?.startIdx ?? '')));
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(Math.random() * list.length)];
}

/** What an example shows: a valid setup that won, a valid setup that lost, or a no-trade chart. */
export type ExampleKind = 'win' | 'loss' | 'none';

/**
 * A chart for example mode. Valid: prefer ones where the textbook trade hit its target within 90 minutes.
 * No-trade: any chart where the pattern started but failed a condition (a fakeout).
 */
export function pickExample(id: string, kind: ExampleKind = 'win'): PoolEntry | undefined {
  if (kind === 'none') { const none = app.pools[id]?.none ?? []; return none[Math.floor(Math.random() * none.length)]; }
  const pool = app.pools[id]?.valid ?? [];
  const outcome = (p: PoolEntry) => (p.ev?.valid ? idealTrade(app.data.days[p.i], p.ev) : null);
  const good = pool.filter((p) => {
    const t = outcome(p);
    return !!t && (kind === 'loss' ? t.outcome === 'stop' : t.outcome === 'target');
  });
  // Winners that resolve within 90 minutes make tighter lessons; fall back to slower ones when there are few.
  const quick = kind === 'win' ? good.filter((p) => p.ev?.valid && outcome(p)!.exitIdx - p.ev.trigIdx <= 90) : good;
  const list = quick.length >= 8 ? quick : good.length ? good : pool;
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- Toasts ----------
const toastListeners = new Set<(msg: string) => void>();
export const onToast = (fn: (msg: string) => void) => { toastListeners.add(fn); return () => { toastListeners.delete(fn); }; };
export const toast = (msg: string) => { for (const fn of toastListeners) fn(msg); };

export const fmtR = (r: number) => (r >= 0 ? '+' : '') + r.toFixed(2) + 'R';
export const cls = (r: number) => (r > 0 ? 'up' : r < 0 ? 'down' : '');
