// Vite plugin: on dev-server start, sync real Alpaca data into a local cache file in the
// background, and serve it to the app. The browser never talks to Alpaca or sees the keys.
//   GET /api/status -> SyncStatus
//   GET /api/data   -> Dataset JSON (404 until the first batch is saved)
//   GET /api/history?sym=AAPL&date=2025-03-04 -> History before that date (fetched once, then cached)
import fs from 'node:fs';
import path from 'node:path';
import type { Connect, Logger, Plugin } from 'vite';
import { AlpacaError, createClient, dailyCloses, fetchDate, fetchHistory, weekdays } from '../src/data/alpaca';
import type { Dataset, SyncStatus } from '../src/core/types';

export interface SyncOptions {
  key?: string;
  secret?: string;
  symbols: string[];
  /** Target number of trading days to have cached. */
  days: number;
  /** Sample dates from the last N years. */
  years: number;
  file: string;
}

const SAVE_EVERY = 10; // dates

// Survives Vite's in-process restarts (e.g. when .env changes) so we never run two syncs.
const G = globalThis as unknown as { __drillSync?: { status: SyncStatus; running: Promise<void> | null } };
const shared = (G.__drillSync ??= {
  status: { hasKeys: false, state: 'idle', days: 0, target: 0, message: '', version: 0 },
  running: null,
});

function readCache(file: string): Dataset | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Dataset; } catch { return null; }
}
function writeCache(file: string, ds: Dataset) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ds));
  fs.renameSync(tmp, file);
}

async function sync(o: SyncOptions & { key: string; secret: string }, log: Logger) {
  const st = shared.status;
  const sameSyms = (a: string[] = [], b: string[]) => a.join(',') === b.join(',');
  let ds = readCache(o.file);
  if (!ds || !sameSyms(ds.meta.symbols, o.symbols)) {
    ds = { meta: { source: 'alpaca sip historical', symbols: o.symbols, tried: [] }, days: [] };
  }
  const tried = new Set(ds.meta.tried ?? []);
  const haveDates = () => new Set(ds!.days.map((d) => d.date)).size;
  st.days = haveDates(); st.target = o.days;
  if (st.days >= o.days) { st.state = 'done'; st.message = `${st.days} trading days cached`; return; }

  const today = new Date(), from = new Date(+today - o.years * 365 * 864e5);
  const candidates = weekdays(from, new Date(+today - 864e5)).filter((d) => !tried.has(d)).sort(() => Math.random() - 0.5);

  st.state = 'syncing'; st.message = 'Fetching daily closes…';
  log.info(`[data] syncing real data: have ${st.days}/${o.days} trading days`, { timestamp: true });
  const client = createClient(o.key, o.secret);
  const closes = await dailyCloses(client, o.symbols, from.toISOString().slice(0, 10));

  let sinceSave = 0;
  for (const date of candidates) {
    if (haveDates() >= o.days) break;
    st.message = `Downloading ${date}`;
    const days = await fetchDate(client, o.symbols, date, closes);
    ds.days.push(...days);
    tried.add(date);
    st.days = haveDates();
    if (++sinceSave >= SAVE_EVERY) {
      ds.meta.tried = [...tried]; ds.meta.generated = new Date().toISOString().slice(0, 10);
      writeCache(o.file, ds); st.version++; sinceSave = 0;
    }
  }
  ds.meta.tried = [...tried]; ds.meta.generated = new Date().toISOString().slice(0, 10);
  writeCache(o.file, ds); st.version++;
  st.state = 'done'; st.message = `${st.days} trading days cached`;
  log.info(`[data] sync done: ${st.days} trading days, ${ds.days.length} symbol-days`, { timestamp: true });
}

function start(o: SyncOptions, log: Logger) {
  const st = shared.status;
  st.hasKeys = Boolean(o.key && o.secret);
  const cached = readCache(o.file);
  if (cached && st.version === 0) { st.days = new Set(cached.days.map((d) => d.date)).size; st.version = 1; }
  if (!st.hasKeys) {
    st.state = 'idle'; st.message = 'Add APCA_API_KEY_ID and APCA_API_SECRET_KEY to .env to download real data.';
    log.warn('[data] no Alpaca keys in .env: using cached or demo data', { timestamp: true });
    return;
  }
  if (shared.running) return;
  shared.running = sync({ ...o, key: o.key!, secret: o.secret! }, log)
    .catch((e: unknown) => {
      st.state = 'error';
      st.message = e instanceof AlpacaError && (e.status === 401 || e.status === 403)
        ? `Alpaca rejected the request (${e.status}). Check the keys in .env. ${e.message}`
        : (e as Error).message;
      log.error(`[data] sync failed: ${st.message}`, { timestamp: true });
    })
    .finally(() => { shared.running = null; });
}

const inflight = new Map<string, Promise<string>>();
/** Cached history file for sym/date, fetching it from Alpaca the first time. Resolves to the file path. */
function historyFile(o: SyncOptions, sym: string, date: string): Promise<string> {
  const file = path.join(path.dirname(o.file), 'history', sym, `${date}.json`);
  // Reuse the cache unless it predates 1-min history (no "m1" key).
  if (fs.existsSync(file)) { try { if ('m1' in JSON.parse(fs.readFileSync(file, 'utf8'))) return Promise.resolve(file); } catch { /* refetch */ } }
  const k = `${sym}/${date}`;
  if (!inflight.has(k)) {
    inflight.set(k, fetchHistory(createClient(o.key!, o.secret!), sym, date)
      .then((h) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(h)); return file; })
      .finally(() => inflight.delete(k)));
  }
  return inflight.get(k)!;
}

export function dataSync(o: SyncOptions): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const [url, qs] = (req.url || '').split('?');
    if (url === '/api/history') {
      const q = new URLSearchParams(qs), sym = q.get('sym') ?? '', date = q.get('date') ?? '';
      if (!/^[A-Z.]{1,10}$/.test(sym) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.statusCode = 400; return res.end('bad sym/date'); }
      if (!(o.key && o.secret)) { res.statusCode = 404; return res.end('no keys'); }
      historyFile(o, sym, date).then((file) => {
        res.setHeader('Content-Type', 'application/json');
        fs.createReadStream(file).pipe(res);
      }).catch((e: Error) => { res.statusCode = 502; res.end(e.message); });
      return;
    }
    if (url === '/api/status') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify(shared.status));
    }
    if (url === '/api/data') {
      if (!fs.existsSync(o.file)) { res.statusCode = 404; return res.end('no data yet'); }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      return fs.createReadStream(o.file).pipe(res);
    }
    next();
  };
  return {
    name: 'drill-data-sync',
    configureServer(server) { server.middlewares.use(handler); start(o, server.config.logger); },
    configurePreviewServer(server) { server.middlewares.use(handler); start(o, server.config.logger); },
  };
}
