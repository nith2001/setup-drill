import { useEffect, useState } from 'react';
import type { Side } from '../core/types';
import { MAX_CONTRACTS, rPerShare, type OrderSettings, type Replay } from '../engine/replay';
import { fmtMove, PNL_VIEWS, rrRatio, toTicks } from './pnl';
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
        <span className="small">{p.qty ? `${rep.contracts} ct · ${p.qty} sh · ${toTicks(Math.abs(p.entry - p.stop))}t stop` : '–'}</span>
      </button>
    );
  };

  return (
    <div className="box ticket">
      <div className="ticketHead"><h4>Market order</h4><span className="muted small">Stop &amp; target appear after entry</span></div>
      <div className="orderBtns">{btn(-1)}{btn(1)}</div>
      {(buy.error || sell.error) && <div className="ticketErr">{buy.error ?? sell.error}</div>}

      <div className="field">
        <span className="muted" title="One contract risks your risk-per-trade at the stop (1R). Two contracts risk 2R.">Contracts</span>
        <span className="stepper">
          <button className="chip" disabled={rep.contracts <= 1} onClick={() => onOrder({ contracts: rep.contracts - 1 })} aria-label="One fewer contract">−</button>
          <b className="mono">{rep.contracts}</b>
          <button className="chip" disabled={rep.contracts >= MAX_CONTRACTS} onClick={() => onOrder({ contracts: rep.contracts + 1 })} aria-label="One more contract">+</button>
        </span>
        <span className="muted small">1 contract = 1R</span>
      </div>
      {[buy, sell].some((p) => p.qty > 0 && p.qty < rep.contracts * p.unitQty) && <div className="muted small">Buying power caps the size: the button shows the shares you'd actually get.</div>}

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
      <div className="kv small"><span className="muted">Initial stop</span><span>5-candle high/low</span></div>
      <div className="field"><span className="muted">Live P&amp;L in</span><PnlViewSwitch rep={rep} onOrder={onOrder} /></div>
      <div className="kv small"><span className="muted">Risk / reward{o.tpOn ? ` (R:R ${o.rr}:1)` : ''}</span>
        <span className="mono"><span className="down">{usd(buy.riskUsd || sell.riskUsd)}</span>{o.tpOn && <> / <span className="up">{usd(buy.rewardUsd ?? sell.rewardUsd ?? 0)}</span></>}</span></div>
      <div className="muted small">After entry, drag the SL / TP lines on the chart to adjust.</div>
    </div>
  );
}

export function PositionCard({ rep, onOrder }: Props) {
  const p = rep.pos!;
  const say = (err: string | null) => { if (err) toast(err); };
  const move = p.side * (rep.last - p.entry), view = rep.order.pnlView;
  const mv = (m: number) => fmtMove(view, m, p.qty, rPerShare(p));
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
      <RiskReward rep={rep} />
      <div className="chips">
        <button className="chip" onClick={() => say(rep.breakeven())}>Stop to breakeven</button>
        {p.target != null && <button className="chip" onClick={() => rep.setTarget(null)}>Remove TP</button>}
      </div>
      <button className="submit flat" onClick={() => rep.flatten()}>Close position <kbd>F</kbd></button>
    </div>
  );
}

/**
 * One reward : risk ratio from entry, stop and target as they stand (moves with either line), plus the trade's
 * 1R: the risk when you entered, which the journal measures every result in.
 */
function RiskReward({ rep }: { rep: Replay }) {
  const p = rep.pos!, r1 = rPerShare(p), units = p.qty / p.unitQty;
  const riskNow = p.side * (p.entry - p.stop), nowR = riskNow / r1, entryR = p.risk / r1;
  const rr = p.target != null ? rrRatio(p.side, p.entry, p.stop, p.target) : null;
  const moved = Math.abs(p.stop - p.stop0) >= 0.005;
  const ct = (n: number) => `${+n.toFixed(2)} contract${n === 1 ? '' : 's'}`;
  return (
    <div className="rrBox">
      <div className="kv"><span className="muted">R:R</span>
        <b className="mono">{p.target == null ? 'no target' : rr ?? 'no risk (stop at or past entry)'}</b></div>
      <div className="kv small"><span className="muted">1R (one contract's risk)</span>
        <span className="mono">{toTicks(p.risk)} ticks · {usd(p.risk * p.unitQty)}</span></div>
      {units !== 1 && <div className="kv small"><span className="muted">Size</span><span className="mono">{ct(units)} · risk {entryR.toFixed(1)}R ({usd(p.risk * p.qty)})</span></div>}
      {moved && <div className="kv small"><span className="muted">Risk now</span>
        <span className={`mono ${nowR > entryR + 0.005 ? 'down' : ''}`}>{riskNow > 0 ? `${toTicks(riskNow)} ticks · ${usd(riskNow * p.qty)} · ${nowR.toFixed(1)}R${nowR > entryR + 0.005 ? ' (more than planned)' : ''}` : 'none: stop at or past entry'}</span></div>}
    </div>
  );
}
