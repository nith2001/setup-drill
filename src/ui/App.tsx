import { useCallback, useEffect, useRef, useState } from 'react';
import { randomDemoDataset } from '../core/demo';
import type { Dataset, SyncStatus } from '../core/types';
import { Replay } from '../engine/replay';
import { SETUP_BY_ID } from '../setups';
import { fetchDataset, fetchStatus, watchSync } from './data';
import { Home } from './Home';
import { Session } from './Session';
import { addHistory, app, pickDay, setData, settings } from './state';
import { Toast } from './Toast';

export function App() {
  const [dataVersion, setDataVersion] = useState(0);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [rep, setRep] = useState<Replay | null>(null);
  const repRef = useRef<Replay | null>(null);
  repRef.current = rep;

  const load = useCallback((ds: Dataset) => { setData(ds); setDataVersion((v) => v + 1); }, []);

  // Boot once: real data synced by the dev server if there is any yet, otherwise demo data.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const [status, cached] = await Promise.all([fetchStatus(), fetchDataset()]);
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
    const start = ev ? ev.startIdx : 5 + Math.floor(Math.random() * 55);
    const r = new Replay({
      setup, def: SETUP_BY_ID[setup] ?? null, day, ev, startIdx: start, orMin: settings.orMin,
      endIdx: Math.min(day.c.length - 1, ev ? ev.windowEnd : start - 1 + settings.repMin),
    });
    if (prev) { r.tgtR = prev.tgtR; r.speed = prev.speed; }
    r.onEnd = (x) => addHistory({
      setup: x.setup, sym: x.day.sym, date: x.day.date, trades: x.trades.length, netR: x.result!.netR,
      score: x.result!.score, verdict: x.result!.verdict, correct: x.result!.correct, ts: Date.now(),
    });
    setRep(r);
  }, []);

  const goHome = useCallback(() => { repRef.current?.dispose(); setRep(null); }, []);

  return (
    <>
      {dataVersion === 0
        ? <div id="home" className="muted">Loading…</div>
        : rep
        ? <Session key={rep.id} rep={rep} onHome={goHome} onNext={() => startRep(rep.setup)} />
        : <Home dataVersion={dataVersion} sync={sync} onStart={startRep} onLoad={load} />}
      <Toast />
    </>
  );
}
