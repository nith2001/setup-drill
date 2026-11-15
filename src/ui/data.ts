// Talks to the dev server (server/dataSync.ts): dataset, sync status, per-rep history.
import { EMPTY_HISTORY, historyFromDays, type History } from '../core/candles';
import { DEMO_SOURCE } from '../core/demo';
import type { Dataset, Day, SyncStatus } from '../core/types';

export async function fetchStatus(): Promise<SyncStatus | null> {
  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    return r.ok ? ((await r.json()) as SyncStatus) : null;
  } catch { return null; }
}

export async function fetchDataset(): Promise<Dataset | null> {
  try {
    const r = await fetch('/api/data', { cache: 'no-store' });
    return r.ok ? ((await r.json()) as Dataset) : null;
  } catch { return null; }
}

/** Bars before the rep day, for higher timeframes. Demo data builds it from the dataset itself. */
export async function fetchHistory(ds: Dataset, day: Day): Promise<History> {
  if (ds.meta.source === DEMO_SOURCE) return historyFromDays(ds.days, day.sym, day.date);
  try {
    const r = await fetch(`/api/history?sym=${encodeURIComponent(day.sym)}&date=${day.date}`);
    return r.ok ? ((await r.json()) as History) : EMPTY_HISTORY;
  } catch { return EMPTY_HISTORY; }
}

/**
 * Poll sync status while a sync runs. Calls onStatus on every tick and onNewData when the
 * server saved a new batch. Stops once the sync is done or failed.
 */
export function watchSync(initial: SyncStatus, onStatus: (s: SyncStatus) => void, onNewData: () => Promise<boolean>) {
  let seen = initial.version;
  const tick = async () => {
    const s = await fetchStatus();
    if (!s) return setTimeout(tick, 5000);
    onStatus(s);
    // onNewData returns false if it couldn't apply the data right now (e.g. mid-rep); retry next tick
    if (s.version !== seen && (await onNewData())) seen = s.version;
    if (s.state === 'syncing' || s.version !== seen) setTimeout(tick, 3000);
  };
  setTimeout(tick, 1500);
}
