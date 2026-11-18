// Replay screen, laid out like TradingView: top toolbar, left drawing tools, chart with a
// floating replay bar, order panel on the right, account/positions panel at the bottom.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { EMPTY_HISTORY, TFS, tfLabel, type History, type TF } from '../core/candles';
import { hhmm, relVol } from '../core/day';
import type { IndicatorConfig } from '../core/overlays';
import { SPEEDS, speedLabel, type OrderSettings, type Replay } from '../engine/replay';
import { FREE_PLAY } from '../setups';
import { LESSONS } from '../setups/lessons';
import { AccountPanel } from './AccountPanel';
import { ChartPane } from './ChartPane';
import { fetchHistory } from './data';
import type { Drawing, Tool } from './drawings';
import { IndicatorPanel } from './IndicatorPanel';
import { ReviewBox } from './Journal';
import { ReportChart } from './ReportChart';
import { OrderTicket, PositionCard, usd } from './OrderTicket';
import { app, cls, fmtR, type ExampleKind, loadIndicators, resetIndicators, saveIndicators, saveOrder, settings, store, toast } from './state';

interface Props { rep: Replay; onHome: () => void; onNext: () => void; onExample: (kind: ExampleKind) => void; onPractice: () => void }

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'cursor', label: 'Cursor', key: 'Esc', icon: 'M5 3l14 8-6 2-3 6z' },
  { id: 'trend', label: 'Trend line', key: 'Alt+T', icon: 'M4 20L20 4M4 20a1.5 1.5 0 1 0 0 .01M20 4a1.5 1.5 0 1 0 0 .01' },
  { id: 'hline', label: 'Horizontal line', key: 'Alt+H', icon: 'M3 12h18M12 12a1.5 1.5 0 1 0 0 .01' },
  { id: 'rect', label: 'Box (click two corners)', key: 'Alt+B', icon: 'M4 6h16v12H4z' },
];

function Icon({ d }: { d: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

interface TStep { at: number | null; title: string; body: string; kind: 'intro' | 'mark' | 'entry' | 'outcome' | 'wrap' }

/** Builds the tutorial's stops from the setup's lesson and the chart's labelled points. */
function tutorialSteps(rep: Replay): TStep[] {
  const ev = rep.ev, lesson = rep.def ? LESSONS[rep.def.id] : undefined;
  if (!ev || !ev.valid || !lesson) return [];
  const x = rep.ideal!, bm = ev.barMin ?? 1;
  const steps: TStep[] = [{ at: null, kind: 'intro', title: rep.def!.label, body: lesson.idea }];
  const marks = [...(ev.marks ?? [])].filter((m) => m.idx < ev.trigIdx).sort((a, b) => a.idx - b.idx);
  for (const m of marks) steps.push({ at: m.idx, kind: 'mark', title: `${hhmm(m.idx - bm + 1)} · ${m.text}`,
    body: lesson.steps[m.text] ?? 'The blue dot marks a point the rule is watching.' });
  steps.push({ at: ev.trigIdx, kind: 'entry', title: `${hhmm(ev.trigIdx - bm + 1)} · the trigger`, body: ev.why });
  if (x.outcome !== 'open') steps.push({ at: Math.min(x.exitIdx, rep.endIdx), kind: 'outcome', title: x.outcome === 'target' ? 'Target hit' : 'Stopped out', body: lesson.manage });
  steps.push({ at: null, kind: 'wrap', title: 'Common mistakes', body: '' });
  return steps;
}

/** Guided walkthrough: plays the chart to each key moment and explains it. */
function TutorialCard({ rep, onNext, onPractice, onLoss }: { rep: Replay; onNext: () => void; onPractice: () => void; onLoss: () => void }) {
  const [steps] = useState(() => tutorialSteps(rep));
  const [i, setI] = useState(0);
  const lesson = rep.def ? LESSONS[rep.def.id] : undefined;
  if (!steps.length || !lesson) return <div className="box exampleCard"><p className="small">No tutorial for this one.</p><button className="primary" onClick={onPractice}>Practice this setup</button></div>;
  const s = steps[i], x = rep.ideal!;
  const reached = s.at == null || rep.cur >= s.at;
  const go = (j: number) => {
    const t = steps[j];
    setI(j);
    if (t.at != null && rep.cur < t.at) { rep.pauseAt = t.at; rep.play(); }
    else if (t.kind === 'wrap' && !rep.done) rep.end();
  };
  const last = i === steps.length - 1;
  return (
    <div className="box exampleCard tutorialCard">
      <div className="tutProgress">{steps.map((_, k) => <span key={k} className={k < i ? 'past' : k === i ? 'now' : ''} />)}</div>
      <h4>Tutorial · step {i + 1} of {steps.length}</h4>
      {!reached ? (
        <>
          <p className="small"><b>Watch the chart…</b> it plays to the next key moment ({hhmm(s.at!)}) and stops there.</p>
          {!rep.playing && <button className="primary" onClick={() => go(i)}>Continue playing</button>}
        </>
      ) : (
        <>
          <h3 className="tutTitle">{s.title}</h3>
          <p className="small" dangerouslySetInnerHTML={{ __html: s.body }} />
          {s.kind === 'intro' && <>
            <p className="small"><b>What to look for</b></p>
            <ul className="small tutList">{lesson.look.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="muted small">Press Next and the chart plays forward, stopping at each key moment.</p>
          </>}
          {s.kind === 'entry' && <>
            <div className="kv"><span className="muted">Entry</span><span className="mono">{x.entry.toFixed(2)} ({x.side > 0 ? 'long' : 'short'})</span></div>
            <p className="small">{lesson.entry}</p>
            <div className="kv"><span className="muted">Stop</span><span className="mono down">{x.stop.toFixed(2)}</span></div>
            <p className="small">{lesson.stop}</p>
            <div className="kv"><span className="muted">Target ({x.rr.toFixed(1)}R)</span><span className="mono up">{x.target.toFixed(2)}</span></div>
            <p className="small">Why there: {x.targetWhy}.</p>
            <p className="muted small">The entry, stop and target lines are now on the chart.</p>
          </>}
          {s.kind === 'outcome' && <p className={`small mono ${x.outcome === 'target' ? 'up' : 'down'}`}>{x.outcome === 'target' ? `+${x.rr.toFixed(1)}R` : '−1R'} at {hhmm(x.exitIdx)}</p>}
          {s.kind === 'wrap' && <>
            <ul className="small tutList">{lesson.mistakes.map((m) => <li key={m}>{m}</li>)}</ul>
            <p className="small"><b>Valid setups lose too.</b> This one worked, but many valid setups get stopped out. That's part of trading them, not a mistake. Look at one that lost to see what a well-played losing trade looks like.</p>
          </>}
        </>
      )}
      <div className="exActions">
        {i > 0 && <button className="ghost" onClick={() => { rep.pause(); rep.pauseAt = null; setI(0); rep.restart(); }}>Start over</button>}
        {!last && <button className="primary" disabled={!reached} onClick={() => go(i + 1)}>Next</button>}
        {last && <>
          <button className="ghost" onClick={onNext}>Another tutorial</button>
          <button className="ghost" onClick={onLoss}>See one that lost</button>
          <button className="primary" onClick={onPractice}>Try one yourself</button>
        </>}
      </div>
    </div>
  );
}

/** Collapsible lesson summary shown during drills and examples. */
function HowTo({ id }: { id: string }) {
  const l = LESSONS[id];
  if (!l) return null;
  return (
    <details className="box howTo">
      <summary><h4>How to trade it</h4></summary>
      <p className="small">{l.idea}</p>
      <p className="small"><b>Look for</b></p><ul className="small tutList">{l.look.map((x) => <li key={x}>{x}</li>)}</ul>
      <p className="small"><b>Entry:</b> {l.entry}</p>
      <p className="small"><b>Stop:</b> {l.stop}</p>
      <p className="small"><b>Target:</b> {l.target}</p>
      <p className="small"><b>Managing it:</b> {l.manage}</p>
      <p className="small"><b>Common mistakes</b></p><ul className="small tutList">{l.mistakes.map((x) => <li key={x}>{x}</li>)}</ul>
    </details>
  );
}

/** The textbook trade on a valid chart: entry at the trigger close, stop, target, and how it ended. */
function TextbookTrade({ rep }: { rep: Replay }) {
  const x = rep.ideal, ev = rep.ev;
  if (!x || !ev?.valid) return null;
  return (
    <>
      <div className="kv"><span className="muted">Trigger candle</span><span className="mono">{hhmm(ev.trigIdx - (ev.barMin ?? 1) + 1)}</span></div>
      <div className="kv"><span className="muted">Entry ({x.side > 0 ? 'buy' : 'sell'} at trigger close)</span><span className="mono">{x.entry.toFixed(2)}</span></div>
      <div className="kv"><span className="muted">Stop</span><span className="mono down">{x.stop.toFixed(2)} <span className="muted">({Math.round(x.risk * 100)} ticks)</span></span></div>
      <div className="kv"><span className="muted">Target ({x.rr.toFixed(1)}R)</span><span className="mono up">{x.target.toFixed(2)}</span></div>
      <p className="muted small">Target: {x.targetWhy}.</p>
      <div className="kv"><span className="muted">Result</span><span className={`mono ${x.outcome === 'target' ? 'up' : x.outcome === 'stop' ? 'down' : ''}`}>
        {x.outcome === 'target' ? `+${x.rr.toFixed(1)}R, target hit ${hhmm(x.exitIdx)}` : x.outcome === 'stop' ? `−1R, stopped ${hhmm(x.exitIdx)}` : 'still open at the close'}</span></div>
    </>
  );
}

/** Which labelled points were already on the chart when the replay started (drills start mid-pattern). */
function preStartNote(rep: Replay): string | null {
  const ev = rep.ev;
  if (!ev || rep.example) return null;
  const bm = ev.barMin ?? 1, before = (ev.marks ?? []).filter((m) => m.idx < rep.startIdx);
  if (!before.length) return null;
  const names = before.map((m) => (/^\d$/.test(m.text) ? `point ${m.text}` : m.text) + ` (${hhmm(m.idx - bm + 1)})`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list[0].toUpperCase()}${list.slice(1)} ${before.length === 1 ? 'was' : 'were'} already on the chart when the replay started at ${hhmm(rep.startIdx)}. That's on purpose: drills start a little before the setup, and parts of a pattern can form earlier in the day. The drill tests whether you catch the rest live.`;
}

/** Study panel for example mode: why it was (or wasn't) valid and the textbook trade. */
function ExampleCard({ rep, onNext, onExample, onPractice }: { rep: Replay; onNext: () => void; onExample: (kind: ExampleKind) => void; onPractice: () => void }) {
  const x = rep.ideal, ev = rep.ev;
  if (!ev) return null;
  const kind: ExampleKind = !ev.valid ? 'none' : x?.outcome === 'stop' ? 'loss' : 'win';
  const actions = (
    <div className="exActions">
      <button className="ghost" onClick={onNext}>Another (N)</button>
      {(['win', 'loss', 'none'] as const).filter((k) => k !== kind).map((k) => (
        <button key={k} className="ghost" onClick={() => onExample(k)}>{k === 'win' ? 'See a winner' : k === 'loss' ? 'See a valid one that lost' : 'See a no-trade one'}</button>
      ))}
      <button className="primary" onClick={onPractice}>Practice this setup</button>
    </div>
  );
  if (!x || !ev.valid) return (
    <div className="box exampleCard">
      <h4>Example: no trade</h4>
      <p className="small" dangerouslySetInnerHTML={{ __html: ev.why }} />
      <p className="muted small">This is what a fakeout or failed version looks like. The pattern started but broke a condition of the rule, so the right call was to pass. Blue dots and dashed lines mark what the rule saw. Press ↺ to replay it and practice spotting the failure.</p>
      {actions}
    </div>
  );
  return (
    <div className="box exampleCard">
      <h4>Example: a valid {x.side > 0 ? 'long' : 'short'}{kind === 'loss' ? ' that lost' : ''}</h4>
      <p className="small" dangerouslySetInnerHTML={{ __html: ev.why }} />
      <TextbookTrade rep={rep} />
      {x.outcome === 'stop' && <p className="small lossNote">This was the right trade, and it still lost. Every rule was met; the market just didn't follow through. That's normal: valid setups lose often, and a −1R loss with the stop where it belongs is a well-played trade. The edge comes from taking every valid one with the same risk, not from avoiding losers. Drills grade you on taking it, not on the result.</p>}
      <p className="muted small">Blue dots and dashed lines mark the pattern the rule saw; the square marks the trigger candle. Press ↺ to replay it from the start and watch it form.</p>
      {actions}
    </div>
  );
}

export function Session({ rep, onHome, onNext, onExample, onPractice }: Props) {
  const version = useSyncExternalStore(rep.subscribe, rep.getVersion);
  // Setup drills open on the candle size their rule uses; free play keeps your last timeframe.
  const [tf, setTfState] = useState<TF>(() => (rep.ev ? ((rep.ev.barMin ?? 1) as TF) : store.get<TF>('drill.tf', 5)));
  // Setup drills show their own indicators (remembered per setup); free play uses your general setup.
  const [cfg, setCfgState] = useState<IndicatorConfig>(() => loadIndicators(rep.def ?? undefined));
  const [hist, setHist] = useState<History>(EMPTY_HISTORY);
  const [histLoading, setHistLoading] = useState(true);
  const [showInd, setShowInd] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [sheetHidden, setSheetHidden] = useState(false);
  const [tool, setTool] = useState<Tool>('cursor');
  const [drawings, setDrawingsState] = useState<Drawing[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [bottomOpen, setBottomOpen] = useState(() => store.get('drill.bottomOpen', true));

  const setTf = (t: TF) => { setTfState(t); store.set('drill.tf', t); };
  const setCfg = (c: IndicatorConfig) => { setCfgState(c); saveIndicators(c, rep.def?.id); };
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
      if (e.altKey && code === 'KeyB') { e.preventDefault(); setTool('rect'); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((k === 'delete' || k === 'backspace') && selected) { setDrawingsState((ds) => ds.filter((d) => d.id !== selected)); setSelected(null); }
      else if (k === 'arrowright') { e.preventDefault(); if (e.shiftKey) rep.stepMinute(); else rep.stepBar(tf); }
      else if (k === ' ') { e.preventDefault(); rep.togglePlay(); }
      else if (k === '+' || k === '=') rep.nudgeSpeed(1);
      else if (k === '-' || k === '_') rep.nudgeSpeed(-1);
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
          {/* Blind mode hides the ticker and date only where it matters: drills and free play. Study modes show them. */}
          <b>{settings.blind && !rep.example ? '???' : rep.day.sym}</b>
          <span className="muted small">{settings.blind && !rep.example ? 'hidden date' : rep.day.date}</span>
        </div>
        <div className="sep" />
        <span className="tfGroup" title="Timeframe (keys 1–6)">
          {TFS.map((t) => <button key={String(t)} className={`tbtn ${t === tf ? 'on' : ''}`} onClick={() => setTf(t)}>{tfLabel(t)}</button>)}
        </span>
        <div className="sep" />
        <button className="tbtn" onClick={() => setShowInd(true)} title="Indicators (I)">ƒx Indicators</button>
        <button className="tbtn" onClick={() => { rep.pause(); setShowReport(true); }} title="Report this chart as wrong for the strategy">⚑ Report</button>
        <div className="sep" />
        <span className="setupName">{rep.def?.label ?? FREE_PLAY.label}</span>
        {rep.example && <span className="exampleTag">{rep.tutorial ? 'Tutorial' : 'Example'}</span>}
        <span className="spacer" />
        <span className="quote mono">
          <b>{rep.last.toFixed(2)}</b>
          {chg != null && <span className={chg >= 0 ? 'up' : 'down'}> {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>}
          <span className="muted"> · RVol <span className={rv >= 1.5 ? 'up' : ''}>{rv.toFixed(1)}×</span></span>
        </span>
        {rep.example
          ? <button className="tbtn accent" onClick={onPractice}>Practice this setup</button>
          : !rep.done
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
              {SPEEDS.map((s) => <option key={s} value={s}>{speedLabel(s)}</option>)}
            </select>
            <span className="rclock mono">{rep.sub >= 0 ? `${hhmm(rep.cur + 1)}:${String(rep.seconds).padStart(2, '0')}` : `${hhmm(rep.cur + 1)}:00`}</span>
            <span className="muted small">{rep.done ? 'done' : rep.overtime ? 'in trade: runs until it closes' : `${rep.endIdx - rep.cur} min left`}</span>
          </div>
        </ChartPane>
      </main>

      {/* ---------- Right panel ---------- */}
      <aside className="tvRight">
        {rep.tutorial ? <TutorialCard rep={rep} onNext={onNext} onPractice={onPractice} onLoss={() => onExample('loss')} />
          : rep.example ? <ExampleCard rep={rep} onNext={onNext} onExample={onExample} onPractice={onPractice} />
          : rep.pos ? <PositionCard rep={rep} onOrder={onOrder} /> : !rep.done && <OrderTicket rep={rep} onOrder={onOrder} />}

        {rep.ev && rep.def && (
          <details className="box" open>
            <summary><h4>The rule</h4></summary>
            <div className="ruleText" dangerouslySetInnerHTML={{ __html: rep.def.rule({ orMin: settings.orMin, barMin: rep.ev.barMin ?? 1 }) }} />
            <div className="muted small" style={{ marginTop: 6 }}>Some charts have no valid setup. Graded on the decision, not the P&amp;L.</div>
          </details>
        )}

        {rep.def && !rep.tutorial && <HowTo id={rep.def.id} />}

        {!rep.example && <div className="box">
          <h4>This rep</h4>
          <div className="kv"><span className="muted">Trades</span><span className="mono">{rep.trades.length}</span></div>
          <div className="kv"><span className="muted">Net</span><span className={`mono ${cls(rep.realized)}`}>{usd(rep.realized, true)} · {fmtR(rep.netR)}</span></div>
        </div>}
        <details className="keys">
          <summary>Keyboard shortcuts</summary>
          <kbd>→</kbd> next candle · <kbd>⇧→</kbd> 1 min · <kbd>Space</kbd> play · <kbd>+</kbd>/<kbd>−</kbd> speed · <kbd>1</kbd>–<kbd>6</kbd> timeframe · <kbd>B</kbd>/<kbd>S</kbd> buy/short · <kbd>F</kbd> close · <kbd>R</kbd> restart · <kbd>I</kbd> indicators · <kbd>Alt+T</kbd> trend line · <kbd>Alt+H</kbd> horizontal line · <kbd>Alt+B</kbd> box · <kbd>Del</kbd> delete drawing · <kbd>E</kbd> grade · <kbd>N</kbd> next rep
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
            {/* Notes and tags first, so they're in view without scrolling (long sheets pushed them off screen). */}
            {!rep.journalId && rep.journaled && <p className="muted small">Restarted chart: this run is practice and isn't saved to your journal (only the first run counts).</p>}
            {rep.journalId && (
              <div className="sheetReview">
                <h4>Review <span className="muted small">saved to your journal</span></h4>
                <ReviewBox entryId={rep.journalId} compact />
              </div>
            )}
            <ul className="feedback">{res.notes.map((n, i) => <li key={i} dangerouslySetInnerHTML={{ __html: n }} />)}</ul>
            {rep.ev && (
              <div className="box sheetTextbook">
                <h4>{rep.ev.valid ? `What the textbook trade looked like (${rep.ideal!.side > 0 ? 'long' : 'short'})` : 'Why there was no trade'}</h4>
                <p className="small" dangerouslySetInnerHTML={{ __html: rep.ev.why }} />
                <TextbookTrade rep={rep} />
                {preStartNote(rep) && <p className="muted small">{preStartNote(rep)}</p>}
                {rep.ev.valid && <p className="muted small">Click <b>Look at chart</b>: the shaded box marks it (red = entry to stop, green = entry to target), with the numbered points in blue.</p>}
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

      {showReport && <ReportChart rep={rep} onClose={() => setShowReport(false)} />}
      {showInd && <IndicatorPanel cfg={cfg} onChange={setCfg} onClose={() => setShowInd(false)}
        setupLabel={rep.def?.label} onReset={rep.def ? () => setCfgState(resetIndicators(rep.def!)) : undefined} />}
    </div>
  );
}
