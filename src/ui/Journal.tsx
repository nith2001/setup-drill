// Trade diary: progress over time, per-setup breakdown, and every rep with notes and tags.
import { Fragment, useMemo, useState, useSyncExternalStore } from 'react';
import { equityCurve, summarize, TAGS, tagCounts, toCsv, type JournalEntry } from '../core/journal';
import { FREE_PLAY, SETUPS } from '../setups';
import { deleteEntry, download, journal, journalVersion, subscribeJournal, updateEntry } from './journalStore';
import { money } from './pnl';
import { cls, fmtR } from './state';

const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const RANGES: [string, number][] = [['7 days', 7], ['30 days', 30], ['All time', 0]];

export const useJournal = () => { useSyncExternalStore(subscribeJournal, journalVersion); return journal; };

function Tile({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return <div className="tile"><div className="tileLabel">{label}</div><div className={`tileValue mono ${tone ?? ''}`}>{value}</div>{sub && <div className="tileSub">{sub}</div>}</div>;
}

/** Cumulative P&L line with a zero baseline. */
function EquityCurve({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="muted empty">Take a few trades to see your equity curve.</div>;
  const W = 900, H = 180, pad = 8;
  const lo = Math.min(0, ...points), hi = Math.max(0, ...points), span = hi - lo || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - 2 * pad);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = points[points.length - 1], col = last >= 0 ? 'var(--up)' : 'var(--down)';
  return (
    <svg className="curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Cumulative P&L ${money(last)} over ${points.length - 1} trades`}>
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="4 4" />
      <path d={`${d}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={col} opacity={0.1} />
      <path d={d} fill="none" stroke={col} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Notes + tags for one rep. Used in the journal and on the grade sheet. */
export function ReviewBox({ entryId, compact }: { entryId: string; compact?: boolean }) {
  const j = useJournal();
  const e = j.entries.find((x) => x.id === entryId);
  const [draft, setDraft] = useState<string | null>(null);
  if (!e) return null;
  const toggle = (t: string) => updateEntry(e.id, { tags: e.tags.includes(t) ? e.tags.filter((x) => x !== t) : [...e.tags, t] });
  return (
    <div className={`review ${compact ? 'compact' : ''}`}>
      <div className="chips">{TAGS.map((t) => <button key={t} className={`chip ${e.tags.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)}>{t}</button>)}</div>
      <textarea className="notes" placeholder="What did you see? What would you do differently?" value={draft ?? e.notes}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={() => { if (draft != null && draft !== e.notes) updateEntry(e.id, { notes: draft }); setDraft(null); }}
        onKeyDown={(ev) => ev.stopPropagation()} />
    </div>
  );
}

function RepDetail({ e }: { e: JournalEntry }) {
  return (
    <div className="repDetail">
      {e.trades.length ? (
        <table className="tvTable"><tbody>
          <tr><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Stop</th><th>In → out</th><th>Ticks</th><th>P&amp;L</th><th>R</th><th>Exit</th></tr>
          {e.trades.map((t, i) => (
            <tr key={i}>
              <td className={t.side > 0 ? 'up' : 'down'}>{t.side > 0 ? 'Long' : 'Short'}</td><td className="mono">{t.qty}</td>
              <td className="mono">{t.entry.toFixed(2)}</td><td className="mono">{t.exit.toFixed(2)}</td><td className="mono">{t.stop0.toFixed(2)}</td>
              <td className="mono">{t.inAt} → {t.outAt}</td>
              <td className={`mono ${cls(t.ticks)}`}>{t.ticks > 0 ? '+' : ''}{t.ticks}</td>
              <td className={`mono ${cls(t.pnl)}`}>{money(t.pnl)}</td><td className={`mono ${cls(t.R)}`}>{fmtR(t.R)}</td><td>{t.reason}</td>
            </tr>
          ))}
        </tbody></table>
      ) : <div className="muted small">{e.valid === false ? 'No trade taken (this chart had no valid setup).' : 'No trades.'}</div>}
      <ReviewBox entryId={e.id} />
      <div className="detailFoot">
        <span className="muted small">{e.sym} · {e.date}{e.attempt > 1 ? ` · attempt ${e.attempt}` : ''} · finished {new Date(e.ts).toLocaleString()}</span>
        <button className="linkbtn danger" onClick={() => { if (confirm('Delete this rep from your journal?')) deleteEntry(e.id); }}>Delete</button>
      </div>
    </div>
  );
}

export function Journal() {
  const j = useJournal();
  const [range, setRange] = useState(0);
  const [setup, setSetup] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);

  const es = useMemo(() => {
    const since = range ? Date.now() - range * 864e5 : 0;
    return j.entries.filter((e) => e.ts >= since && (setup === 'all' || e.setup === setup));
  }, [j.entries, j.version, range, setup]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = summarize(es);
  const setupIds = [FREE_PLAY.id, ...SETUPS.map((x) => x.id)];
  const label = (id: string) => (id === FREE_PLAY.id ? FREE_PLAY.label : SETUPS.find((x) => x.id === id)?.label ?? id);
  const bySetup = setupIds.map((id) => ({ id, s: summarize(es.filter((e) => e.setup === id)) })).filter((r) => r.s.reps);
  const tags = tagCounts(es);
  const rows = [...es].sort((a, b) => b.ts - a.ts);
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1>Journal</h1>
          <div className="muted small">
            {j.mode === 'file' ? <>Saved on this computer in <code>journal/journal.json</code></> : <>Saved in this browser only (dev server not reachable)</>}
          </div>
        </div>
        <div className="headActions">
          <button className="ghost" disabled={!j.entries.length} onClick={() => download(`trade-journal-${stamp}.csv`, toCsv(j.entries), 'text/csv')}>Export CSV</button>
          <button className="ghost" disabled={!j.entries.length} onClick={() => download(`trade-journal-${stamp}.json`, JSON.stringify({ entries: j.entries }, null, 1), 'application/json')}>Export JSON</button>
        </div>
      </div>

      <div className="filters">
        <span className="seg">{RANGES.map(([l, d]) => <button key={l} className={range === d ? 'on' : ''} onClick={() => setRange(d)}>{l}</button>)}</span>
        <select className="sel" value={setup} onChange={(e) => setSetup(e.target.value)}>
          <option value="all">All setups</option>
          {setupIds.map((id) => <option key={id} value={id}>{label(id)}</option>)}
        </select>
      </div>

      {!j.entries.length ? (
        <div className="emptyState">Nothing here yet. Finish a rep in <b>Practice</b> and it will show up here, with every trade, your grade, and space for notes.</div>
      ) : (
        <>
          <div className="tiles">
            <Tile label="Net P&L" value={money(s.netUsd)} tone={cls(s.netUsd)} sub={`${fmtR(s.netR)} over ${s.trades} trades`} />
            <Tile label="Win rate" value={pct(s.winRate)} sub={`${s.wins} W · ${s.losses} L`} />
            <Tile label="Avg win" value={s.avgWinUsd == null ? '–' : money(s.avgWinUsd)} tone="up"
              sub={`avg loss ${s.avgLossUsd == null ? '–' : money(s.avgLossUsd)}${s.profitFactor == null ? '' : ` · PF ${s.profitFactor.toFixed(2)}`}`} />
            <Tile label="Avg R per trade" value={s.avgR == null ? '–' : fmtR(s.avgR)} tone={s.avgR == null ? '' : cls(s.avgR)} />
            <Tile label="Right calls" value={pct(s.callRate)} sub={s.calls ? `${s.rightCalls} of ${s.calls} setup charts` : 'setup drills only'} />
            <Tile label="Reps" value={String(s.reps)} sub={s.avgScore == null ? undefined : `avg score ${Math.round(s.avgScore)}`} />
          </div>

          <section className="panelCard">
            <h3>Equity curve <span className="muted small">cumulative P&amp;L, trade by trade</span></h3>
            <EquityCurve points={equityCurve(es)} />
          </section>

          <div className="twoCol">
            <section className="panelCard">
              <h3>By setup</h3>
              <table className="tvTable"><tbody>
                <tr><th>Setup</th><th>Reps</th><th>Right calls</th><th>Win rate</th><th>Net</th><th>Avg score</th></tr>
                {bySetup.map(({ id, s: x }) => (
                  <tr key={id} className="clickable" onClick={() => setSetup(id)}>
                    <td>{label(id)}</td><td className="mono">{x.reps}</td><td className="mono">{pct(x.callRate)}</td><td className="mono">{pct(x.winRate)}</td>
                    <td className={`mono ${cls(x.netUsd)}`}>{money(x.netUsd)}</td><td className="mono">{x.avgScore == null ? '–' : Math.round(x.avgScore)}</td>
                  </tr>
                ))}
              </tbody></table>
            </section>
            <section className="panelCard">
              <h3>Your patterns <span className="muted small">tags you've used</span></h3>
              {tags.length ? <div className="tagCloud">{tags.map(([t, n]) => <span key={t} className="chip static">{t} <b>{n}</b></span>)}</div>
                : <div className="muted small">Tag your reps after grading (Followed plan, Chased, FOMO…) to see your habits here.</div>}
            </section>
          </div>

          <section className="panelCard">
            <h3>Reps <span className="muted small">click a row for trades, notes and tags</span></h3>
            <table className="tvTable reps"><tbody>
              <tr><th>When</th><th>Setup</th><th>Chart</th><th>Grade</th><th>Trades</th><th>P&amp;L</th><th>R</th><th>Tags</th></tr>
              {rows.slice(0, limit).map((e) => (
                <Fragment key={e.id}>
                  <tr className={`clickable ${open === e.id ? 'open' : ''}`} onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <td className="mono small">{new Date(e.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {new Date(e.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</td>
                    <td>{e.setupLabel}</td>
                    <td className="mono small">{e.sym} {e.date}</td>
                    <td className={e.correct == null ? '' : e.correct ? 'up' : 'down'}>{e.grade || '–'}{e.score != null && <span className="muted"> · {e.score}</span>}</td>
                    <td className="mono">{e.trades.length}</td>
                    <td className={`mono ${cls(e.netUsd)}`}>{money(e.netUsd)}</td>
                    <td className={`mono ${cls(e.netR)}`}>{fmtR(e.netR)}</td>
                    <td className="small">{e.tags.join(', ')}{e.notes && !e.notes.startsWith('Imported') && <span title={e.notes}> 📝</span>}</td>
                  </tr>
                  {open === e.id && <tr className="detailRow"><td colSpan={8}><RepDetail e={e} /></td></tr>}
                </Fragment>
              ))}
            </tbody></table>
            {rows.length > limit && <button className="ghost small" onClick={() => setLimit(limit + 100)}>Show more ({rows.length - limit} older)</button>}
          </section>
        </>
      )}
    </div>
  );
}
