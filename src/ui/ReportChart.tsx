// "Report this chart": sends what the rule saw on this chart, plus the owner's reasons, to reports/reports.jsonl.
import { useState } from 'react';
import { hhmm } from '../core/day';
import type { Replay } from '../engine/replay';
import { settings, toast } from './state';

const REASONS = [
  "Not a valid setup (shouldn't count)",
  'Should have been valid (marked no-trade)',
  'Points or labels in the wrong place',
  'Entry, stop or target looks wrong',
  'Explanation is confusing or wrong',
  'Chart or data looks broken',
];

/** Everything needed to find and re-run this chart later. */
function snapshot(rep: Replay, step?: string) {
  const ev = rep.ev, bm = ev?.barMin ?? 1, t = (i: number) => hhmm(i - bm + 1);
  return {
    mode: rep.tutorial ? 'tutorial' : rep.example ? 'example' : rep.def ? 'drill' : 'free play',
    setup: rep.setup, label: rep.def?.label ?? 'Free play', sym: rep.day.sym, date: rep.day.date,
    ruleCandles: bm, universe: settings.universe, at: hhmm(rep.cur), done: rep.done, tutorialStep: step,
    window: { start: hhmm(rep.startIdx), end: hhmm(rep.endIdx) },
    rule: ev && {
      valid: ev.valid, why: ev.why, startIdx: ev.startIdx, windowEnd: ev.windowEnd,
      ...(ev.valid ? { dir: ev.dir > 0 ? 'long' : 'short', trigger: t(ev.trigIdx), trigIdx: ev.trigIdx, refStop: ev.refStop, target: ev.target } : {}),
      marks: ev.marks?.map((m) => ({ text: m.text, candle: t(m.idx), idx: m.idx })),
      lines: ev.lines?.map((l) => ({ text: l.text, price: +l.price.toFixed(2) })),
    },
    ideal: rep.ideal && { entry: rep.ideal.entry, stop: rep.ideal.stop, target: rep.ideal.target, rr: +rep.ideal.rr.toFixed(2), outcome: rep.ideal.outcome, exit: hhmm(rep.ideal.exitIdx) },
    trades: rep.trades.map((x) => ({ side: x.side > 0 ? 'long' : 'short', entry: hhmm(x.entryIdx), exit: hhmm(x.exitIdx), R: +x.R.toFixed(2) })),
  };
}

export function ReportChart({ rep, step, onClose }: { rep: Replay; step?: string; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (r: string) => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));
  const send = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reasons: picked, note: note.trim(), ...snapshot(rep, step) }) });
      if (!r.ok) throw new Error(String(r.status));
      toast('Chart reported. Thanks! It\'s saved in reports/reports.jsonl.');
      onClose();
    } catch {
      toast('Could not save the report. Is the dev server running?');
      setBusy(false);
    }
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="panel reportPanel" onClick={(e) => e.stopPropagation()}>
        <div className="panelHead"><h3>Report this chart</h3><button className="ghost" onClick={onClose}>Cancel</button></div>
        <p className="muted small">What's wrong with it? This saves the chart and what the rule saw, so it can be checked and the rule fixed.</p>
        <div className="reportReasons">
          {REASONS.map((r) => (
            <label key={r} className="small"><input type="checkbox" checked={picked.includes(r)} onChange={() => toggle(r)} /> {r}</label>
          ))}
        </div>
        <textarea className="reportNote" rows={4} placeholder="Details (e.g. &quot;point 3 is one candle after point 2, not a real pullback&quot;)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="exActions">
          <button className="primary" disabled={busy || (!picked.length && !note.trim())} onClick={send}>Send report</button>
        </div>
      </div>
    </div>
  );
}
