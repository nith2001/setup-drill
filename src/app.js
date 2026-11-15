(() => {
const LC = LightweightCharts, $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const settings = Object.assign({ orMin: 15, repMin: 120, blind: 1 }, store.get('drill.settings', {}));
let history = store.get('drill.history', []);
let DATA, INDEX, S = null;
const RULED = ['orb', 'gap', 'vwap', 'ema', 'macd', 'rsi'], IND = ['ema', 'macd', 'rsi'];
const poolSize = (k) => Object.values(INDEX[k]).reduce((a, l) => a + l.length, 0);

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 1800); }
const fmtR = (r) => (r >= 0 ? '+' : '') + r.toFixed(2) + 'R';
const cls = (r) => (r > 0 ? 'up' : r < 0 ? 'down' : '');

// ---------- Data ----------
function loadData(ds) {
  DATA = ds;
  INDEX = { random: { all: [] } };
  for (const k of RULED) INDEX[k] = { valid: [], none: [] };
  DATA.days.forEach((d, i) => {
    if (d.c.length < 200) return;
    Core.prepDay(d);
    INDEX.random.all.push({ i });
    for (const k of RULED) { const ev = Core.evaluate(k, d, { orMin: settings.orMin }); if (ev) INDEX[k][ev.valid ? 'valid' : 'none'].push({ i, ev }); }
  });
  renderHome();
}

// ---------- Home ----------
function statsFor(setup) {
  const h = history.filter((x) => x.setup === setup);
  const scored = h.filter((x) => x.score != null).slice(-20);
  const dec = h.filter((x) => x.correct != null).slice(-20);
  return { reps: h.length, avg: scored.length ? Math.round(scored.reduce((a, x) => a + x.score, 0) / scored.length) : null, netR: h.reduce((a, x) => a + x.netR, 0),
           acc: dec.length ? Math.round((100 * dec.filter((x) => x.correct).length) / dec.length) : null };
}
function streakDays() {
  const days = new Set(history.map((x) => new Date(x.ts).toDateString()));
  let n = 0, d = new Date();
  if (!days.has(d.toDateString())) d = new Date(d - 864e5);
  while (days.has(d.toDateString())) { n++; d = new Date(d - 864e5); }
  return n;
}
function renderHome() {
  const real = DATA.meta.source !== 'synthetic demo';
  const syms = new Set(DATA.days.map((d) => d.sym)).size;
  $('#datapill').className = 'datapill' + (real ? ' real' : '');
  $('#datapill').innerHTML = `<span class="dot"></span>${real ? `<b>Real data</b> ${DATA.days.length} symbol-days · ${syms} symbols` : '<b>Demo data</b> randomly generated, not real prices'} · <button class="linkbtn" id="alpBtn">${real ? 'Reload' : 'Get real data (free)'}</button> · <button class="linkbtn" id="loadBtn">Load file</button>${real ? ' · <button class="linkbtn" id="clrBtn">Use demo</button>' : ''}`;
  $('#loadBtn').onclick = () => $('#fileIn').click();
  $('#alpBtn').onclick = () => $('#loader').classList.remove('hidden');
  if ($('#clrBtn')) $('#clrBtn').onclick = async () => { await idb.del(); loadData(Core.genDataset(Math.floor(Math.random() * 1e9), new Date().toISOString().slice(0, 10), 60)); };
  const card = ([k, s]) => {
    const st = statsFor(k), n = poolSize(k), ruled = RULED.includes(k);
    return `<button class="card ${n ? '' : 'disabled'}" data-setup="${k}"><h3>${s.label}</h3><p>${s.blurb}</p>
      <div class="stats"><div><b>${st.reps}</b>reps</div><div><b>${st.avg ?? '–'}</b>avg score</div>${ruled ? `<div><b>${st.acc == null ? '–' : st.acc + '%'}</b>right calls</div>` : `<div><b class="${cls(st.netR)}">${fmtR(st.netR)}</b>net</div>`}</div>
      <span class="go">${ruled ? `${INDEX[k].valid.length} valid · ${INDEX[k].none.length} no-trade charts →` : `${n} days →`}</span></button>`;
  };
  const groups = {};
  for (const e of Object.entries(Core.SETUPS)) (groups[e[1].group || 'Practice'] = groups[e[1].group || 'Practice'] || []).push(e);
  $('#cards').innerHTML = Object.entries(groups).map(([g, list]) => `<h2 style="grid-column:1/-1;margin:14px 0 0">${g}</h2>${list.map(card).join('')}`).join('');
  document.querySelectorAll('.card').forEach((c) => (c.onclick = () => startRep(c.dataset.setup)));
  document.querySelectorAll('#home .seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(settings[seg.dataset.set]) === b.dataset.v)));
  const s = streakDays();
  $('#streak').innerHTML = s ? `🔥 <b>${s}</b> day streak` : 'No streak yet';
  const rows = history.slice(-10).reverse();
  $('#history').innerHTML = rows.length ? `<table class="hist"><tr><th>Setup</th><th>Day</th><th>Call</th><th>Trades</th><th>Outcome</th><th>Score</th></tr>${rows.map((r) =>
    `<tr><td>${(Core.SETUPS[r.setup] || {}).label || r.setup}</td><td class="mono">${r.sym} ${r.date}</td><td class="${r.correct == null ? '' : r.correct ? 'up' : 'down'}">${r.verdict || '–'}</td><td>${r.trades}</td><td class="mono ${cls(r.netR)}">${fmtR(r.netR)}</td><td class="mono">${r.score ?? '–'}</td></tr>`).join('')}</table>` : 'No reps yet. Pick a setup above.';
}
document.querySelectorAll('#home .seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
  settings[seg.dataset.set] = Number(b.dataset.v); store.set('drill.settings', settings);
  if (seg.dataset.set === 'orMin') loadData(DATA); else renderHome();
})));
$('#fileIn').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  let txt = await f.text();
  txt = txt.replace(/^[^{]*/, '').replace(/;?\s*$/, '');
  try { loadData(JSON.parse(txt)); toast('Loaded ' + DATA.days.length + ' days'); } catch (err) { toast('Could not read that file'); }
};

// ---------- Chart ----------
const chart = LC.createChart($('#chart'), {
  autoSize: true,
  layout: { background: { color: '#0d1117' }, textColor: '#8b97a5' },
  grid: { vertLines: { color: '#161d26' }, horzLines: { color: '#161d26' } },
  timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 15, barSpacing: 7, borderColor: '#2a3440' },
  rightPriceScale: { borderColor: '#2a3440' },
  crosshair: { mode: 0 },
});
const candle = chart.addSeries(LC.CandlestickSeries, { upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
const vol = chart.addSeries(LC.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
const vwapS = chart.addSeries(LC.LineSeries, { color: '#f0b429', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
const markers = LC.createSeriesMarkers(candle, []);
let lines = {}, indSeries = [];
function setupIndicators() {
  for (const x of indSeries) chart.removeSeries(x.s);
  indSeries = [];
  while (chart.panes().length > 1) chart.removePane(1);
  if (!S.ind) return;
  const base = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
  const add = (def, opts, pane, key, colorFn) => { const s = chart.addSeries(def, { ...base, ...opts }, pane); indSeries.push({ s, key, colorFn }); return s; };
  if (S.ind === 'ema') { add(LC.LineSeries, { color: '#58a6ff', lineWidth: 1, title: 'EMA 9' }, 0, 'e9'); add(LC.LineSeries, { color: '#f0b429', lineWidth: 2, title: 'EMA 20' }, 0, 'e20'); }
  if (S.ind === 'rsi') {
    add(LC.LineSeries, { color: '#c792ea', lineWidth: 2, title: 'SMA 50' }, 0, 'sma50');
    const r = add(LC.LineSeries, { color: '#c792ea', lineWidth: 1, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) }, 1, 'rsi');
    r.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 } });
    r.createPriceLine({ price: 30, color: '#26a69a', lineWidth: 1, lineStyle: 2, title: '30' });
    r.createPriceLine({ price: 70, color: '#ef5350', lineWidth: 1, lineStyle: 2, title: '70' });
  }
  if (S.ind === 'macd') {
    add(LC.HistogramSeries, {}, 1, 'hist', (v) => (v >= 0 ? 'rgba(38,166,154,.55)' : 'rgba(239,83,80,.55)'));
    const m = add(LC.LineSeries, { color: '#58a6ff', lineWidth: 1, title: 'MACD' }, 1, 'macd');
    add(LC.LineSeries, { color: '#f0b429', lineWidth: 1, title: 'signal' }, 1, 'sig');
    m.createPriceLine({ price: 0, color: '#6e7681', lineWidth: 1, lineStyle: 2, title: 'zero' });
  }
  if (chart.panes()[1]) chart.panes()[1].setHeight(140);
}
function indPoint(x, i) {
  const v = Core.indicators(S.day)[x.key][i], time = Core.dayStartTs(S.day.date) + i * 60;
  if (!isFinite(v)) return { time };
  const p = { time, value: v }; if (x.colorFn) p.color = x.colorFn(v); return p;
}
function setLine(key, price, color, title, style = 2) {
  if (lines[key]) candle.removePriceLine(lines[key]);
  lines[key] = price == null ? null : candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
}
function clearLines() { for (const k in lines) if (lines[k]) candle.removePriceLine(lines[k]); lines = {}; }

const toBar = (b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
const toVol = (b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(38,166,154,.35)' : 'rgba(239,83,80,.35)' });
const toVw = (b) => ({ time: b.time, value: Core.vwapAt(S.day, b.lastIdx) });
const barTime = (idx) => Core.dayStartTs(S.day.date) + Math.floor(idx / S.tf) * S.tf * 60;

function drawAll() {
  const agg = Core.aggregate(S.day, S.cur, S.tf);
  candle.setData(agg.map(toBar)); vol.setData(agg.map(toVol));
  vwapS.setData(S.showVwap ? agg.map(toVw) : []);
  for (const x of indSeries) x.s.setData(Array.from({ length: S.cur + 1 }, (_, i) => indPoint(x, i)));
  drawMarkers();
}
function drawLast() {
  const b = Core.bucketBar(S.day, Math.floor(S.cur / S.tf), S.tf, S.cur);
  candle.update(toBar(b)); vol.update(toVol(b)); if (S.showVwap) vwapS.update(toVw(b));
  for (const x of indSeries) x.s.update(indPoint(x, S.cur));
}
function drawMarkers() {
  const m = [];
  for (const t of S.trades) {
    m.push({ time: barTime(t.entryIdx), position: t.side > 0 ? 'belowBar' : 'aboveBar', color: t.side > 0 ? '#26a69a' : '#ef5350', shape: t.side > 0 ? 'arrowUp' : 'arrowDown', text: t.side > 0 ? 'B' : 'S' });
    m.push({ time: barTime(t.exitIdx), position: t.side > 0 ? 'aboveBar' : 'belowBar', color: '#c9d1d9', shape: 'circle', text: fmtR(t.R) });
  }
  if (S.pos) m.push({ time: barTime(S.pos.entryIdx), position: S.pos.side > 0 ? 'belowBar' : 'aboveBar', color: '#f0b429', shape: S.pos.side > 0 ? 'arrowUp' : 'arrowDown', text: 'open' });
  m.sort((a, b) => a.time - b.time);
  markers.setMarkers(m);
}
function levelLines() {
  const d = S.day;
  if (d.pc != null) setLine('pc', d.pc, '#6e7681', 'prev close', 1);
  if (!S.ind && S.cur >= settings.orMin - 1) {
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < settings.orMin; i++) { hi = Math.max(hi, d.h[i]); lo = Math.min(lo, d.l[i]); }
    if (!lines.orh) { setLine('orh', hi, '#58a6ff', `OR${settings.orMin} high`, 0); setLine('orl', lo, '#58a6ff', `OR${settings.orMin} low`, 0); S.or = { hi, lo }; }
  }
}

// ---------- Rep lifecycle ----------
function pickDay(setup) {
  const P = INDEX[setup];
  let pool = P.all;
  if (!pool) pool = (Math.random() < 0.5 && P.valid.length) || !P.none.length ? P.valid : P.none;
  const recent = new Set(history.slice(-60).map((x) => x.sym + x.date));
  const fresh = pool.filter((p) => !recent.has(DATA.days[p.i].sym + DATA.days[p.i].date));
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(Math.random() * list.length)];
}
function startRep(setup) {
  const pick = pickDay(setup); if (!pick) return;
  const day = DATA.days[pick.i];
  const ev = pick.ev || null;
  const start = ev ? ev.startIdx : 5 + Math.floor(Math.random() * 55);
  stopPlay();
  const ind = IND.includes(setup) ? setup : null;
  S = { setup, day, ev, ind, cur: start - 1, startIdx: start, tf: ind ? 1 : S ? S.tf : 1, showVwap: ind ? false : S ? S.showVwap : true,
        endIdx: Math.min(day.c.length - 1, ev ? ev.windowEnd : start - 1 + settings.repMin), pos: null, trades: [], stopPx: null, tgtR: S ? S.tgtR : 2, done: false, speed: S ? S.speed : 3 };
  $('#home').classList.add('hidden'); $('#session').classList.remove('hidden'); $('#result').classList.add('hidden');
  $('#setupName').textContent = Core.SETUPS[setup].label;
  $('#ruleBox').classList.toggle('hidden', !ev);
  if (ev) $('#ruleText').innerHTML = Core.SETUPS[setup].rule(settings);
  $('#symName').textContent = settings.blind ? '??? · hidden date' : `${day.sym} · ${day.date}`;
  clearLines(); setupIndicators(); drawAll(); levelLines();
  $('#tfSeg').style.display = ind ? 'none' : '';
  const frame = () => { const n = Math.floor(S.cur / S.tf) + 1; chart.timeScale().setVisibleLogicalRange({ from: n - 100, to: n + 15 }); };
  frame(); requestAnimationFrame(frame);
  syncControls(); hud();
}
function step() {
  if (!S || S.done) return;
  if (S.cur >= S.endIdx) return endRep();
  S.cur++;
  const d = S.day, i = S.cur;
  if (S.pos) {
    const p = S.pos, b = { o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i] };
    const res = Core.evalBar(p, b);
    const fav = p.side > 0 ? b.h - p.entry : p.entry - b.l, adv = p.side > 0 ? p.entry - b.l : b.h - p.entry;
    if (res) {
      if (res.reason === 'target') { p.mfe = Math.max(p.mfe, p.side * (res.price - p.entry)); p.mae = Math.max(p.mae, adv); }
      else p.mae = Math.max(p.mae, p.side * (p.entry - res.price));
      closePos(res.price, res.reason);
    } else { p.mfe = Math.max(p.mfe, fav); p.mae = Math.max(p.mae, adv); }
  }
  drawLast(); levelLines(); if (S.trades.length || S.pos) drawMarkers(); hud();
  if (S.cur >= S.endIdx) endRep();
}
const last = () => S.day.c[S.cur];
const slip = (px) => Math.max(0.01, px * 0.0002);
function enter(side) {
  if (!S || S.done || S.pos) return;
  if (S.stopPx == null) return toast('Place a stop first: click the chart');
  const entry = Core.r2(last() + side * slip(last())), risk = side * (entry - S.stopPx);
  if (risk <= 0) return toast(side > 0 ? 'Stop must be below price to buy' : 'Stop must be above price to short');
  if (risk < entry * 0.0005) return toast('Stop is too tight');
  const target = S.tgtR ? Core.r2(entry + side * risk * S.tgtR) : null;
  S.pos = { side, entry, stop: S.stopPx, stop0: S.stopPx, target, risk, mfe: 0, mae: 0, entryIdx: S.cur };
  setLine('stop', null); setLine('pstop', S.pos.stop, '#ef5350', 'stop', 0);
  setLine('entry', entry, '#c9d1d9', side > 0 ? 'long' : 'short', 1);
  if (target) setLine('tgt', target, '#26a69a', `${S.tgtR}R`, 0);
  drawMarkers(); hud();
}
function closePos(price, reason) {
  const p = S.pos;
  S.trades.push({ side: p.side, entry: p.entry, stop0: p.stop0, exit: price, R: (p.side * (price - p.entry)) / p.risk, mfeR: p.mfe / p.risk, maeR: Math.min(p.mae / p.risk, 5), entryIdx: p.entryIdx, exitIdx: S.cur, reason });
  S.pos = null; S.stopPx = null;
  ['pstop', 'entry', 'tgt', 'stop'].forEach((k) => setLine(k, null));
  drawMarkers(); hud();
}
function flatten() { if (S && S.pos) closePos(Core.r2(last() - S.pos.side * slip(last())), 'manual'); }

chart.subscribeClick((param) => {
  if (!S || S.done || !param.point) return;
  const px = Core.r2(candle.coordinateToPrice(param.point.y));
  if (!isFinite(px)) return;
  if (S.pos) {
    if (S.pos.side * (last() - px) <= 0) return toast('Stop would be on the wrong side of price');
    S.pos.stop = px; setLine('pstop', px, '#ef5350', 'stop', 0);
  } else { S.stopPx = px; setLine('stop', px, '#ef5350', 'planned stop', 2); }
  hud();
});

// ---------- Scoring / end ----------
function endRep() {
  if (!S || S.done) return;
  stopPlay(); if (S.pos) closePos(last(), 'end');
  S.done = true;
  const sc = Core.scoreRep(S.trades), ev = S.ev;
  let score, verdict = null, correct = null, parts, notes = [];
  if (ev) {
    const g = Core.gradeDecision(ev, S.trades, S.day);
    score = g.score; verdict = g.verdict; correct = g.correct; parts = g.parts; notes = g.notes;
    notes.unshift(`<b>${ev.valid ? 'Valid setup' : 'No valid setup'}:</b> ${ev.why}`);
    if (S.trades.length) notes.push(`Outcome (not graded): <b class="${cls(sc.netR)}">${fmtR(sc.netR)}</b>. A good decision can lose and a bad one can win.`);
  } else {
    score = sc.score; parts = sc.parts && { Result: [sc.parts.result, 50], Capture: [sc.parts.capture, 20], 'Heat taken': [sc.parts.heat, 15], Discipline: [sc.parts.discipline, 15] };
    notes = [...(sc.notes || [])];
    if (sc.captureAvg != null && S.trades.some((t) => t.R > 0)) notes.push(`You kept ${Math.round(sc.captureAvg * 100)}% of the best move available while you were in.`);
  }
  history.push({ setup: S.setup, sym: S.day.sym, date: S.day.date, trades: S.trades.length, netR: sc.netR, score, verdict, correct, ts: Date.now() });
  store.set('drill.history', history);
  // Reveal the rest of the day
  const revealed = S.cur; S.cur = S.day.c.length - 1; drawAll(); S.cur = revealed;
  if (ev && ev.valid) {
    const m = markers.markers().slice();
    m.push({ time: barTime(ev.trigIdx), position: ev.dir > 0 ? 'belowBar' : 'aboveBar', color: '#f0b429', shape: 'square', text: 'valid trigger' });
    m.sort((a, b) => a.time - b.time); markers.setMarkers(m);
  }
  chart.timeScale().fitContent();
  const grade = verdict || (score == null ? 'No trades' : score >= 85 ? 'Excellent' : score >= 70 ? 'Solid' : score >= 50 ? 'Okay' : 'Rough');
  $('#resultSheet').innerHTML = `
    <div class="resHead"><div class="score mono">${score ?? '–'}</div><div><div style="font-weight:700;font-size:17px" class="${correct == null ? '' : correct ? 'up' : 'down'}">${grade}${ev ? '' : ` · <span class="${cls(sc.netR)} mono">${fmtR(sc.netR)}</span>`}</div>
      <div class="grade">${S.day.sym} · ${S.day.date} · ${S.trades.length} trade${S.trades.length === 1 ? '' : 's'}</div></div></div>
    ${parts ? `<div class="bars">${Object.entries(parts).map(([n, [v, m]]) =>
      `<div class="bar">${n} <span class="mono" style="float:right">${Math.round(v)}/${m}</span><div class="track"><div class="fill" style="width:${(v / m) * 100}%"></div></div></div>`).join('')}</div>` : ''}
    <ul class="feedback">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
    <div class="resActions"><button class="ghost" id="rHome">Setups</button><button class="ghost" id="rHide">Look at chart</button><button class="primary" id="rNext">Next rep (N)</button></div>`;
  $('#result').classList.remove('hidden');
  $('#rNext').onclick = () => startRep(S.setup);
  $('#rHome').onclick = goHome;
  $('#rHide').onclick = () => $('#result').classList.add('hidden');
  hud();
}
function goHome() { stopPlay(); $('#session').classList.add('hidden'); $('#result').classList.add('hidden'); $('#home').classList.remove('hidden'); renderHome(); }

// ---------- HUD / controls ----------
function hud() {
  const lp = last();
  $('#clock').textContent = Core.hhmm(S.cur);
  $('#lastPx').textContent = lp.toFixed(2);
  const rv = Core.relVol(S.day, S.cur);
  $('#relVol').textContent = rv.toFixed(1) + '×'; $('#relVol').className = 'mono ' + (rv >= 1.5 ? 'up' : '');
  $('#stopPx').textContent = S.stopPx != null ? S.stopPx.toFixed(2) : 'click chart';
  $('#buyBtn').disabled = !!(S.done || S.pos || (S.stopPx != null && S.stopPx >= lp));
  $('#sellBtn').disabled = !!(S.done || S.pos || (S.stopPx != null && S.stopPx <= lp));
  $('#orderBox').classList.toggle('hidden', !!S.pos);
  $('#posBox').classList.toggle('hidden', !S.pos);
  if (S.pos) {
    const p = S.pos, r = (p.side * (lp - p.entry)) / p.risk;
    $('#posR').textContent = fmtR(r); $('#posR').className = 'bigR mono ' + cls(r);
    $('#posSide').textContent = p.side > 0 ? 'Long' : 'Short';
    $('#posEntry').textContent = p.entry.toFixed(2); $('#posStop').textContent = p.stop.toFixed(2);
    $('#posTgt').textContent = p.target ? p.target.toFixed(2) : '–';
  }
  const net = S.trades.reduce((a, t) => a + t.R, 0);
  $('#repTrades').textContent = S.trades.length;
  $('#repNet').textContent = fmtR(net); $('#repNet').className = 'mono ' + cls(net);
  $('#repLeft').textContent = S.done ? 'done' : `${S.endIdx - S.cur} min`;
  $('#hint').classList.toggle('hidden', S.stopPx != null || !!S.pos || S.done);
  // stop presets
  const chips = [];
  if (S.or && !S.ind) chips.push(['OR low', S.or.lo], ['OR high', S.or.hi]);
  let lo5 = Infinity, hi5 = -Infinity;
  for (let i = Math.max(0, S.cur - 4); i <= S.cur; i++) { lo5 = Math.min(lo5, S.day.l[i]); hi5 = Math.max(hi5, S.day.h[i]); }
  chips.push(['5-bar low', Core.r2(lo5 - 0.01)], ['5-bar high', Core.r2(hi5 + 0.01)]);
  $('#stopChips').innerHTML = chips.map(([n, v]) => `<button class="chip" data-p="${v}">${n}</button>`).join('');
  $('#stopChips').querySelectorAll('.chip').forEach((c) => (c.onclick = () => { S.stopPx = Number(c.dataset.p); setLine('stop', S.stopPx, '#ef5350', 'planned stop', 2); hud(); }));
}
function syncControls() {
  $('#tfSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === S.tf));
  $('#vwapSeg button').classList.toggle('on', S.showVwap);
  $('#speedChips').querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === S.speed));
  $('#tgtChips').querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === S.tgtR));
  $('#playBtn').textContent = S.timer ? 'Pause' : 'Play'; $('#playBtn').classList.toggle('on', !!S.timer);
}
function stopPlay() { if (S && S.timer) { clearInterval(S.timer); S.timer = null; syncControls(); } }
function togglePlay() {
  if (!S || S.done) return;
  if (S.timer) return stopPlay();
  S.timer = setInterval(step, 1000 / S.speed); syncControls();
}
$('#stepBtn').onclick = step; $('#playBtn').onclick = togglePlay;
$('#buyBtn').onclick = () => enter(1); $('#sellBtn').onclick = () => enter(-1);
$('#flatBtn').onclick = flatten; $('#endBtn').onclick = endRep; $('#homeBtn').onclick = goHome;
$('#tfSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => { S.tf = Number(b.dataset.v); drawAll(); syncControls(); }));
$('#vwapSeg button').onclick = () => { S.showVwap = !S.showVwap; drawAll(); syncControls(); };
$('#speedChips').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { S.speed = Number(b.dataset.v); if (S.timer) { stopPlay(); togglePlay(); } syncControls(); }));
$('#tgtChips').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { S.tgtR = Number(b.dataset.v); syncControls(); }));
document.addEventListener('keydown', (e) => {
  if (!S || $('#session').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowright') { e.preventDefault(); step(); }
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'b') enter(1); else if (k === 's') enter(-1);
  else if (k === 'f') flatten(); else if (k === 'e') endRep();
  else if (k === 'n' && S.done) startRep(S.setup);
});

// ---------- Real data: IndexedDB cache + Alpaca loader ----------
const idb = (() => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('drill', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { get: () => tx('readonly', (s) => s.get('data')).catch(() => null), set: (v) => tx('readwrite', (s) => s.put(v, 'data')).catch(() => null), del: () => tx('readwrite', (s) => s.delete('data')).catch(() => null) };
})();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function etMin(iso) { const p = etFmt.formatToParts(new Date(iso)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value - 570; }
async function alpacaGet(params, key, sec) {
  const url = 'https://data.alpaca.markets/v2/stocks/bars?' + new URLSearchParams(params);
  for (let a = 0; a < 5; a++) {
    const r = await fetch(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': sec } });
    if (r.status === 429) { await sleep(2000 + a * 3000); continue; }
    if (!r.ok) throw new Error(`Alpaca said ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
  }
  throw new Error('Rate limited by Alpaca. Try again in a minute.');
}
async function alpacaBars(syms, timeframe, start, end, key, sec) {
  const out = {}; let token = null;
  do {
    const p = { symbols: syms.join(','), timeframe, start, end, limit: 10000, adjustment: 'split', feed: 'sip' };
    if (token) p.page_token = token;
    const js = await alpacaGet(p, key, sec);
    for (const [s, b] of Object.entries(js.bars || {})) (out[s] = out[s] || []).push(...b);
    token = js.next_page_token; await sleep(320);
  } while (token);
  return out;
}
function toDay(sym, date, bars, pc) {
  const byMin = new Map();
  for (const b of bars) { const m = etMin(b.t); if (m >= 0 && m < 390) byMin.set(m, b); }
  if (byMin.size < 150) return null;
  const last = Math.max(...byMin.keys()), d = { sym, date, pc, o: [], h: [], l: [], c: [], v: [] };
  let prev = (byMin.get(0) || byMin.get(Math.min(...byMin.keys()))).o;
  for (let m = 0; m <= last; m++) {
    const b = byMin.get(m), r = (x) => Math.round(x * 100) / 100;
    if (b) { d.o.push(r(b.o)); d.h.push(r(b.h)); d.l.push(r(b.l)); d.c.push(r(b.c)); d.v.push(b.v); prev = b.c; }
    else { const p = r(prev); d.o.push(p); d.h.push(p); d.l.push(p); d.c.push(p); d.v.push(0); }
  }
  return d;
}
async function loadFromAlpaca() {
  const key = $('#alpKey').value.trim(), sec = $('#alpSec').value.trim();
  const syms = $('#alpSyms').value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const nDays = Math.max(5, Math.min(400, +$('#alpDays').value || 100));
  const say = (t) => ($('#alpStatus').innerHTML = t);
  if (!key || !sec) return say('Paste both keys first.');
  $('#alpGo').disabled = true;
  try {
    const today = new Date(), first = new Date(today - 3 * 365 * 864e5), iso = (d) => d.toISOString().slice(0, 10);
    const wd = []; for (let t = +first; t < today - 864e5; t += 864e5) { const d = new Date(t); if (d.getUTCDay() % 6) wd.push(iso(d)); }
    const dates = wd.sort(() => Math.random() - 0.5).slice(0, nDays).sort();
    say('Fetching daily closes…');
    const daily = await alpacaBars(syms, '1Day', iso(first), iso(today), key, sec);
    const closes = {}; for (const [s, b] of Object.entries(daily)) closes[s] = b.map((x) => [x.t.slice(0, 10), x.c]);
    const days = [];
    for (let i = 0; i < dates.length; i++) {
      const ds = dates[i];
      say(`Fetching ${ds} (${i + 1}/${dates.length}) · ${days.length} symbol-days so far…`);
      const mb = await alpacaBars(syms, '1Min', `${ds}T13:00:00Z`, `${ds}T21:00:00Z`, key, sec);
      for (const [s, b] of Object.entries(mb)) {
        const prior = (closes[s] || []).filter((x) => x[0] < ds); const pc = prior.length ? prior[prior.length - 1][1] : null;
        const d = toDay(s, ds, b, pc); if (d) days.push(d);
      }
    }
    if (!days.length) throw new Error('No bars came back. Check the symbols.');
    const ds = { meta: { source: 'alpaca sip historical', symbols: syms, generated: iso(today) }, days };
    await idb.set(ds);
    loadData(ds); $('#loader').classList.add('hidden'); toast(`Loaded ${days.length} real symbol-days`);
  } catch (e) {
    const blocked = e instanceof TypeError;
    say(blocked ? 'The browser blocked the request. If you\'re on the online demo, download the zip and open <b>drill.html</b> from your computer. Or run <code>fetch_alpaca.py</code> (see the README).' : e.message);
  } finally { $('#alpGo').disabled = false; }
}
$('#alpGo').onclick = loadFromAlpaca;
$('#alpClose').onclick = () => $('#loader').classList.add('hidden');

// ---------- Boot ----------
(async () => {
  const cached = window.DRILL_DATA ? null : await idb.get();
  loadData(window.DRILL_DATA || cached || Core.genDataset(Math.floor(Math.random() * 1e9), new Date().toISOString().slice(0, 10), 60));
})();
window.__drill = { get S() { return S; }, step, enter, endRep, startRep, candle, chart, get DATA() { return DATA; } };
})();
