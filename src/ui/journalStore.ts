// Client side of the trade journal. Saves to journal/journal.json through the dev server;
// if the server isn't reachable (e.g. a static build) it falls back to this browser's storage.
import { newEntryId, restartDupes, type JournalEntry } from '../core/journal';
import { store, toast } from './state';

type Mode = 'file' | 'browser';
const LOCAL_KEY = 'drill.journal';
const LEGACY_KEY = 'drill.history';

export const journal = {
  entries: [] as JournalEntry[],
  mode: 'browser' as Mode,
  loaded: false,
  version: 0,
};
const listeners = new Set<() => void>();
const emit = () => { journal.version++; for (const f of listeners) f(); };
export const subscribeJournal = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const journalVersion = () => journal.version;

const api = async (method: string, url: string, body?: unknown) => {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
};
const saveLocal = () => { if (journal.mode === 'browser') store.set(LOCAL_KEY, journal.entries); };

/** Old per-browser rep history (before the journal existed) as journal entries. */
function legacyEntries(): JournalEntry[] {
  const old = store.get<{ setup: string; sym: string; date: string; netR: number; netUsd?: number; score: number | null; verdict: string | null; correct: boolean | null; ts: number }[]>(LEGACY_KEY, []);
  return old.map((h) => ({
    id: `legacy-${h.ts}`, ts: h.ts, setup: h.setup, setupLabel: h.setup, sym: h.sym, date: h.date,
    valid: null, score: h.score, grade: h.verdict ?? '', verdict: h.verdict, correct: h.correct,
    netR: h.netR, netUsd: h.netUsd ?? 0, account: 50000, trades: [], attempt: 1,
    notes: 'Imported from earlier browser history (trade details were not recorded then).', tags: [],
  }));
}

export async function loadJournal(labelFor: (setup: string) => string) {
  try {
    const j = (await api('GET', '/api/journal')) as { entries: JournalEntry[] };
    journal.mode = 'file';
    journal.entries = j.entries;
    // One-time: move anything saved in this browser (old history, offline entries) into the file.
    const pending = [...legacyEntries(), ...store.get<JournalEntry[]>(LOCAL_KEY, [])].map((e) => ({ ...e, setupLabel: e.setupLabel === e.setup ? labelFor(e.setup) : e.setupLabel }));
    if (pending.length) {
      await api('POST', '/api/journal', { import: pending });
      const have = new Set(journal.entries.map((e) => e.id));
      journal.entries.push(...pending.filter((e) => !have.has(e.id)));
      journal.entries.sort((a, b) => a.ts - b.ts);
      store.set(LEGACY_KEY, []); store.set(LOCAL_KEY, []);
    }
  } catch {
    journal.mode = 'browser';
    journal.entries = [...legacyEntries(), ...store.get<JournalEntry[]>(LOCAL_KEY, [])];
  }
  // Restarted charts used to be saved as extra entries: keep only each chart's first run.
  for (const id of restartDupes(journal.entries)) await deleteEntry(id);
  journal.loaded = true;
  emit();
}

/** Add an entry now (UI updates immediately); the file write happens in the background. */
export function addEntry(e: Omit<JournalEntry, 'id'>): JournalEntry {
  const entry = { ...e, id: newEntryId(e.ts) } as JournalEntry;
  journal.entries.push(entry);
  saveLocal(); emit();
  if (journal.mode === 'file') api('POST', '/api/journal', entry).catch(() => { journal.mode = 'browser'; saveLocal(); emit(); });
  return entry;
}

export async function updateEntry(id: string, p: { notes?: string; tags?: string[] }) {
  const e = journal.entries.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, p);
  saveLocal(); emit();
  if (journal.mode === 'file') await api('PATCH', `/api/journal/${encodeURIComponent(id)}`, p).catch(() => toast("Couldn't save your note / tags to the journal file. Is the dev server running?"));
}

export async function deleteEntry(id: string) {
  journal.entries = journal.entries.filter((x) => x.id !== id);
  saveLocal(); emit();
  if (journal.mode === 'file') await api('DELETE', `/api/journal/${encodeURIComponent(id)}`).catch(() => toast("Couldn't delete that entry from the journal file. It will come back on reload."));
}

/** Save a file to the user's downloads. */
export function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
