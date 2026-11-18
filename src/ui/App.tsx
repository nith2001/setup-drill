import { useCallback, useEffect, useRef, useState } from 'react';
import { idealTrade } from '../core/ideal';
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
import { app, loadOrder, pickDay, pickExample, setData, settings, store, type ExampleKind } from './state';
import { Toast } from './Toast';

/** Drills start this many candles (min, max) before the pattern's context is complete. */
const DRILL_LEAD = [3, 18] as const;

type Tab = 'practice' | 'journal' | 'settings';
const TABS: [Tab, string][] = [['practice', 'Practice'], ['journal', 'Journal'], ['settings', 'Settings']];
const labelFor = (id: string) => SETUP_BY_ID[id]?.label ?? (id === FREE_PLAY.id ? FREE_PLAY.label : id);

/** Save a finished rep to the journal. */
function journalRep(r: Replay) {
  if (r.journaled) return; // restarts of a chart don't count: only its first run is in the journal
  r.journaled = true;
  const res = r.result!;
  const e = addEntry({
    ts: Date.now(), setup: r.setup, setupLabel: labelFor(r.setup), sym: r.day.sym, date: r.day.date,
    valid: r.ev ? r.ev.valid : null, score: res.score, grade: res.grade, verdict: res.verdict, correct: res.correct,
    netR: res.netR, netUsd: res.netUsd, account: r.order.account, trades: r.trades.map(tradeFromRaw),
    attempt: r.attempt, notes: '', tags: [], tf: r.barMin, start: r.ev ? r.startIdx : undefined,
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

  /**
   * example: show a played-out valid (true) or no-trade ('none') chart to study instead of trading,
   * or 'tutorial': a valid chart replayed from before the pattern with guided pauses.
   */
  const startRep = useCallback((setup: string, example: false | ExampleKind | 'tutorial' = false) => {
    const pick = example ? pickExample(setup, example === 'tutorial' ? 'win' : example) : pickDay(setup);
    if (!pick) return;
    const prev = repRef.current;
    prev?.dispose();
    const day = app.data.days[pick.i], ev = pick.ev ?? null;
    // Free play: a random start from the open to 2 hours before the close (or at the open, per Settings).
    const latest = Math.max(5, day.c.length - 120);
    let start = ev ? ev.startIdx : settings.fpStart ? 5 + Math.floor(Math.random() * (latest - 4)) : 5;
    if (ev && !example) {
      // Drills start a random 3–18 candles before the pattern is formed, so the setup builds while you watch and
      // the trigger isn't on the first candle. Valid and no-trade charts get the same lead, so it gives nothing away.
      const bm = ev.barMin ?? 1, lead = DRILL_LEAD[0] + Math.floor(Math.random() * (DRILL_LEAD[1] - DRILL_LEAD[0] + 1));
      start = Math.max(bm, Math.floor((ev.startIdx - lead * bm) / bm) * bm);
    }
    if (example === 'tutorial' && ev) {
      // Start a few candles before the pattern's first labelled point, on a candle boundary.
      const bm = ev.barMin ?? 1, first = Math.min(ev.startIdx, ...(ev.marks ?? []).map((m) => m.idx - bm + 1), ...(ev.lines ?? []).map((l) => l.idx ?? Infinity));
      start = Math.max(bm, Math.floor((first - 6 * bm) / bm) * bm);
    }
    const r = new Replay({
      setup, def: SETUP_BY_ID[setup] ?? null, day, ev, startIdx: start, orMin: settings.orMin,
      // Examples run 20 min past the rule window so you can see how the trade played out.
      // Examples run until the textbook trade resolves (plus 10 bars) so you can see how it played out.
      endIdx: Math.min(day.c.length - 1, ev ? (example ? (ev.valid ? Math.max(ev.windowEnd, idealTrade(day, ev).exitIdx + 10) : ev.windowEnd + 15) : ev.windowEnd) : day.c.length - 1), // free play always runs to the close
      order: loadOrder(), example: !!example && example !== 'tutorial', tutorial: example === 'tutorial', barMin: ev?.barMin ?? settings.ruleTf,
    });
    // Drills and free play start in real time; tutorials and examples at 60× (a minute per second).
    r.speed = example ? 60 : 1;
    r.autoSlow = !!settings.autoSlow;
    if (!example) r.onEnd = journalRep; // examples are never journaled
    setRep(r);
  }, []);

  const goHome = useCallback(() => { repRef.current?.dispose(); setRep(null); }, []);
  const real = app.data.meta.source !== DEMO_SOURCE;

  if (dataVersion === 0) return <div className="page muted">Loading…</div>;
  if (rep) return <><Session key={rep.id} rep={rep} onHome={goHome} onNext={() => startRep(rep.setup, rep.tutorial ? 'tutorial' : rep.example && (!rep.ev?.valid ? 'none' : rep.ideal?.outcome === 'stop' ? 'loss' : 'win'))}
          onExample={(kind) => startRep(rep.setup, kind)} onPractice={() => startRep(rep.setup)} /><Toast /></>;

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
      {tab === 'practice' && <Home onStart={(id) => startRep(id)} onExample={(id) => startRep(id, 'win')} onTutorial={(id) => startRep(id, 'tutorial')} onJournal={() => setTab('journal')} />}
      {tab === 'journal' && <Journal />}
      {tab === 'settings' && <Settings sync={sync} onLoad={load} />}
      <Toast />
    </div>
  );
}
