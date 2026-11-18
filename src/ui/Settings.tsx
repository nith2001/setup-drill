import { useReducer, useRef } from 'react';
import { DEMO_SOURCE } from '../core/demo';
import type { Dataset, SyncStatus } from '../core/types';
import type { OrderSettings } from '../engine/replay';
import { useJournal } from './Journal';
import { PNL_VIEWS } from './pnl';
import { app, loadOrder, saveOrder, saveSettings, setData, settings, toast, universeAvailable, type Settings as S, type Universe } from './state';

interface Props { sync: SyncStatus | null; onLoad: (ds: Dataset) => void }

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setRow">
      <div><div>{label}</div>{hint && <div className="muted small">{hint}</div>}</div>
      <div className="setCtl">{children}</div>
    </div>
  );
}

function Seg<T extends string | number>({ value, opts, onChange }: { value: T; opts: [T, string][]; onChange: (v: T) => void }) {
  return <span className="seg">{opts.map(([v, l]) => <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</span>;
}

export function Settings({ sync, onLoad }: Props) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const fileIn = useRef<HTMLInputElement>(null);
  const j = useJournal();
  const order = loadOrder();

  const setSetting = (key: Exclude<keyof S, 'universe'>, v: number) => {
    settings[key] = v;
    saveSettings();
    if (key === 'orMin' || key === 'ruleTf') setData(app.data); // pools depend on these
    rerender();
  };
  const setUniverse = (u: Universe) => { settings.universe = u; saveSettings(); setData(app.data); rerender(); };
  const setOrder = (p: Partial<OrderSettings>) => { saveOrder({ ...order, ...p }); rerender(); };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    // accepts plain JSON or the old `window.DRILL_DATA=...;` format
    const txt = (await f.text()).replace(/^[^{]*/, '').replace(/;?\s*$/, '');
    try { onLoad(JSON.parse(txt)); toast(`Loaded ${app.data.days.length} days`); } catch { toast('Could not read that file'); }
  };

  const { data } = app;
  const real = data.meta.source !== DEMO_SOURCE;
  const syms = new Set(data.days.map((d) => d.sym)).size;

  return (
    <div className="page narrow">
      <h1>Settings</h1>

      <section className="panelCard">
        <h3>Practice</h3>
        <Row label="Practice on" hint={universeAvailable('index') ? 'Index ETFs behave like index futures (SPY ≈ ES, QQQ ≈ NQ).' : 'No SPY/QQQ days downloaded yet, so all symbols are used.'}>
          <Seg value={settings.universe} opts={[['index', 'SPY / QQQ'], ['stocks', 'Stocks'], ['all', 'Everything']]} onChange={setUniverse} />
        </Row>
        <Row label="Rule candles" hint="Candle size the setup rules run on. 5-min filters out 1-min noise and suits trades that last hours. Changes which charts count as valid.">
          <Seg value={settings.ruleTf} opts={[[5, '5-min'], [1, '1-min']]} onChange={(v) => setSetting('ruleTf', v)} />
        </Row>
        <Row label="Blind mode" hint="Hide the ticker and date while you trade (revealed on the grade sheet).">
          <Seg value={settings.blind} opts={[[1, 'On'], [0, 'Off']]} onChange={(v) => setSetting('blind', v)} />
        </Row>
        <Row label="Opening range" hint="Length used by the ORB setup and the Opening range indicator.">
          <Seg value={settings.orMin} opts={[[5, '5 min'], [15, '15 min'], [30, '30 min']]} onChange={(v) => setSetting('orMin', v)} />
        </Row>
        <Row label="Slow down on entry" hint="When you open a trade, the replay drops to 1× real time so you manage the position live. Speed it back up any time.">
          <Seg value={settings.autoSlow} opts={[[1, 'On'], [0, 'Off']]} onChange={(v) => setSetting('autoSlow', v)} />
        </Row>
        <Row label="Free play start" hint="Random: anywhere from the open to 2 hours before the close. You still see the earlier part of the day.">
          <Seg value={settings.fpStart} opts={[[1, 'Random time'], [0, 'At the open']]} onChange={(v) => setSetting('fpStart', v)} />
        </Row>
      </section>

      <section className="panelCard">
        <h3>Trading defaults</h3>
        <Row label="Account size" hint="Starting balance for each rep; % risk is based on it.">
          <span className="mono">$</span>
          <input className="numIn" type="number" step={1000} min={1000} defaultValue={order.account}
            onBlur={(e) => { const n = Number(e.target.value); if (n >= 1000) setOrder({ account: n }); }} />
        </Row>
        <Row label="Risk per trade" hint="Shares are sized so hitting your stop loses this much.">
          <Seg value={order.riskMode} opts={[['usd', '$'], ['pct', '% of account']]} onChange={(v) => setOrder({ riskMode: v, risk: v === 'usd' ? Math.round((order.account * order.risk) / 100) || 250 : +((100 * order.risk) / order.account).toFixed(2) || 0.5 })} />
          <input key={order.riskMode} className="numIn" type="number" step={order.riskMode === 'usd' ? 25 : 0.1} defaultValue={order.risk}
            onBlur={(e) => { const n = Number(e.target.value); if (n > 0) setOrder({ risk: n }); }} />
        </Row>
        <Row label="Take profit" hint="Target placed automatically when you enter.">
          <Seg value={order.tpOn ? order.rr : 0} opts={[[0, 'Off'], [1, '1R'], [1.5, '1.5R'], [2, '2R'], [3, '3R']]} onChange={(v) => setOrder(v ? { tpOn: true, rr: v } : { tpOn: false })} />
        </Row>
        <Row label="Live P&L shown as" hint="What you see while a trade is open. Balance only changes when it closes.">
          <Seg value={order.pnlView} opts={PNL_VIEWS} onChange={(v) => setOrder({ pnlView: v })} />
        </Row>
      </section>

      <section className="panelCard">
        <h3>Market data</h3>
        <Row label={real ? 'Real data (Alpaca)' : 'Demo data'} hint={real ? `${data.days.length} symbol-days · ${syms} symbols, stored in data/days.json` : 'Randomly generated prices. Add Alpaca keys to .env for real data.'}>
          <span className={`statusDot ${sync?.state === 'error' ? 'err' : real ? 'ok' : ''}`} />
          <span className="small">{sync?.state === 'syncing' ? `downloading ${sync.days}/${sync.target} days…` : sync?.state === 'error' ? sync.message : sync?.state === 'done' ? 'up to date' : ''}</span>
        </Row>
        <Row label="Load a data file" hint="Use a days.json exported elsewhere instead of the synced data.">
          <button className="ghost" onClick={() => fileIn.current?.click()}>Choose file…</button>
        </Row>
      </section>

      <section className="panelCard">
        <h3>Journal</h3>
        <Row label="Where it's saved" hint={j.mode === 'file' ? 'A plain JSON file in the project folder. Back it up or copy it like any file; it is never committed to git.' : 'The dev server is not reachable, so entries are kept in this browser until it is.'}>
          <code className="small">{j.mode === 'file' ? 'journal/journal.json' : 'browser storage'}</code>
        </Row>
        <Row label="Entries"><span className="mono">{j.entries.length} reps</span></Row>
      </section>

      <input ref={fileIn} type="file" accept=".json,.js" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  );
}
