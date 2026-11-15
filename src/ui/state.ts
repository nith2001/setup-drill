// App-wide state: settings, rep history, the loaded dataset and its setup pools.
import { prepDay } from '../core/day';
import { DEFAULT_INDICATORS, type IndicatorConfig } from '../core/overlays';
import type { Dataset, Eval } from '../core/types';
import { FREE_PLAY, SETUP_BY_ID, SETUPS, evaluate } from '../setups';

/** localStorage JSON wrapper that never throws (private mode, blocked storage). */
export const store = {
  get<T>(k: string, d: T): T {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
  },
  set(k: string, v: unknown) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
  },
};

export interface Settings { orMin: number; repMin: number; blind: number }
export const settings: Settings = Object.assign({ orMin: 15, repMin: 120, blind: 1 }, store.get<Partial<Settings>>('drill.settings', {}));
export const saveSettings = () => store.set('drill.settings', settings);

export const loadIndicators = (): IndicatorConfig => ({ ...structuredClone(DEFAULT_INDICATORS), ...store.get<Partial<IndicatorConfig>>('drill.indicators', {}) });
export const saveIndicators = (c: IndicatorConfig) => store.set('drill.indicators', c);

export interface HistoryEntry {
  setup: string; sym: string; date: string; trades: number; netR: number;
  score: number | null; verdict: string | null; correct: boolean | null; ts: number;
}
export const history: HistoryEntry[] = store.get<HistoryEntry[]>('drill.history', []);
export function addHistory(h: HistoryEntry) { history.push(h); store.set('drill.history', history); }

interface PoolEntry { i: number; ev?: Eval }
type Pools = Record<string, { valid: PoolEntry[]; none: PoolEntry[] }>;

export const app: { data: Dataset; pools: Pools; free: PoolEntry[] } = { data: { meta: { source: '' }, days: [] }, pools: {}, free: [] };

/** Load a dataset and index which days are valid / no-trade charts for each setup. */
export function setData(ds: Dataset) {
  app.data = ds;
  app.free = [];
  app.pools = Object.fromEntries(SETUPS.map((s) => [s.id, { valid: [], none: [] }]));
  ds.days.forEach((d, i) => {
    if (d.c.length < 200) return;
    prepDay(d);
    app.free.push({ i });
    for (const s of SETUPS) {
      const ev = evaluate(s.id, d, settings);
      if (ev) app.pools[s.id][ev.valid ? 'valid' : 'none'].push({ i, ev });
    }
  });
}

export const poolSize = (id: string) => (id === FREE_PLAY.id ? app.free.length : app.pools[id].valid.length + app.pools[id].none.length);

/** 50/50 valid vs no-trade for setups, avoiding days seen in the last 60 reps. */
export function pickDay(id: string): PoolEntry | undefined {
  let pool: PoolEntry[];
  if (id === FREE_PLAY.id || !SETUP_BY_ID[id]) pool = app.free;
  else {
    const P = app.pools[id];
    pool = (Math.random() < 0.5 && P.valid.length) || !P.none.length ? P.valid : P.none;
  }
  const recent = new Set(history.slice(-60).map((x) => x.sym + x.date));
  const fresh = pool.filter((p) => !recent.has(app.data.days[p.i].sym + app.data.days[p.i].date));
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- Toasts ----------
const toastListeners = new Set<(msg: string) => void>();
export const onToast = (fn: (msg: string) => void) => { toastListeners.add(fn); return () => { toastListeners.delete(fn); }; };
export const toast = (msg: string) => { for (const fn of toastListeners) fn(msg); };

export const fmtR = (r: number) => (r >= 0 ? '+' : '') + r.toFixed(2) + 'R';
export const cls = (r: number) => (r > 0 ? 'up' : r < 0 ? 'down' : '');
