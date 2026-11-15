import { useReducer, useRef } from 'react';
import { DEMO_SOURCE } from '../core/demo';
import type { Dataset, SyncStatus } from '../core/types';
import { FREE_PLAY, SETUP_BY_ID, SETUPS } from '../setups';
import { app, cls, fmtR, history, poolSize, saveSettings, setData, settings, toast, type Settings } from './state';

interface Props { dataVersion: number; sync: SyncStatus | null; onStart: (id: string) => void; onLoad: (ds: Dataset) => void }

function statsFor(setup: string) {
  const h = history.filter((x) => x.setup === setup);
  const scored = h.filter((x) => x.score != null).slice(-20);
  const dec = h.filter((x) => x.correct != null).slice(-20);
  return {
    reps: h.length,
    avg: scored.length ? Math.round(scored.reduce((a, x) => a + x.score!, 0) / scored.length) : null,
    netR: h.reduce((a, x) => a + x.netR, 0),
    acc: dec.length ? Math.round((100 * dec.filter((x) => x.correct).length) / dec.length) : null,
  };
}

function streakDays() {
  const days = new Set(history.map((x) => new Date(x.ts).toDateString()));
  let n = 0, d = new Date();
  if (!days.has(d.toDateString())) d = new Date(+d - 864e5);
  while (days.has(d.toDateString())) { n++; d = new Date(+d - 864e5); }
  return n;
}

function DataPill({ sync, onLoadFile }: { sync: SyncStatus | null; onLoadFile: () => void }) {
  const { data } = app;
  const real = data.meta.source !== DEMO_SOURCE;
  const syms = new Set(data.days.map((d) => d.sym)).size;
  let extra = null;
  if (sync?.state === 'syncing') extra = <span className="sync">downloading {sync.days}/{sync.target} days…</span>;
  else if (sync?.state === 'error') extra = <span className="down">{sync.message}</span>;
  else if (!real && sync && !sync.hasKeys) extra = <span>add Alpaca keys to <code>.env</code> for real data</span>;
  return (
    <div className={`datapill${real ? ' real' : ''}${sync?.state === 'error' ? ' err' : ''}`}>
      <span className="dot" />
      {real ? <span><b>Real data</b> {data.days.length} symbol-days · {syms} symbols</span> : <span><b>Demo data</b> randomly generated, not real prices</span>}
      {extra && <> · {extra}</>}
      {' · '}<button className="linkbtn" onClick={onLoadFile}>Load file</button>
    </div>
  );
}

function Card({ id, label, blurb, onStart }: { id: string; label: string; blurb: string; onStart: (id: string) => void }) {
  const st = statsFor(id), n = poolSize(id), ruled = id !== FREE_PLAY.id;
  return (
    <button className={`card ${n ? '' : 'disabled'}`} onClick={() => onStart(id)}>
      <h3>{label}</h3>
      <p>{blurb}</p>
      <div className="stats">
        <div><b>{st.reps}</b>reps</div>
        <div><b>{st.avg ?? '–'}</b>avg score</div>
        {ruled ? <div><b>{st.acc == null ? '–' : st.acc + '%'}</b>right calls</div> : <div><b className={cls(st.netR)}>{fmtR(st.netR)}</b>net</div>}
      </div>
      <span className="go">{ruled ? `${app.pools[id].valid.length} valid · ${app.pools[id].none.length} no-trade charts →` : `${n} days →`}</span>
    </button>
  );
}

const SEGS: { key: keyof Settings; label: string; opts: [number, string][] }[] = [
  { key: 'orMin', label: 'Opening range', opts: [[5, '5m'], [15, '15m'], [30, '30m']] },
  { key: 'repMin', label: 'Free play length', opts: [[60, '60m'], [120, '2h'], [999, 'Full day']] },
  { key: 'blind', label: 'Blind', opts: [[1, 'On'], [0, 'Off']] },
];

export function Home({ sync, onStart, onLoad }: Props) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const fileIn = useRef<HTMLInputElement>(null);

  const setSetting = (key: keyof Settings, v: number) => {
    settings[key] = v;
    saveSettings();
    if (key === 'orMin') setData(app.data); // ORB pools depend on the range length
    rerender();
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    // accepts plain JSON or the old `window.DRILL_DATA=...;` format
    const txt = (await f.text()).replace(/^[^{]*/, '').replace(/;?\s*$/, '');
    try { onLoad(JSON.parse(txt)); toast(`Loaded ${app.data.days.length} days`); } catch { toast('Could not read that file'); }
  };

  const groups: Record<string, { id: string; label: string; blurb: string }[]> = {};
  for (const s of SETUPS) (groups[s.group] ??= []).push(s);
  groups.Practice = [FREE_PLAY];
  const streak = streakDays();
  const rows = history.slice(-10).reverse();

  return (
    <div id="home">
      <div className="brand"><h1>Setup Drill</h1><span className="tag">Pick a setup. Take it only when it's really there.</span></div>
      <DataPill sync={sync} onLoadFile={() => fileIn.current?.click()} />
      <div className="cards">
        {Object.entries(groups).map(([g, list]) => [
          <h2 key={g} className="group">{g}</h2>,
          ...list.map((s) => <Card key={s.id} {...s} onStart={onStart} />),
        ])}
      </div>

      <div className="row">
        {SEGS.map((sg) => (
          <div key={sg.key}><span className="lbl">{sg.label}</span>
            <span className="seg">{sg.opts.map(([v, l]) => <button key={v} className={settings[sg.key] === v ? 'on' : ''} onClick={() => setSetting(sg.key, v)}>{l}</button>)}</span>
          </div>
        ))}
        <div className="streak">{streak ? <>🔥 <b>{streak}</b> day streak</> : 'No streak yet'}</div>
      </div>

      <h2>Recent reps</h2>
      <div className="muted">
        {rows.length ? (
          <table className="hist"><tbody>
            <tr><th>Setup</th><th>Day</th><th>Call</th><th>Trades</th><th>Outcome</th><th>Score</th></tr>
            {rows.map((r) => (
              <tr key={r.ts}>
                <td>{SETUP_BY_ID[r.setup]?.label ?? (r.setup === FREE_PLAY.id ? FREE_PLAY.label : r.setup)}</td>
                <td className="mono">{r.sym} {r.date}</td>
                <td className={r.correct == null ? '' : r.correct ? 'up' : 'down'}>{r.verdict || '–'}</td>
                <td>{r.trades}</td>
                <td className={`mono ${cls(r.netR)}`}>{fmtR(r.netR)}</td>
                <td className="mono">{r.score ?? '–'}</td>
              </tr>
            ))}
          </tbody></table>
        ) : 'No reps yet. Pick a setup above.'}
      </div>
      <input ref={fileIn} type="file" accept=".json,.js" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  );
}
