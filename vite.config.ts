/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import { dataSync } from './server/dataSync';
import { journal } from './server/journal';
import { reports } from './server/reports';
import { INDEX_SYMBOLS } from './src/core/universe';
import { DEFAULT_SYMBOLS } from './src/data/alpaca';

export default defineConfig(({ mode }) => {
  // Reads .env server-side only. Nothing here is exposed to the browser (only VITE_* vars would be).
  const env = loadEnv(mode, process.cwd(), '');
  const list = (s?: string) => s?.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);

  return {
    // No data sync during tests (Vitest loads this config too).
    plugins: [react(), ...(process.env.VITEST ? [] : [
      journal(path.resolve('journal/journal.json')),
      reports(path.resolve('reports/reports.jsonl')),
      dataSync({
        key: env.APCA_API_KEY_ID,
        secret: env.APCA_API_SECRET_KEY,
        symbols: list(env.SYNC_SYMBOLS) ?? DEFAULT_SYMBOLS,
        days: Number(env.SYNC_DAYS) || 100,
        years: Number(env.SYNC_YEARS) || 3,
        indexSymbols: list(env.SYNC_INDEX_SYMBOLS) ?? INDEX_SYMBOLS,
        indexDays: Number(env.SYNC_INDEX_DAYS) || 500,
        file: path.resolve('data/days.json'),
      }),
    ])],
    server: { port: 5173, open: true, watch: { ignored: ['**/data/**', '**/journal/**', '**/reports/**'] } },
    build: { target: 'es2022' },
    // `npm run reports` / `npm run audit` set CHECK to run one script in scripts/ instead of the tests.
    test: { include: process.env.CHECK ? [`scripts/${process.env.CHECK}.check.ts`] : ['tests/**/*.test.ts'] },
  };
});
