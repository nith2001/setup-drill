// Practice: pick what to drill. Stats on each card come from the journal.
import { streakDays, summarize, type JournalEntry } from '../core/journal';
import { FREE_PLAY, SETUPS } from '../setups';
import { useJournal } from './Journal';
import { money } from './pnl';
import { app, cls, fmtR, poolSize } from './state';

interface Props { onStart: (id: string) => void; onJournal: () => void }

function Card({ id, label, blurb, entries, onStart }: { id: string; label: string; blurb: string; entries: JournalEntry[]; onStart: (id: string) => void }) {
  const mine = entries.filter((e) => e.setup === id), recent = mine.slice(-20);
  const s = summarize(recent), all = summarize(mine);
  const n = poolSize(id), ruled = id !== FREE_PLAY.id;
  return (
    <button className={`card ${n ? '' : 'disabled'}`} onClick={() => onStart(id)} disabled={!n}>
      <h3>{label}</h3>
      <p>{blurb}</p>
      <div className="stats">
        <div><b>{mine.length}</b>reps</div>
        {ruled
          ? <div><b>{s.callRate == null ? '–' : Math.round(s.callRate * 100) + '%'}</b>right calls (last 20)</div>
          : <div><b className={cls(all.netUsd)}>{all.trades ? money(all.netUsd) : '–'}</b>net</div>}
      </div>
      <span className="go">{!n ? 'No charts available' : ruled ? `${app.pools[id].valid.length} valid · ${app.pools[id].none.length} no-trade charts →` : `${n} days →`}</span>
    </button>
  );
}

export function Home({ onStart, onJournal }: Props) {
  const j = useJournal();
  const today = j.entries.filter((e) => new Date(e.ts).toDateString() === new Date().toDateString());
  const t = summarize(today), streak = streakDays(j.entries);

  const groups: Record<string, { id: string; label: string; blurb: string }[]> = { 'Free practice': [FREE_PLAY] };
  for (const s of SETUPS) (groups[s.group] ??= []).push(s);

  return (
    <div className="page">
      <div className="todayStrip">
        <div><span className="muted small">Today</span><b>{today.length} rep{today.length === 1 ? '' : 's'}</b></div>
        <div><span className="muted small">Today's P&amp;L</span><b className={`mono ${cls(t.netUsd)}`}>{t.trades ? money(t.netUsd) : '–'}</b></div>
        <div><span className="muted small">Today's R</span><b className={`mono ${cls(t.netR)}`}>{t.trades ? fmtR(t.netR) : '–'}</b></div>
        <div><span className="muted small">Streak</span><b>{streak ? `🔥 ${streak} day${streak === 1 ? '' : 's'}` : '–'}</b></div>
        <span className="spacer" />
        <button className="linkbtn" onClick={onJournal}>Open journal →</button>
      </div>

      {Object.entries(groups).map(([g, list]) => (
        <section key={g}>
          <h2 className="groupTitle">{g}</h2>
          <div className="cards">{list.map((s) => <Card key={s.id} {...s} entries={j.entries} onStart={onStart} />)}</div>
        </section>
      ))}
      <p className="muted small footnote">Setup drills: about half the charts have no valid setup. You're graded on the call (take it or pass), not the P&amp;L. Free practice: any day, any trade, scored on risk and execution.</p>
    </div>
  );
}
