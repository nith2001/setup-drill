// Local trade journal stored as one JSON file (journal/journal.json, gitignored).
//   GET    /api/journal              -> { version, entries }
//   POST   /api/journal              -> add one entry (body: JournalEntry) or many (body: { import: JournalEntry[] })
//   PATCH  /api/journal/<id>         -> update notes / tags of one entry
//   DELETE /api/journal/<id>         -> remove one entry
import fs from 'node:fs';
import path from 'node:path';
import type { Connect } from 'vite';
import { JOURNAL_VERSION, type JournalEntry } from '../src/core/journal';

interface JournalFile { version: number; entries: JournalEntry[] }

export function journalStore(file: string) {
  let cache: JournalFile | null = null;
  const read = (): JournalFile => {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(file, 'utf8')) as JournalFile; } catch { cache = { version: JOURNAL_VERSION, entries: [] }; }
    return cache;
  };
  const write = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 1));
    fs.renameSync(tmp, file); // atomic: never leaves a half-written journal
  };
  return {
    all: () => read(),
    add(es: JournalEntry[]) {
      const j = read(), have = new Set(j.entries.map((e) => e.id));
      const fresh = es.filter((e) => e && typeof e.id === 'string' && !have.has(e.id));
      j.entries.push(...fresh);
      if (fresh.length) write();
      return fresh.length;
    },
    patch(id: string, p: { notes?: unknown; tags?: unknown }) {
      const e = read().entries.find((x) => x.id === id);
      if (!e) return false;
      if (typeof p.notes === 'string') e.notes = p.notes.slice(0, 5000);
      if (Array.isArray(p.tags)) e.tags = p.tags.filter((t): t is string => typeof t === 'string').slice(0, 20);
      write();
      return true;
    },
    remove(id: string) {
      const j = read(), n = j.entries.length;
      j.entries = j.entries.filter((e) => e.id !== id);
      if (j.entries.length !== n) write();
      return j.entries.length !== n;
    },
  };
}

const body = (req: Connect.IncomingMessage) => new Promise<unknown>((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 5e6) reject(new Error('too large')); });
  req.on('end', () => { try { resolve(JSON.parse(s || 'null')); } catch (e) { reject(e); } });
  req.on('error', reject);
});

export function journalHandler(file: string): Connect.NextHandleFunction {
  const store = journalStore(file);
  return (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    if (!url.startsWith('/api/journal')) return next();
    const id = decodeURIComponent(url.slice('/api/journal/'.length));
    const json = (code: number, v: unknown) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); };
    (async () => {
      if (req.method === 'GET' && url === '/api/journal') return json(200, store.all());
      if (req.method === 'POST' && url === '/api/journal') {
        const b = (await body(req)) as JournalEntry | { import?: JournalEntry[] } | null;
        const list = b && 'import' in b && Array.isArray(b.import) ? b.import : b ? [b as JournalEntry] : [];
        return json(200, { added: store.add(list) });
      }
      if (id && req.method === 'PATCH') return json(store.patch(id, ((await body(req)) ?? {}) as object) ? 200 : 404, { ok: true });
      if (id && req.method === 'DELETE') return json(store.remove(id) ? 200 : 404, { ok: true });
      json(405, { error: 'unsupported' });
    })().catch((e: Error) => json(400, { error: e.message }));
  };
}

/** Vite plugin serving the journal API in dev and preview. */
export function journal(file: string): import('vite').Plugin {
  const h = journalHandler(file);
  return {
    name: 'drill-journal',
    configureServer(server) { server.middlewares.use(h); },
    configurePreviewServer(server) { server.middlewares.use(h); },
  };
}
