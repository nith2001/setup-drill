import { useCallback, useEffect, useRef, useState } from 'react';
import { tradeFromRaw } from '../core/journal';
import { DEMO_SOURCE, randomDemoDataset } from '../core/demo';
import type { Dataset, SyncStatus } from '../core/types';
import { Replay } from '../engine/replay';
import { FREE_PLAY, SETUP_BY_ID } from '../setups';
import { fetchDataset, fetchStatus, watchSync } from './data';
import { Home } from './Home';
import { Journal } from './Journal';
import { addEntry, loadJournal } from './journalStore';
import { Session } from './Session';
import { Settings } from './Settings';
import { app, loadOrder, pickDay, setData, settings, store } from './state';
import { Toast } from './Toast';

type Tab = 'practice' | 'journal' | 'settings';
const TABS: [Tab, string][] = [['practice', 'Practice'], ['journal', 'Journal'], ['settings', 'Settings']];
const labelFor = (id: string) => SETUP_BY_ID[id]?.label ?? (id === FREE_PLAY.id ? FREE_PLAY.label : id);

/** Save a finished rep to the journal. */
function journalRep(r: Replay) {
  const res = r.result!;
  const e = addEntry({
    ts: Date.now(), setup: r.setup, setupLabel: labelFor(r.setup), sym: r.day.sym, date: r.day.date,
    valid: r.ev ? r.ev.valid : null, score: res.score, grade: res.grade, verdict: res.verdict, correct: res.correct,
    netR: res.netR, netUsd: res.netUsd, account: r.order.account, trades: r.trades.map(tradeFromRaw),
    attempt: r.attempt, notes: '', tags: [],
  });
  r.journalId = e.id;
}

export function App() {
  const [dataVersion, setDataVersion] = useState(0);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [rep, setRep] = useState<Replay | null>(null);
  const [tab, setTabState] = useState<Tab>(() => store.get<Tab>('drill.tab', 'practice'));
  const repRef = useRef<Replay | null>(null);
  repRef.current = rep;
  const setTab = (t: Tab) => { setTabState(t); store.set('drill.tab', t); };

  const load = useCallback((ds: Dataset) => { setData(ds); setDataVersion((v) => v + 1); }, []);

  // Boot once: journal + real data synced by the dev server if there is any yet, otherwise demo data.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const [status, cached] = await Promise.all([fetchStatus(), fetchDataset(), loadJournal(labelFor)]);
      load(cached ?? randomDemoDataset());
      setSync(status);
      if (status) watchSync(status, setSync, async () => {
        if (repRef.current) return false; // never swap data mid-rep
        const ds = await fetchDataset();
        if (ds) load(ds);
        return true;
      });
    })();
  }, [load]);

  const startRep = useCallback((setup: string) => {
    const pick = pickDay(setup);
    if (!pick) return;
    const prev = repRef.current;
    prev?.dispose();
    const day = app.data.days[pick.i], ev = pick.ev ?? null;
    // Free play: a random start from the open to 2 hours before the close (or at the open, per Settings).
    const latest = Math.max(5, day.c.length - 120);
    const start = ev ? ev.startIdx : settings.fpStart ? 5 + Math.floor(Math.random() * (latest - 4)) : 5;
    const r = new Replay({
      setup, def: SETUP_BY_ID[setup] ?? null, day, ev, startIdx: start, orMin: settings.orMin,
      endIdx: Math.min(day.c.length - 1, ev ? ev.windowEnd : start - 1 + settings.repMin),
      order: loadOrder(),
    });
    if (prev) r.speed = prev.speed;
    r.onEnd = journalRep;
    setRep(r);
  }, []);

  const goHome = useCallback(() => { repRef.current?.dispose(); setRep(null); }, []);
  const real = app.data.meta.source !== DEMO_SOURCE;

  if (dataVersion === 0) return <div className="page muted">Loading…</div>;
  if (rep) return <><Session key={rep.id} rep={rep} onHome={goHome} onNext={() => startRep(rep.setup)} /><Toast /></>;

  return (
    <div className="shell">
      <header className="nav">
        <span className="brandMark">Setup Drill</span>
        <nav className="tabs">
          {TABS.map(([t, l]) => <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{l}</button>)}
        </nav>
        <span className="spacer" />
        <button className="dataStatus" onClick={() => setTab('settings')} title="Market data status">
          <span className={`statusDot ${sync?.state === 'error' ? 'err' : real ? 'ok' : ''}`} />
          {sync?.state === 'syncing' ? `Syncing ${sync.days}/${sync.target}` : real ? 'Real data' : 'Demo data'}
        </button>
      </header>
      {tab === 'practice' && <Home onStart={startRep} onJournal={() => setTab('journal')} />}
      {tab === 'journal' && <Journal />}
      {tab === 'settings' && <Settings sync={sync} onLoad={load} />}
      <Toast />
    </div>
  );
}
