// Chart reports: "this chart is wrong for the strategy". Appended to reports/reports.jsonl (gitignored),
// one JSON object per line, so problems can be reproduced later with evaluateAll on the same sym/date.
//   GET  /api/reports -> all reports
//   POST /api/reports -> add one report
import fs from 'node:fs';
import path from 'node:path';
import type { Connect } from 'vite';

const body = (req: Connect.IncomingMessage) => new Promise<unknown>((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e6) reject(new Error('too large')); });
  req.on('end', () => { try { resolve(JSON.parse(s || 'null')); } catch (e) { reject(e); } });
  req.on('error', reject);
});

export function reportsHandler(file: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    if (url !== '/api/reports') return next();
    const json = (code: number, v: unknown) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); };
    (async () => {
      if (req.method === 'GET') {
        const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
        return json(200, lines.map((l) => JSON.parse(l)));
      }
      if (req.method === 'POST') {
        const r = await body(req);
        if (!r || typeof r !== 'object') return json(400, { error: 'empty report' });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify({ ...r, savedAt: new Date().toISOString() }) + '\n');
        return json(200, { ok: true });
      }
      json(405, { error: 'unsupported' });
    })().catch((e: Error) => json(400, { error: e.message }));
  };
}

/** Vite plugin serving the reports API in dev and preview. */
export function reports(file: string): import('vite').Plugin {
  const h = reportsHandler(file);
  return {
    name: 'drill-reports',
    configureServer(server) { server.middlewares.use(h); },
    configurePreviewServer(server) { server.middlewares.use(h); },
  };
}
