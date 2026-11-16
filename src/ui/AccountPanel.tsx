import { useState } from 'react';
import { hhmm } from '../core/day';
import type { Replay } from '../engine/replay';
import { usd } from './OrderTicket';
import { fmtMove } from './pnl';

const cls = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export function AccountPanel({ rep, open, setOpen }: { rep: Replay; open: boolean; setOpen: (o: boolean) => void }) {
  const [tab, setTab] = useState<'pos' | 'hist'>('pos');
  const p = rep.pos, view = rep.order.pnlView, usdView = view === 'usd';
  // Balance only moves when a trade closes; open P&L is shown in the chosen unit.
  const openMove = p ? p.side * (rep.last - p.entry) : 0;
  return (
    <section className="tvBottom">
      <div className="bottomBar">
        <button className={`btab ${tab === 'pos' ? 'on' : ''}`} onClick={() => { setTab('pos'); setOpen(true); }}>Positions {p ? '(1)' : ''}</button>
        <button className={`btab ${tab === 'hist' ? 'on' : ''}`} onClick={() => { setTab('hist'); setOpen(true); }}>History ({rep.trades.length})</button>
        <span className="spacer" />
        <span className="acctItem">Balance <b className="mono">{usd(rep.balance)}</b></span>
        {usdView && <span className="acctItem">Equity <b className="mono">{usd(rep.equity)}</b></span>}
        <span className="acctItem">Realized <b className={`mono ${cls(rep.realized)}`}>{usd(rep.realized, true)}</b></span>
        <span className="acctItem">Open <b className={`mono ${cls(openMove)}`}>{p ? fmtMove(view, openMove, p.qty, p.risk) : '–'}</b></span>
        <button className="btab" onClick={() => setOpen(!open)} title={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▴'}</button>
      </div>
      {open && (
        <div className="bottomBody">
          {tab === 'pos' ? (
            p ? (
              <table className="tvTable"><tbody>
                <tr><th>Side</th><th>Qty</th><th>Entry</th><th>Last</th><th>Stop</th><th>Target</th><th>Open</th><th>R</th></tr>
                <tr>
                  <td className={p.side > 0 ? 'up' : 'down'}>{p.side > 0 ? 'Long' : 'Short'}</td><td className="mono">{p.qty}</td>
                  <td className="mono">{p.entry.toFixed(2)}</td><td className="mono">{rep.last.toFixed(2)}</td>
                  <td className="mono">{p.stop.toFixed(2)}</td><td className="mono">{p.target?.toFixed(2) ?? '–'}</td>
                  <td className={`mono ${cls(openMove)}`}>{fmtMove(view, openMove, p.qty, p.risk)}</td>
                  <td className={`mono ${cls(openMove)}`}>{(openMove / p.risk).toFixed(2)}</td>
                </tr>
              </tbody></table>
            ) : <div className="muted empty">No open position</div>
          ) : rep.trades.length ? (
            <table className="tvTable"><tbody>
              <tr><th>#</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>In / out</th><th>Ticks</th><th>P&amp;L</th><th>R</th><th>Exit reason</th></tr>
              {rep.trades.map((t, i) => (
                <tr key={i}>
                  <td>{i + 1}</td><td className={t.side > 0 ? 'up' : 'down'}>{t.side > 0 ? 'Long' : 'Short'}</td><td className="mono">{t.qty}</td>
                  <td className="mono">{t.entry.toFixed(2)}</td><td className="mono">{t.exit.toFixed(2)}</td>
                  <td className="mono">{hhmm(t.entryIdx)} → {hhmm(t.exitIdx)}</td>
                  <td className={`mono ${cls(t.pnl)}`}>{fmtMove('ticks', t.side * (t.exit - t.entry), t.qty, 1)}</td>
                  <td className={`mono ${cls(t.pnl)}`}>{usd(t.pnl, true)}</td><td className={`mono ${cls(t.R)}`}>{t.R.toFixed(2)}</td><td>{t.reason}</td>
                </tr>
              ))}
            </tbody></table>
          ) : <div className="muted empty">No trades yet</div>}
        </div>
      )}
    </section>
  );
}
