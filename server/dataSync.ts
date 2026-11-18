// Vite plugin: on dev-server start, sync real Alpaca data into a local cache file in the
// background, and serve it to the app. The browser never talks to Alpaca or sees the keys.
//   GET /api/status -> SyncStatus
//   GET /api/data   -> Dataset JSON (404 until the first batch is saved)
//   GET /api/history?sym=AAPL&date=2025-03-04 -> History before that date (fetched once, then cached)
import fs from 'node:fs';
import path from 'node:path';
import type { Connect, Logger, Plugin } from 'vite';
import { AlpacaError, DAILY_LOOKBACK_DAYS, createClient, dailyBars, dayCtx, fetchDate, fetchHistory, h4Of, toSession, weekdays, type AlpacaBar, type AlpacaClient } from '../src/data/alpaca';
import type { SessionBars } from '../src/core/candles';
import type { Dataset, Day, SyncStatus } from '../src/core/types';

export interface SyncOptions {
  key?: string;
  secret?: string;
  symbols: string[];
  /** Target number of random trading days (all `symbols`) to have cached. */
  days: number;
  /** Sample those dates from the last N years. */
  years: number;
  /** Index ETFs (futures stand-ins) downloaded for consecutive recent days. */
  indexSymbols: string[];
  indexDays: number;
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

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Fill `ctx.prev5` (prior session's 5-min closes) for days missing it, one symbol at a time. */
async function backfillPrev5(client: AlpacaClient, ds: Dataset, st: SyncStatus, log: Logger) {
  const missing = ds.days.filter((d) => d.ctx && (!d.ctx.prev5 || !d.ctx.vol5 || !d.ctx.h4));
  if (!missing.length) return false;
  const bySym = new Map<string, Day[]>();
  for (const d of missing) (bySym.get(d.sym) ?? bySym.set(d.sym, []).get(d.sym)!).push(d);
  let done = 0;
  for (const [sym, days] of bySym) {
    st.message = `Adding indicator warmup (${++done}/${bySym.size} symbols)…`;
    const first = days.reduce((m, d) => (d.date < m ? d.date : m), days[0].date);
    const last = days.reduce((m, d) => (d.date > m ? d.date : m), days[0].date);
    const raw = (await client.bars([sym], '5Min', isoDay(Date.parse(first) - 35 * 864e5), `${last}T00:00:00Z`))[sym] || [];
    const byDate = new Map<string, AlpacaBar[]>();
    for (const b of raw) { const k = b.t.slice(0, 10); (byDate.get(k) ?? byDate.set(k, []).get(k)!).push(b); }
    const sessions = [...byDate.keys()].sort().map((k) => toSession(k, byDate.get(k)!, 5, 30)).filter((x): x is SessionBars => !!x);
    for (const d of days) {
      let prev: SessionBars | undefined;
      for (const s of sessions) { if (s.date < d.date) prev = s; else break; }
      if (!d.ctx!.prev5) d.ctx!.prev5 = prev ? prev.c : [];
      // Time-of-day volume baseline: average of each 5-min slot over the prior 20 sessions.
      const before = sessions.filter((s) => s.date < d.date).slice(-20);
      d.ctx!.h4 = h4Of(before.slice(-7));
      if (before.length >= 5) d.ctx!.vol5 = Array.from({ length: 78 }, (_, k) => Math.round(before.reduce((a, s) => a + (s.v[k] ?? 0), 0) / before.length));
    }
  }
  log.info(`[data] added indicator warmup + time-of-day volume to ${missing.length} days`, { timestamp: true });
  return true;
}

async function sync(o: SyncOptions & { key: string; secret: string }, log: Logger) {
  const st = shared.status;
  const ds: Dataset = readCache(o.file) ?? { meta: { source: 'alpaca sip historical', tried: [] }, days: [] };
  // Symbols can change without losing what's cached; new ones are just added from here on.
  ds.meta.symbols = [...new Set([...o.symbols, ...o.indexSymbols])];
  const isIdx = (s: string) => o.indexSymbols.includes(s);
  const have = new Set(ds.days.map((d) => `${d.sym}|${d.date}`));
  const add = (days: Day[]) => { for (const d of days) if (!have.has(`${d.sym}|${d.date}`)) { have.add(`${d.sym}|${d.date}`); ds.days.push(d); } };
  const tried = new Set(ds.meta.tried ?? []), triedIdx = new Set(ds.meta.triedIndex ?? []);
  const stockDates = () => new Set(ds.days.filter((d) => !isIdx(d.sym)).map((d) => d.date)).size;
  const indexDates = () => new Set(ds.days.filter((d) => isIdx(d.sym)).map((d) => d.date)).size;
  const progress = () => { st.days = Math.min(stockDates(), o.days) + Math.min(indexDates(), o.indexDays); };
  const save = () => {
    ds.meta.tried = [...tried]; ds.meta.triedIndex = [...triedIdx]; ds.meta.generated = isoDay(Date.now());
    writeCache(o.file, ds); st.version++;
  };
  st.target = o.days + o.indexDays; progress();

  const today = new Date(), from = new Date(+today - o.years * 365 * 864e5);
  const client = createClient(o.key, o.secret);
  const allSyms = ds.meta.symbols;
  const dailyFrom = (d: Date) => isoDay(+d - DAILY_LOOKBACK_DAYS * 864e5);
  st.state = 'syncing'; st.message = 'Fetching daily bars…';
  const daily = await dailyBars(client, allSyms, dailyFrom(from));

  // Prior-day levels / daily SMAs for days cached before that existed.
  const missing = ds.days.filter((d) => !d.ctx);
  if (missing.length) {
    for (const d of missing) { const c = dayCtx(daily[d.sym], d.date); if (c) d.ctx = c; }
    save(); log.info(`[data] added daily context to ${missing.length} days`, { timestamp: true });
  }
  // Daily closes for the higher-timeframe bias, for days cached before that existed.
  const noCloses = ds.days.filter((d) => d.ctx && (!d.ctx.closes || !d.ctx.daily));
  if (noCloses.length) {
    for (const d of noCloses) { const c = dayCtx(daily[d.sym], d.date); if (c?.closes) { d.ctx!.closes = c.closes; d.ctx!.daily = c.daily; } }
    save(); log.info(`[data] added daily closes (bias) to ${noCloses.length} days`, { timestamp: true });
  }

  // Random dates across `years`, all symbols.
  if (stockDates() < o.days) {
    log.info(`[data] syncing: ${stockDates()}/${o.days} random dates`, { timestamp: true });
    const candidates = weekdays(from, new Date(+today - 864e5)).filter((d) => !tried.has(d)).sort(() => Math.random() - 0.5);
    let n = 0;
    for (const date of candidates) {
      if (stockDates() >= o.days) break;
      st.message = `Downloading ${date}`;
      add(await fetchDate(client, o.symbols, date, daily));
      tried.add(date); progress();
      if (++n % SAVE_EVERY === 0) save();
    }
    save();
  }

  // Consecutive recent days of the index ETFs, newest first.
  if (o.indexSymbols.length && indexDates() < o.indexDays) {
    log.info(`[data] syncing index ETFs: ${indexDates()}/${o.indexDays} days`, { timestamp: true });
    const span = Math.ceil((o.indexDays / 250) * 365) + 30;
    const candidates = weekdays(new Date(+today - span * 864e5), new Date(+today - 864e5)).filter((d) => !triedIdx.has(d)).reverse();
    let n = 0;
    for (const date of candidates) {
      if (indexDates() >= o.indexDays) break;
      st.message = `Downloading ${o.indexSymbols.join('/')} ${date}`;
      add(await fetchDate(client, o.indexSymbols, date, daily));
      triedIdx.add(date); progress();
      if (++n % SAVE_EVERY === 0) save();
    }
    save();
  }

  if (await backfillPrev5(client, ds, st, log)) save();
  st.state = 'done'; st.message = `${stockDates()} random dates + ${indexDates()} index days cached`;
  log.info(`[data] sync done: ${ds.days.length} symbol-days`, { timestamp: true });
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
