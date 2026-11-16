// Replay screen, laid out like TradingView: top toolbar, left drawing tools, chart with a
// floating replay bar, order panel on the right, account/positions panel at the bottom.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { EMPTY_HISTORY, TFS, tfLabel, type History, type TF } from '../core/candles';
import { hhmm, relVol } from '../core/day';
import { applyPreset, type IndicatorConfig } from '../core/overlays';
import { SPEEDS, type OrderSettings, type Replay } from '../engine/replay';
import { FREE_PLAY } from '../setups';
import { AccountPanel } from './AccountPanel';
import { ChartPane } from './ChartPane';
import { fetchHistory } from './data';
import type { Drawing, Tool } from './drawings';
import { IndicatorPanel } from './IndicatorPanel';
import { ReviewBox } from './Journal';
import { OrderTicket, PositionCard, usd } from './OrderTicket';
import { app, cls, fmtR, loadIndicators, saveIndicators, saveOrder, settings, store, toast } from './state';

interface Props { rep: Replay; onHome: () => void; onNext: () => void }

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'cursor', label: 'Cursor', key: 'Esc', icon: 'M5 3l14 8-6 2-3 6z' },
  { id: 'trend', label: 'Trend line', key: 'Alt+T', icon: 'M4 20L20 4M4 20a1.5 1.5 0 1 0 0 .01M20 4a1.5 1.5 0 1 0 0 .01' },
  { id: 'hline', label: 'Horizontal line', key: 'Alt+H', icon: 'M3 12h18M12 12a1.5 1.5 0 1 0 0 .01' },
];

function Icon({ d }: { d: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

export function Session({ rep, onHome, onNext }: Props) {
  const version = useSyncExternalStore(rep.subscribe, rep.getVersion);
  const [tf, setTfState] = useState<TF>(() => (rep.indicatorDrill ? 1 : store.get<TF>('drill.tf', 1)));
  const [cfg, setCfgState] = useState<IndicatorConfig>(() => applyPreset(loadIndicators(), rep.def?.preset));
  const [hist, setHist] = useState<History>(EMPTY_HISTORY);
  const [histLoading, setHistLoading] = useState(true);
  const [showInd, setShowInd] = useState(false);
  const [sheetHidden, setSheetHidden] = useState(false);
  const [tool, setTool] = useState<Tool>('cursor');
  const [drawings, setDrawingsState] = useState<Drawing[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [bottomOpen, setBottomOpen] = useState(() => store.get('drill.bottomOpen', true));

  const setTf = (t: TF) => { setTfState(t); store.set('drill.tf', t); };
  const setCfg = (c: IndicatorConfig) => { setCfgState(c); saveIndicators(c); };
  const setDrawings = useCallback((fn: (d: Drawing[]) => Drawing[]) => setDrawingsState(fn), []);
  const onOrder = (patch: Partial<OrderSettings>) => { rep.setOrder(patch); saveOrder(rep.order); };
  const setBottom = (o: boolean) => { setBottomOpen(o); store.set('drill.bottomOpen', o); };

  useEffect(() => {
    let live = true;
    fetchHistory(app.data, rep.day).then((h) => { if (live) { setHist(h); setHistLoading(false); } });
    return () => { live = false; };
  }, [rep]);

  useEffect(() => { if (!rep.done) setSheetHidden(false); }, [rep.done]);

  const say = (err: string | null) => { if (err) toast(err); };

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const k = e.key.toLowerCase(), code = e.code;
      if (e.altKey && code === 'KeyT') { e.preventDefault(); setTool('trend'); return; }
      if (e.altKey && code === 'KeyH') { e.preventDefault(); setTool('hline'); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((k === 'delete' || k === 'backspace') && selected) { setDrawingsState((ds) => ds.filter((d) => d.id !== selected)); setSelected(null); }
      else if (k === 'arrowright') { e.preventDefault(); if (e.shiftKey) rep.stepMinute(); else rep.stepBar(tf); }
      else if (k === ' ') { e.preventDefault(); rep.togglePlay(); }
      else if (k === 'b') say(rep.enter(1));
      else if (k === 's') say(rep.enter(-1));
      else if (k === 'f') rep.flatten();
      else if (k === 'e') rep.end();
      else if (k === 'r') rep.restart();
      else if (k === 'i') setShowInd((x) => !x);
      else if (k === 'n' && rep.done) onNext();
      else if (/^[1-6]$/.test(k)) setTf(TFS[Number(k) - 1]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const rv = relVol(rep.day, rep.cur);
  const res = rep.result;
  const chg = rep.day.pc ? ((rep.last - rep.day.pc) / rep.day.pc) * 100 : null;

  return (
    <div id="session" className={`tv ${bottomOpen ? '' : 'bottomClosed'}`}>
      {/* ---------- Top toolbar ---------- */}
      <header className="tvTop">
        <button className="tbtn" onClick={onHome} title="Back to setups">←</button>
        <div className="symBox">
          <b>{settings.blind ? '???' : rep.day.sym}</b>
          <span className="muted small">{settings.blind ? 'hidden date' : rep.day.date}</span>
        </div>
        <div className="sep" />
        <span className="tfGroup" title="Timeframe (keys 1–6)">
          {TFS.map((t) => <button key={String(t)} className={`tbtn ${t === tf ? 'on' : ''}`} onClick={() => setTf(t)}>{tfLabel(t)}</button>)}
        </span>
        <div className="sep" />
        <button className="tbtn" onClick={() => setShowInd(true)} title="Indicators (I)">ƒx Indicators</button>
        <div className="sep" />
        <span className="setupName">{rep.def?.label ?? FREE_PLAY.label}</span>
        <span className="spacer" />
        <span className="quote mono">
          <b>{rep.last.toFixed(2)}</b>
          {chg != null && <span className={chg >= 0 ? 'up' : 'down'}> {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>}
          <span className="muted"> · RVol <span className={rv >= 1.5 ? 'up' : ''}>{rv.toFixed(1)}×</span></span>
        </span>
        {!rep.done
          ? <button className="tbtn accent" onClick={() => rep.end()} title="Done trading: grade this rep (E)">Finish &amp; grade</button>
          : sheetHidden && <button className="tbtn accent" onClick={() => setSheetHidden(false)}>Show grade</button>}
      </header>

      {/* ---------- Left drawing toolbar ---------- */}
      <nav className="tvLeft">
        {TOOLS.map((t) => (
          <button key={t.id} className={`ltool ${tool === t.id ? 'on' : ''}`} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}><Icon d={t.icon} /></button>
        ))}
        <div className="lsep" />
        <button className="ltool" title="Delete selected drawing (Del)" disabled={!selected}
          onClick={() => { setDrawingsState((ds) => ds.filter((d) => d.id !== selected)); setSelected(null); }}>
          <Icon d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
        </button>
        <button className="ltool" title="Remove all drawings" disabled={!drawings.length}
          onClick={() => { setDrawingsState([]); setSelected(null); }}>
          <Icon d="M6 6l12 12M18 6L6 18" />
        </button>
      </nav>

      {/* ---------- Chart + floating replay bar ---------- */}
      <main className="tvChart">
        <ChartPane rep={rep} version={version} tf={tf} cfg={cfg} hist={hist} historyLoading={histLoading}
          tool={tool} setTool={setTool} drawings={drawings} setDrawings={setDrawings} selected={selected} setSelected={setSelected}>
          <div className="replayBar">
            <button className="rbtn" onClick={() => rep.restart()} title="Restart chart (R)">↺</button>
            <button className="rbtn play" onClick={() => rep.togglePlay()} title="Play / pause (Space)" disabled={rep.done}>{rep.playing ? '❚❚' : '▶'}</button>
            <button className="rbtn" onClick={() => rep.stepBar(tf)} title="Forward one candle (→)" disabled={rep.done}>▶|</button>
            <button className="rbtn" onClick={() => rep.stepMinute()} title="Forward one minute (Shift+→)" disabled={rep.done}>+1m</button>
            <select className="rsel" value={rep.speed} onChange={(e) => rep.setSpeed(Number(e.target.value))} title="Replay speed">
              {SPEEDS.map((s) => <option key={s} value={s}>{s}× ({s} min/s)</option>)}
            </select>
            <span className="rclock mono">{hhmm(rep.cur)}</span>
            <span className="muted small">{rep.done ? 'done' : `${rep.endIdx - rep.cur} min left`}</span>
          </div>
        </ChartPane>
      </main>

      {/* ---------- Right panel ---------- */}
      <aside className="tvRight">
        {rep.pos ? <PositionCard rep={rep} onOrder={onOrder} /> : !rep.done && <OrderTicket rep={rep} onOrder={onOrder} />}

        {rep.ev && rep.def && (
          <details className="box" open>
            <summary><h4>Rule: only take it if…</h4></summary>
            <div className="ruleText" dangerouslySetInnerHTML={{ __html: rep.def.rule(settings) }} />
            <div className="muted small" style={{ marginTop: 6 }}>Some charts have no valid setup. Graded on the decision, not the P&amp;L.</div>
          </details>
        )}

        <div className="box">
          <h4>This rep</h4>
          <div className="kv"><span className="muted">Trades</span><span className="mono">{rep.trades.length}</span></div>
          <div className="kv"><span className="muted">Net</span><span className={`mono ${cls(rep.realized)}`}>{usd(rep.realized, true)} · {fmtR(rep.netR)}</span></div>
        </div>
        <details className="keys">
          <summary>Keyboard shortcuts</summary>
          <kbd>→</kbd> next candle · <kbd>⇧→</kbd> 1 min · <kbd>Space</kbd> play · <kbd>1</kbd>–<kbd>6</kbd> timeframe · <kbd>B</kbd>/<kbd>S</kbd> buy/short · <kbd>F</kbd> close · <kbd>R</kbd> restart · <kbd>I</kbd> indicators · <kbd>Alt+T</kbd> trend line · <kbd>Alt+H</kbd> horizontal line · <kbd>Del</kbd> delete drawing · <kbd>E</kbd> grade · <kbd>N</kbd> next rep
        </details>
      </aside>

      {/* ---------- Bottom account panel ---------- */}
      <AccountPanel rep={rep} open={bottomOpen} setOpen={setBottom} />

      {res && !sheetHidden && (
        <div id="result">
          <div className="sheet">
            <div className="resHead">
              <div className="score mono">{res.score ?? '–'}</div>
              <div>
                <div className={`verdict ${res.correct == null ? '' : res.correct ? 'up' : 'down'}`}>
                  {res.grade} · <span className={`${cls(res.netUsd)} mono`}>{usd(res.netUsd, true)} ({fmtR(res.netR)})</span>
                </div>
                <div className="grade">{rep.day.sym} · {rep.day.date} · {rep.trades.length} trade{rep.trades.length === 1 ? '' : 's'}</div>
              </div>
            </div>
            {res.parts && (
              <div className="bars">
                {Object.entries(res.parts).map(([n, [v, m]]) => (
                  <div className="bar" key={n}>{n} <span className="mono" style={{ float: 'right' }}>{Math.round(v)}/{m}</span>
                    <div className="track"><div className="fill" style={{ width: `${(v / m) * 100}%` }} /></div></div>
                ))}
              </div>
            )}
            <ul className="feedback">{res.notes.map((n, i) => <li key={i} dangerouslySetInnerHTML={{ __html: n }} />)}</ul>
            {rep.journalId && (
              <div className="sheetReview">
                <h4>Review <span className="muted small">saved to your journal</span></h4>
                <ReviewBox entryId={rep.journalId} compact />
              </div>
            )}
            <div className="resActions">
              <button className="ghost" onClick={onHome}>Setups</button>
              <button className="ghost" onClick={() => setSheetHidden(true)}>Look at chart</button>
              <button className="ghost" onClick={() => rep.restart()}>Restart chart (R)</button>
              <button className="primary" onClick={onNext}>Next rep (N)</button>
            </div>
          </div>
        </div>
      )}

      {showInd && <IndicatorPanel cfg={cfg} onChange={setCfg} onClose={() => setShowInd(false)} />}
    </div>
  );
}
