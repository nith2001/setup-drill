import { useEffect, useState, useSyncExternalStore } from 'react';
import { EMPTY_HISTORY, TFS, tfLabel, type History, type TF } from '../core/candles';
import { hhmm, relVol } from '../core/day';
import { r2 } from '../core/math';
import { applyPreset, type IndicatorConfig } from '../core/overlays';
import { SPEEDS, type Replay } from '../engine/replay';
import { FREE_PLAY } from '../setups';
import { ChartPane } from './ChartPane';
import { fetchHistory } from './data';
import { IndicatorPanel } from './IndicatorPanel';
import { app, cls, fmtR, loadIndicators, saveIndicators, settings, store, toast } from './state';

interface Props { rep: Replay; onHome: () => void; onNext: () => void }

export function Session({ rep, onHome, onNext }: Props) {
  const version = useSyncExternalStore(rep.subscribe, rep.getVersion);
  const [tf, setTfState] = useState<TF>(() => (rep.indicatorDrill ? 1 : store.get<TF>('drill.tf', 1)));
  const [cfg, setCfgState] = useState<IndicatorConfig>(() => applyPreset(loadIndicators(), rep.def?.preset));
  const [hist, setHist] = useState<History>(EMPTY_HISTORY);
  const [histLoading, setHistLoading] = useState(true);
  const [showInd, setShowInd] = useState(false);
  const [sheetHidden, setSheetHidden] = useState(false);

  const setTf = (t: TF) => { setTfState(t); store.set('drill.tf', t); };
  const setCfg = (c: IndicatorConfig) => { setCfgState(c); saveIndicators(c); };

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
      const k = e.key.toLowerCase();
      if (k === 'arrowright') { e.preventDefault(); if (e.shiftKey) rep.stepMinute(); else rep.stepBar(tf); }
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

  const lp = rep.last, rv = relVol(rep.day, rep.cur);
  const chips: [string, number][] = [];
  const or = rep.openingRange;
  if (or) chips.push(['OR low', or.lo], ['OR high', or.hi]);
  let lo5 = Infinity, hi5 = -Infinity;
  for (let i = Math.max(0, rep.cur - 4); i <= rep.cur; i++) { lo5 = Math.min(lo5, rep.day.l[i]); hi5 = Math.max(hi5, rep.day.h[i]); }
  chips.push(['5-bar low', r2(lo5 - 0.01)], ['5-bar high', r2(hi5 + 0.01)]);
  const p = rep.pos, posR = p ? (p.side * (lp - p.entry)) / p.risk : 0;
  const res = rep.result;

  return (
    <div id="session">
      <div className="top">
        <button className="ghost" onClick={onHome}>← Setups</button>
        <span className="setup">{rep.def?.label ?? FREE_PLAY.label}</span>
        <span className="sym">{settings.blind ? '??? · hidden date' : `${rep.day.sym} · ${rep.day.date}`}</span>
        <span className="clock mono">{hhmm(rep.cur)}</span>
        <span className="spacer" />
        <span className="seg" title="Timeframe (keys 1–6)">
          {TFS.map((t) => <button key={String(t)} className={t === tf ? 'on' : ''} onClick={() => setTf(t)}>{tfLabel(t)}</button>)}
        </span>
        <button className="ghost" onClick={() => setShowInd(true)} title="Indicators (I)">Indicators</button>
      </div>

      <ChartPane rep={rep} version={version} tf={tf} cfg={cfg} hist={hist} historyLoading={histLoading} />

      <div className="side">
        {rep.ev && rep.def && (
          <div className="box">
            <h4>Rule: only take it if…</h4>
            <div className="ruleText" dangerouslySetInnerHTML={{ __html: rep.def.rule(settings) }} />
            <div className="muted small" style={{ marginTop: 6 }}>Some charts have no valid setup. Graded on the decision, not the P&amp;L.</div>
          </div>
        )}

        <div className="box">
          <h4>Replay</h4>
          <div className="play">
            <button onClick={() => rep.stepBar(tf)} title="Next candle on this timeframe (→)">Step ▸</button>
            <button onClick={() => rep.stepMinute()} title="One minute (Shift+→)">+1m</button>
            <button className={rep.playing ? 'on' : ''} onClick={() => rep.togglePlay()} title="Play/Pause (Space)">{rep.playing ? 'Pause' : 'Play'}</button>
          </div>
          <div className="chips" style={{ marginTop: 8 }}>
            {SPEEDS.map((s) => <button key={s} className={`chip ${rep.speed === s ? 'on' : ''}`} onClick={() => rep.setSpeed(s)}>{s} min/s</button>)}
          </div>
          <button className="wide" onClick={() => rep.restart()} title="Start this chart over (R)">↺ Restart chart</button>
        </div>

        {!p && (
          <div className="box">
            <h4>Order</h4>
            <div className="kv"><span className="muted">Last</span><span className="mono">{lp.toFixed(2)}</span></div>
            <div className="kv"><span className="muted">Rel. volume (last 1m)</span><span className={`mono ${rv >= 1.5 ? 'up' : ''}`}>{rv.toFixed(1)}×</span></div>
            <div className="kv"><span className="muted">Stop</span><span className="mono">{rep.stopPx != null ? rep.stopPx.toFixed(2) : 'click chart'}</span></div>
            <div className="chips" style={{ margin: '6px 0' }}>
              {chips.map(([n, v]) => <button key={n} className="chip" onClick={() => say(rep.setStop(v))}>{n}</button>)}
            </div>
            <div className="kv"><span className="muted">Target</span><span className="chips">
              {[0, 1, 2, 3].map((r) => <button key={r} className={`chip ${rep.tgtR === r ? 'on' : ''}`} onClick={() => rep.setTargetR(r)}>{r ? `${r}R` : 'None'}</button>)}
            </span></div>
            <div className="trade">
              <button className="buy" disabled={rep.done || (rep.stopPx != null && rep.stopPx >= lp)} onClick={() => say(rep.enter(1))}>Buy <span className="k">B</span></button>
              <button className="sell" disabled={rep.done || (rep.stopPx != null && rep.stopPx <= lp)} onClick={() => say(rep.enter(-1))}>Short <span className="k">S</span></button>
            </div>
          </div>
        )}

        {p && (
          <div className="box">
            <h4>Position</h4>
            <div className={`bigR mono ${cls(posR)}`}>{fmtR(posR)}</div>
            <div className="kv"><span className="muted">Side</span><span>{p.side > 0 ? 'Long' : 'Short'}</span></div>
            <div className="kv"><span className="muted">Entry</span><span className="mono">{p.entry.toFixed(2)}</span></div>
            <div className="kv"><span className="muted">Stop</span><span className="mono">{p.stop.toFixed(2)}</span></div>
            <div className="kv"><span className="muted">Target</span><span className="mono">{p.target ? p.target.toFixed(2) : '–'}</span></div>
            <div className="muted small" style={{ marginTop: 4 }}>Click chart to move stop.</div>
            <button className="wide" onClick={() => rep.flatten()}>Flatten <kbd>F</kbd></button>
          </div>
        )}

        <div className="box">
          <h4>This rep</h4>
          <div className="kv"><span className="muted">Trades</span><span className="mono">{rep.trades.length}</span></div>
          <div className="kv"><span className="muted">Net</span><span className={`mono ${cls(rep.netR)}`}>{fmtR(rep.netR)}</span></div>
          <div className="kv"><span className="muted">Time left</span><span className="mono">{rep.done ? 'done' : `${rep.endIdx - rep.cur} min`}</span></div>
        </div>
        {!rep.done
          ? <button className="endbtn" onClick={() => rep.end()} title="Done trading: grade this rep">I'm done: grade it <kbd>E</kbd></button>
          : sheetHidden && <button className="endbtn" onClick={() => setSheetHidden(false)}>Show grade</button>}
        <div className="keys">
          <kbd>→</kbd> step candle · <kbd>⇧→</kbd> 1 min · <kbd>Space</kbd> play · <kbd>1</kbd>–<kbd>6</kbd> timeframe · <kbd>B</kbd>/<kbd>S</kbd> buy/short · <kbd>F</kbd> flatten · <kbd>R</kbd> restart · <kbd>I</kbd> indicators · <kbd>N</kbd> next rep
        </div>
      </div>

      {res && !sheetHidden && (
        <div id="result">
          <div className="sheet">
            <div className="resHead">
              <div className="score mono">{res.score ?? '–'}</div>
              <div>
                <div className={`verdict ${res.correct == null ? '' : res.correct ? 'up' : 'down'}`}>
                  {res.grade}{!rep.ev && <> · <span className={`${cls(res.netR)} mono`}>{fmtR(res.netR)}</span></>}
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
