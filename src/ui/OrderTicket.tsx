import { useEffect, useState } from 'react';
import type { Side } from '../core/types';
import type { OrderSettings, Replay } from '../engine/replay';
import { fmtMove, PNL_VIEWS, toTicks } from './pnl';
import { toast } from './state';

export const usd = (v: number, sign = false) =>
  `${sign ? (v >= 0 ? '+' : '−') : v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Number input that commits on Enter/blur and resyncs when the source value changes. */
function NumField({ value, onCommit, step = 0.01, width = 92, placeholder, dp = 2 }: { value: number | null; onCommit: (n: number) => void; step?: number; width?: number; placeholder?: string; dp?: number | null }) {
  const show = (v: number | null) => (v == null ? '' : dp == null ? String(v) : v.toFixed(dp));
  const [draft, setDraft] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(show(value)); }, [value, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => { const n = Number(draft); if (draft !== '' && isFinite(n)) onCommit(n); };
  return (
    <input className="numIn" style={{ width }} type="number" step={step} value={draft} placeholder={placeholder}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); commit(); }}
      onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

interface Props { rep: Replay; onOrder: (patch: Partial<OrderSettings>) => void }

/** Ticks / $ / R switch for how live P&L is shown. */
function PnlViewSwitch({ rep, onOrder }: Props) {
  return (
    <span className="seg small" title="How open P&L is shown while in a trade">
      {PNL_VIEWS.map(([v, label]) => <button key={v} className={rep.order.pnlView === v ? 'on' : ''} onClick={() => onOrder({ pnlView: v })}>{label}</button>)}
    </span>
  );
}

export function OrderTicket({ rep, onOrder }: Props) {
  const o = rep.order;
  const say = (err: string | null) => { if (err) toast(err); };
  const buy = rep.planFor(1), sell = rep.planFor(-1);
  const btn = (side: Side) => {
    const p = side > 0 ? buy : sell;
    return (
      <button className={`orderBtn ${side > 0 ? 'buy' : 'sell'}`} disabled={!!p.error || rep.done} title={p.error ?? undefined} onClick={() => say(rep.enter(side))}>
        <span>{side > 0 ? 'Buy' : 'Sell'} <kbd>{side > 0 ? 'B' : 'S'}</kbd></span>
        <b className="mono">{p.entry.toFixed(2)}</b>
        <span className="small">{p.qty ? `${p.qty} sh · ${toTicks(Math.abs(p.entry - p.stop))}t stop` : '–'}</span>
      </button>
    );
  };

  return (
    <div className="box ticket">
      <div className="ticketHead"><h4>Market order</h4><span className="muted small">Stop &amp; target appear after entry</span></div>
      <div className="orderBtns">{btn(-1)}{btn(1)}</div>
      {(buy.error || sell.error) && <div className="ticketErr">{buy.error ?? sell.error}</div>}

      <h4 className="sub">Trade settings</h4>
      <div className="field">
        <span className="muted">Risk per trade</span>
        <span className="seg small">
          <button className={o.riskMode === 'usd' ? 'on' : ''} onClick={() => onOrder({ riskMode: 'usd', risk: o.riskMode === 'usd' ? o.risk : Math.round((rep.balance * o.risk) / 100) })}>$</button>
          <button className={o.riskMode === 'pct' ? 'on' : ''} onClick={() => onOrder({ riskMode: 'pct', risk: o.riskMode === 'pct' ? o.risk : +((100 * o.risk) / rep.balance).toFixed(2) })}>%</button>
        </span>
        <NumField value={o.risk} dp={null} step={o.riskMode === 'usd' ? 25 : 0.1} width={80} onCommit={(n) => onOrder({ risk: Math.max(0, n) })} />
      </div>
      <div className="field">
        <label className="muted"><input type="checkbox" checked={o.tpOn} onChange={(e) => onOrder({ tpOn: e.target.checked })} /> Take profit</label>
        <span className="chips">{[1, 1.5, 2, 3].map((r) => <button key={r} disabled={!o.tpOn} className={`chip ${o.tpOn && o.rr === r ? 'on' : ''}`} onClick={() => onOrder({ rr: r })}>{r}R</button>)}</span>
      </div>
      <div className="kv small"><span className="muted">Initial stop</span><span>5-bar high/low</span></div>
      <div className="field"><span className="muted">Live P&amp;L in</span><PnlViewSwitch rep={rep} onOrder={onOrder} /></div>
      <div className="kv small"><span className="muted">Risk / reward</span>
        <span className="mono"><span className="down">{usd(buy.riskUsd || sell.riskUsd)}</span>{o.tpOn && <> / <span className="up">{usd(buy.rewardUsd ?? sell.rewardUsd ?? 0)}</span></>}</span></div>
      <div className="muted small">After entry, drag the SL / TP lines on the chart to adjust.</div>
    </div>
  );
}

export function PositionCard({ rep, onOrder }: Props) {
  const p = rep.pos!;
  const say = (err: string | null) => { if (err) toast(err); };
  const move = p.side * (rep.last - p.entry), view = rep.order.pnlView;
  const mv = (m: number) => fmtMove(view, m, p.qty, p.risk);
  return (
    <div className="box ticket">
      <div className="posHead">
        <span className={`posSide ${p.side > 0 ? 'up' : 'down'}`}>{p.side > 0 ? 'LONG' : 'SHORT'} {p.qty}</span>
        <span className="muted mono">@ {p.entry.toFixed(2)}</span>
      </div>
      <div className={`bigR mono ${move > 0 ? 'up' : move < 0 ? 'down' : ''}`}>{mv(move)}</div>
      <div className="field"><span className="muted">Show as</span><PnlViewSwitch rep={rep} onOrder={onOrder} /></div>
      <div className="field"><span className="muted sl">Stop loss</span><span className="muted small mono">{mv(p.side * (p.stop - p.entry))}</span><NumField value={p.stop} onCommit={(n) => say(rep.setStop(n))} /></div>
      <div className="field"><span className="muted tp">Take profit</span>{p.target != null && <span className="muted small mono">{mv(p.side * (p.target - p.entry))}</span>}<NumField value={p.target} placeholder="none" onCommit={(n) => say(rep.setTarget(n))} /></div>
      <div className="chips">
        <button className="chip" onClick={() => say(rep.breakeven())}>Stop to breakeven</button>
        {p.target != null && <button className="chip" onClick={() => rep.setTarget(null)}>Remove TP</button>}
      </div>
      <button className="submit flat" onClick={() => rep.flatten()}>Close position <kbd>F</kbd></button>
    </div>
  );
}
