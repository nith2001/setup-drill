import { MA_COLORS, type IndicatorConfig, type MAType } from '../core/overlays';

interface Props { cfg: IndicatorConfig; onChange: (c: IndicatorConfig) => void; onClose: () => void }

const num = (v: string, min = 1, max = 500) => Math.max(min, Math.min(max, Math.round(Number(v) || min)));

export function IndicatorPanel({ cfg, onChange, onClose }: Props) {
  const set = (fn: (c: IndicatorConfig) => void) => { const c = structuredClone(cfg); fn(c); onChange(c); };
  const addMA = () => set((c) => {
    const id = `ma${Date.now()}`;
    c.mas.push({ id, type: 'ema', period: 50, color: MA_COLORS[c.mas.length % MA_COLORS.length], on: true });
  });

  return (
    <div className="modal" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panelHead"><h3>Indicators</h3><button className="ghost" onClick={onClose}>Done</button></div>

        <h4>Moving averages</h4>
        {cfg.mas.map((m, i) => (
          <div className="indRow" key={m.id}>
            <input type="checkbox" checked={m.on} onChange={(e) => set((c) => { c.mas[i].on = e.target.checked; })} />
            <select value={m.type} onChange={(e) => set((c) => { c.mas[i].type = e.target.value as MAType; })}>
              <option value="ema">EMA</option><option value="sma">SMA</option>
            </select>
            <input className="numIn" type="number" min={1} max={500} value={m.period} onChange={(e) => set((c) => { c.mas[i].period = num(e.target.value); })} />
            <input type="color" value={m.color} onChange={(e) => set((c) => { c.mas[i].color = e.target.value; })} />
            <button className="linkbtn" onClick={() => set((c) => { c.mas.splice(i, 1); })}>Remove</button>
          </div>
        ))}
        <button className="ghost small" onClick={addMA}>+ Add moving average</button>

        <h4>Price chart</h4>
        <label className="indRow"><input type="checkbox" checked={cfg.vwap} onChange={(e) => set((c) => { c.vwap = e.target.checked; })} /> VWAP <span className="muted">(intraday charts)</span></label>
        <label className="indRow"><input type="checkbox" checked={cfg.or} onChange={(e) => set((c) => { c.or = e.target.checked; })} /> Opening range <span className="muted">(high/low of the first minutes; length in Settings)</span></label>
        <label className="indRow"><input type="checkbox" checked={cfg.volume} onChange={(e) => set((c) => { c.volume = e.target.checked; })} /> Volume</label>

        <h4>Lower panes</h4>
        <div className="indRow">
          <input type="checkbox" checked={cfg.rsi.on} onChange={(e) => set((c) => { c.rsi.on = e.target.checked; })} /> RSI
          <span className="muted">length</span><input className="numIn" type="number" min={2} value={cfg.rsi.period} onChange={(e) => set((c) => { c.rsi.period = num(e.target.value, 2, 100); })} />
        </div>
        <div className="indRow">
          <input type="checkbox" checked={cfg.macd.on} onChange={(e) => set((c) => { c.macd.on = e.target.checked; })} /> MACD
          <span className="muted">fast</span><input className="numIn" type="number" value={cfg.macd.fast} onChange={(e) => set((c) => { c.macd.fast = num(e.target.value, 2, 100); })} />
          <span className="muted">slow</span><input className="numIn" type="number" value={cfg.macd.slow} onChange={(e) => set((c) => { c.macd.slow = num(e.target.value, 2, 200); })} />
          <span className="muted">signal</span><input className="numIn" type="number" value={cfg.macd.signal} onChange={(e) => set((c) => { c.macd.signal = num(e.target.value, 2, 100); })} />
        </div>
        <p className="muted small">Indicators are calculated on the timeframe you're viewing, including the earlier days shown. Setup drill rules always use the 1-minute chart.</p>
      </div>
    </div>
  );
}
