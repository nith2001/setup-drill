/* Core logic: pure functions, no DOM. Works in browser (global Core) and Node (module.exports). */
const Core = (() => {
  // ---------- RNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  const r4 = (x) => Math.round(x * 10000) / 10000;

  // ---------- Time ----------
  // Chart times are "exchange wall-clock as UTC" so the axis reads 09:30..16:00.
  function dayStartTs(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d, 9, 30) / 1000;
  }
  function hhmm(idx) {
    const mins = 9 * 60 + 30 + idx;
    return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  }

  // ---------- Day helpers ----------
  // day = { sym, date, pc (prev close|null), o[],h[],l[],c[],v[] }  (1-minute bars from 09:30 ET)
  function prepDay(day) {
    if (day._cumPV) return day;
    const n = day.c.length;
    const cumPV = new Float64Array(n), cumV = new Float64Array(n);
    let pv = 0, vv = 0;
    for (let i = 0; i < n; i++) {
      const tp = (day.h[i] + day.l[i] + day.c[i]) / 3;
      pv += tp * day.v[i]; vv += day.v[i];
      cumPV[i] = pv; cumV[i] = vv;
    }
    day._cumPV = cumPV; day._cumV = cumV;
    return day;
  }
  function vwapAt(day, i) {
    prepDay(day);
    return day._cumV[i] > 0 ? day._cumPV[i] / day._cumV[i] : day.c[i];
  }

  // Aggregate the revealed 1m bars (indices 0..upto inclusive) into timeframe buckets.
  function bucketBar(day, b, tf, upto) {
    const s = b * tf, e = Math.min(s + tf - 1, upto);
    let o = day.o[s], h = -Infinity, l = Infinity, v = 0;
    for (let i = s; i <= e; i++) {
      if (day.h[i] > h) h = day.h[i];
      if (day.l[i] < l) l = day.l[i];
      v += day.v[i];
    }
    return { time: dayStartTs(day.date) + s * 60, open: o, high: h, low: l, close: day.c[e], volume: v, lastIdx: e };
  }
  function aggregate(day, upto, tf) {
    const out = [];
    const nb = Math.floor(upto / tf) + 1;
    for (let b = 0; b < nb; b++) out.push(bucketBar(day, b, tf, upto));
    return out;
  }

  // ---------- Fill engine ----------
  // pos: {side:+1|-1, entry, stop, target|null}
  // Evaluate one bar for an open position. Conservative: if stop & target both inside bar, stop first.
  function evalBar(pos, bar) {
    const { side, stop, target } = pos;
    const { o, h, l } = bar;
    if (side > 0) {
      if (o <= stop) return { price: o, reason: 'stop', gap: true };
      if (target != null && o >= target) return { price: o, reason: 'target', gap: true };
      const sh = l <= stop, th = target != null && h >= target;
      if (sh) return { price: stop, reason: 'stop' };
      if (th) return { price: target, reason: 'target' };
    } else {
      if (o >= stop) return { price: o, reason: 'stop', gap: true };
      if (target != null && o <= target) return { price: o, reason: 'target', gap: true };
      const sh = h >= stop, th = target != null && l <= target;
      if (sh) return { price: stop, reason: 'stop' };
      if (th) return { price: target, reason: 'target' };
    }
    return null;
  }

  // Mechanical simulation used for benchmark trades. Returns R (gross, no costs).
  function simulateTrade(day, side, entryIdx, entryPrice, stop, rMult, evalFrom) {
    const risk = Math.abs(entryPrice - stop);
    if (!(risk > 0)) return null;
    const target = rMult ? entryPrice + side * risk * rMult : null;
    const pos = { side, entry: entryPrice, stop, target };
    let mfe = 0, mae = 0, exit = null, exitIdx = day.c.length - 1;
    for (let i = evalFrom; i < day.c.length; i++) {
      const bar = { o: day.o[i], h: day.h[i], l: day.l[i], c: day.c[i] };
      const res = evalBar(pos, bar);
      const fav = side > 0 ? bar.h - entryPrice : entryPrice - bar.l;
      const adv = side > 0 ? entryPrice - bar.l : bar.h - entryPrice;
      if (res) {
        if (res.reason === 'target') { mfe = Math.max(mfe, side * (res.price - entryPrice)); mae = Math.max(mae, adv); }
        else { mae = Math.max(mae, risk, side * (entryPrice - res.price)); } // stop bar: no favorable credit (stop assumed first)
        exit = res; exitIdx = i; break;
      }
      mfe = Math.max(mfe, fav); mae = Math.max(mae, adv);
    }
    if (!exit) exit = { price: day.c[day.c.length - 1], reason: 'eod' };
    const R = (side * (exit.price - entryPrice)) / risk;
    return { R, exitIdx, exitPrice: exit.price, reason: exit.reason, mfeR: mfe / risk, maeR: Math.min(mae / risk, 5), entryIdx, entryPrice, stop, side };
  }

  // ---------- Setup rules ----------
  // Each evaluator returns null (day lacks the context for this drill) or
  // { valid, dir, trigIdx, refStop, startIdx, windowEnd, why, levels }
  // valid=false days are "no-trade" reps: the context is there but the rule never fires.
  const RV_MIN = 1.5, GRACE = 5;
  function relVol(day, i, lookback = 10) {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - lookback); k < i; k++) { s += day.v[k]; n++; }
    return n && s > 0 ? day.v[i] / (s / n) : 0;
  }
  const fmtT = (i) => hhmm(i);

  function evalORB(day, orMin = 15) {
    const n = day.c.length, deadline = orMin + 90;
    if (n < deadline + GRACE + 5) return null;
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < orMin; i++) { hi = Math.max(hi, day.h[i]); lo = Math.min(lo, day.l[i]); }
    if (!(hi - lo > 0) || (hi - lo) / day.c[0] < 0.0015) return null;
    let near = null;
    for (let i = orMin; i <= deadline; i++) {
      const dir = day.c[i] > hi ? 1 : day.c[i] < lo ? -1 : 0;
      if (!dir) continue;
      const rv = relVol(day, i);
      if (rv >= RV_MIN) return { valid: true, dir, trigIdx: i, refStop: dir > 0 ? lo : hi, startIdx: orMin, windowEnd: deadline + GRACE,
        why: `${fmtT(i)} candle closed ${dir > 0 ? 'above' : 'below'} the range on ${rv.toFixed(1)}× volume.`, levels: { hi, lo } };
      if (!near || rv > near.rv) near = { i, dir, rv };
    }
    return { valid: false, startIdx: orMin, windowEnd: deadline + GRACE, levels: { hi, lo },
      why: near ? `Closest: ${fmtT(near.i)} closed ${near.dir > 0 ? 'above' : 'below'} the range, but on only ${near.rv.toFixed(1)}× volume.` : 'Price never closed outside the opening range.' };
  }

  function evalGap(day) {
    if (day.pc == null || day.c.length < 60) return null;
    const gap = (day.o[0] - day.pc) / day.pc;
    if (Math.abs(gap) < 0.015) return null;
    const dir = gap > 0 ? 1 : -1, N = 5, deadline = 35;
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < N; i++) { hi = Math.max(hi, day.h[i]); lo = Math.min(lo, day.l[i]); }
    let near = null;
    for (let i = N; i <= deadline; i++) {
      const broke = dir > 0 ? day.c[i] > hi : day.c[i] < lo;
      if (!broke) continue;
      const vw = vwapAt(day, i), sideOk = dir > 0 ? day.c[i] > vw : day.c[i] < vw;
      if (sideOk) return { valid: true, dir, trigIdx: i, refStop: dir > 0 ? lo : hi, startIdx: N, windowEnd: deadline + GRACE,
        why: `Gapped ${(gap * 100).toFixed(1)}%; ${fmtT(i)} closed ${dir > 0 ? 'above the 5-min high' : 'below the 5-min low'} on the right side of VWAP.`, levels: { hi, lo } };
      if (!near) near = i;
    }
    return { valid: false, startIdx: N, windowEnd: deadline + GRACE, levels: { hi, lo },
      why: near != null ? `${fmtT(near)} broke the 5-min level but on the wrong side of VWAP.` : `Gapped ${(gap * 100).toFixed(1)}% but never closed through the 5-min ${dir > 0 ? 'high' : 'low'} by 10:05.` };
  }

  function evalVWAP(day) {
    const n = day.c.length, TH = 0.002, MINRUN = 12;
    if (n < 300) return null;
    let run = 0, side = 0;
    for (let i = 15; i < 240; i++) {
      const vw = vwapAt(day, i), dev = (day.c[i] - vw) / vw;
      const s = dev < -TH ? -1 : dev > TH ? 1 : 0;
      if (s && s === side) { run++; continue; }
      if (s) { side = s; run = 1; continue; }
      if (run >= MINRUN) {
        // Stretch just ended at i. Look for the first close back across VWAP within 30 bars.
        const dir = -side, startIdx = Math.max(15, i - 8), deadline = i + 30;
        for (let k = i; k <= deadline && k < n - 10; k++) {
          const crossed = dir > 0 ? day.c[k] > vwapAt(day, k) : day.c[k] < vwapAt(day, k);
          if (!crossed) continue;
          const rv = relVol(day, k);
          let ref = dir > 0 ? Infinity : -Infinity;
          for (let j = k - 10; j <= k; j++) ref = dir > 0 ? Math.min(ref, day.l[j]) : Math.max(ref, day.h[j]);
          if (rv >= RV_MIN) return { valid: true, dir, trigIdx: k, refStop: ref, startIdx, windowEnd: deadline + GRACE,
            why: `${fmtT(k)} candle closed back ${dir > 0 ? 'above' : 'below'} VWAP on ${rv.toFixed(1)}× volume.`, levels: {} };
          return { valid: false, startIdx, windowEnd: deadline + GRACE, levels: {}, why: `${fmtT(k)} crossed VWAP, but on only ${rv.toFixed(1)}× volume.` };
        }
        return { valid: false, startIdx, windowEnd: deadline + GRACE, levels: {}, why: 'Price never closed back across VWAP within 30 minutes.' };
      }
      run = 0; side = 0;
    }
    return null;
  }

  // ---------- Indicators (computed per day on 1-min closes) ----------
  function emaArr(c, n) {
    const k = 2 / (n + 1), out = new Array(c.length).fill(NaN);
    let e = c[0];
    for (let i = 0; i < c.length; i++) { e = i ? c[i] * k + e * (1 - k) : c[0]; if (i >= n - 1) out[i] = e; }
    return out;
  }
  function smaArr(c, n) {
    const out = new Array(c.length).fill(NaN); let s = 0;
    for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  }
  function rsiArr(c, n = 14) {
    const out = new Array(c.length).fill(NaN); let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
      if (i >= n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function indicators(day) {
    if (day._ind) return day._ind;
    const c = day.c, e12 = emaArr(c, 12), e26 = emaArr(c, 26);
    const macdRaw = c.map((_, i) => e12[i] - e26[i]);
    const sigRaw = emaArr(macdRaw.map((v) => (isFinite(v) ? v : 0)), 9);
    const macd = macdRaw.map((v, i) => (i >= 33 ? v : NaN));
    const sig = sigRaw.map((v, i) => (i >= 33 ? v : NaN));
    day._ind = { e9: emaArr(c, 9), e20: emaArr(c, 20), sma50: smaArr(c, 50), rsi: rsiArr(c, 14),
      macd, sig, hist: macd.map((v, i) => v - sig[i]) };
    return day._ind;
  }

  // 9/20 EMA pullback: trend (9 over 20 for 15+ bars, 20 sloping) -> pullback touches 20 EMA -> resumption close back over 9 EMA
  function evalEMA(day) {
    const I = indicators(day), { e9, e20 } = I, n = day.c.length;
    for (let i = 35; i < Math.min(n - 20, 240); i++) {
      for (const dir of [1, -1]) {
        let trend = dir * (e20[i - 1] - e20[i - 11]) > 0;
        for (let k = i - 15; trend && k < i; k++) if (!(dir * (e9[k] - e20[k]) > 0)) trend = false;
        const touch = dir > 0 ? day.l[i] <= e20[i] : day.h[i] >= e20[i];
        if (!trend || !touch) continue;
        const startIdx = i - 12, deadline = i + 6;
        let ref = dir > 0 ? Infinity : -Infinity;
        for (let k = i; k <= deadline; k++) {
          ref = dir > 0 ? Math.min(ref, day.l[k]) : Math.max(ref, day.h[k]);
          if (dir * (day.c[k] - e20[k]) < 0) return { valid: false, startIdx, windowEnd: deadline + GRACE, levels: {},
            why: `The pullback ${fmtT(k)} closed ${dir > 0 ? 'below' : 'above'} the 20 EMA, so the trend broke. No trade.` };
          if (dir * (day.c[k] - e9[k]) > 0 && dir * (day.c[k] - day.o[k]) > 0) return { valid: true, dir, trigIdx: k, refStop: ref, startIdx, windowEnd: deadline + GRACE, levels: {},
            why: `${dir > 0 ? 'Uptrend' : 'Downtrend'} pulled back to the 20 EMA, held it, and ${fmtT(k)} closed back ${dir > 0 ? 'above' : 'below'} the 9 EMA.` };
        }
        return { valid: false, startIdx, windowEnd: deadline + GRACE, levels: {}, why: 'Price touched the 20 EMA but never closed back past the 9 EMA within 6 bars.' };
      }
    }
    return null;
  }

  // MACD (12,26,9) signal-line cross, taken only on the trend side of the zero line
  function evalMACD(day) {
    const { macd, sig } = indicators(day), n = day.c.length;
    const side = (i) => Math.sign(macd[i] - sig[i]);
    for (let i = 50; i < Math.min(n - 20, 240); i++) {
      if (!side(i) || side(i) === side(i - 1)) continue;
      let quiet = true;
      for (let k = i - 15; k < i; k++) if (side(k) !== side(k - 1)) { quiet = false; break; }
      if (!quiet) continue;
      const dir = side(i), startIdx = i - 15, windowEnd = i + 3 + GRACE;
      let ref = dir > 0 ? Infinity : -Infinity;
      for (let k = i - 4; k <= i; k++) ref = dir > 0 ? Math.min(ref, day.l[k]) : Math.max(ref, day.h[k]);
      if (dir * macd[i] > 0) return { valid: true, dir, trigIdx: i, refStop: ref, startIdx, windowEnd, levels: {},
        why: `${fmtT(i)} MACD crossed ${dir > 0 ? 'above' : 'below'} its signal line while ${dir > 0 ? 'above' : 'below'} zero, with the trend.` };
      return { valid: false, startIdx, windowEnd, levels: {},
        why: `${fmtT(i)} MACD crossed ${dir > 0 ? 'up' : 'down'}, but ${dir > 0 ? 'below' : 'above'} the zero line. That's a counter-trend cross, so no trade.` };
    }
    return null;
  }

  // RSI(14) reclaim of 30 / 70, taken only when the 50 SMA slopes in the trade's direction
  function evalRSI(day) {
    const { rsi, sma50 } = indicators(day), n = day.c.length;
    for (let i = 65; i < Math.min(n - 20, 300); i++) {
      let dir = 0;
      if (rsi[i - 1] < 30 && rsi[i] >= 30) dir = 1;
      else if (rsi[i - 1] > 70 && rsi[i] <= 70) dir = -1;
      if (!dir) continue;
      let j = i - 1;
      while (j > 55 && (dir > 0 ? rsi[j] < 30 : rsi[j] > 70)) j--;
      const startIdx = Math.max(55, Math.min(j - 8, i - 6)), windowEnd = i + 3 + GRACE;
      let ref = dir > 0 ? Infinity : -Infinity;
      for (let k = j + 1; k <= i; k++) ref = dir > 0 ? Math.min(ref, day.l[k]) : Math.max(ref, day.h[k]);
      const slope = sma50[i] - sma50[i - 10];
      if (dir * slope > 0) return { valid: true, dir, trigIdx: i, refStop: ref, startIdx, windowEnd, levels: {},
        why: `RSI was ${dir > 0 ? 'oversold' : 'overbought'} during a ${dir > 0 ? 'rising' : 'falling'} 50 SMA, then ${fmtT(i)} closed back ${dir > 0 ? 'above 30' : 'below 70'}.` };
      return { valid: false, startIdx, windowEnd, levels: {},
        why: `RSI reclaimed ${dir > 0 ? '30' : '70'} at ${fmtT(i)}, but the 50 SMA was ${dir > 0 ? 'falling' : 'rising'}. That's fighting the trend, so no trade.` };
    }
    return null;
  }

  const SETUPS = {
    orb: { group: 'Price action', label: 'Opening Range Breakout', blurb: 'Take it only if it qualifies. Some charts have no valid setup.',
      rule: (o) => `A 1-min candle <b>closes</b> outside the first ${o.orMin}-min range on <b>≥1.5× volume</b> (vs prior 10 bars), within 90 min. Enter within 3 bars, in the break's direction. Stop: beyond the breakout candle, no wider than the other side of the range.` },
    gap: { group: 'Price action', label: 'Gap & Go', blurb: 'Stocks that gapped 1.5%+. Only some of them go.',
      rule: () => `Gap ≥1.5%. A 1-min candle <b>closes</b> through the first-5-min high (gap up) or low (gap down), on the <b>right side of VWAP</b>, by 10:05. Enter within 3 bars. Stop: beyond the trigger candle, no wider than the other side of the 5-min range.` },
    vwap: { group: 'Price action', label: 'VWAP Reclaim', blurb: 'Price stretched from VWAP. Does it reclaim with conviction?',
      rule: () => `After 12+ min stretched ≥0.2% from VWAP, a 1-min candle <b>closes back across VWAP</b> on <b>≥1.5× volume</b> within 30 min. Enter within 3 bars. Stop: beyond the trigger candle, no wider than the 10-bar extreme.` },
    ema: { group: 'Indicators', label: '9/20 EMA Pullback', blurb: 'Trend pulls back to the 20 EMA. Buy the bounce, or pass when it breaks.',
      rule: () => `Trend: 9 EMA above the 20 EMA for 15+ bars, 20 EMA rising (mirror for shorts). Price pulls back and touches the 20 EMA. Valid if, within 6 bars and without <b>closing through the 20 EMA</b>, a candle closes back past the 9 EMA in the trend's direction. Stop: beyond the trigger candle, no wider than the pullback's extreme.` },
    macd: { group: 'Indicators', label: 'MACD Cross', blurb: 'Signal-line crosses. Only the ones on the right side of zero count.',
      rule: () => `MACD (12, 26, 9) crosses its signal line. Valid only if MACD is on the <b>trend side of zero</b>: above zero for longs, below zero for shorts. Enter within 3 bars. Stop: beyond the trigger candle, no wider than the 5-bar extreme.` },
    rsi: { group: 'Indicators', label: 'RSI Reclaim + 50 SMA', blurb: 'Oversold bounce in an uptrend? Or a falling knife?',
      rule: () => `RSI (14) goes below 30, then closes back above 30. Valid only if the <b>50 SMA is rising</b>. Mirror for shorts: back below 70 with the 50 SMA falling. Enter within 3 bars. Stop: beyond the trigger candle, no wider than the low (or high) of the oversold stretch.` },
    random: { label: 'Free play', blurb: 'Any day, no rules. Scored on P&L and trade management.' },
  };

  function evaluate(setup, day, opts) {
    prepDay(day);
    if (setup === 'orb') return evalORB(day, (opts && opts.orMin) || 15);
    if (setup === 'gap') return evalGap(day);
    if (setup === 'vwap') return evalVWAP(day);
    if (setup === 'ema') return evalEMA(day);
    if (setup === 'macd') return evalMACD(day);
    if (setup === 'rsi') return evalRSI(day);
    return null;
  }

  // Decision grading: was it right to take / not take, and was the take executed per the rule?
  // Outcome (P&L) is deliberately not part of this score.
  function gradeDecision(ev, trades, day) {
    const notes = [];
    if (!ev.valid) {
      if (!trades.length) return { score: 100, correct: true, verdict: 'Correct pass', parts: { Decision: [100, 100] }, notes: ['No valid setup on this chart. Sitting out was right.'] };
      const s = Math.max(0, 20 - 10 * (trades.length - 1));
      notes.push(`There was no valid setup, but you took ${trades.length} trade${trades.length > 1 ? 's' : ''}.`);
      return { score: s, correct: false, verdict: 'Forced trade', parts: { Decision: [s, 100] }, notes };
    }
    const { dir, trigIdx } = ev;
    const good = trades.find((t) => t.side === dir && t.entryIdx >= trigIdx && t.entryIdx <= trigIdx + 3);
    const others = trades.filter((t) => t !== good);
    const early = others.filter((t) => t.entryIdx < trigIdx).length;
    const wrongDir = others.filter((t) => t.side !== dir && t.entryIdx >= trigIdx).length;
    const late = others.find((t) => t.side === dir && t.entryIdx > trigIdx + 3);
    let decision = 0, timing = 0, stop = 0, verdict, correct = false;
    if (good) {
      decision = 50; correct = true; verdict = 'Good take';
      timing = 15 - 5 * (good.entryIdx - trigIdx);
      const trigExt = dir > 0 ? day.l[trigIdx] : day.h[trigIdx];
      const buf = day.c[trigIdx] * 0.0005;
      const beyondTrig = dir > 0 ? good.stop0 <= trigExt + buf : good.stop0 >= trigExt - buf;
      const notTooWide = dir > 0 ? good.stop0 >= ev.refStop - buf : good.stop0 <= ev.refStop + buf;
      if (beyondTrig && notTooWide) { stop = 20; notes.push('Stop placed per the rule.'); }
      else if (!beyondTrig) { stop = 5; notes.push(`Stop was inside the trigger candle (needed ${dir > 0 ? '≤' : '≥'} ${trigExt.toFixed(2)}).`); }
      else { stop = 10; notes.push(`Stop was wider than the rule allows (limit ${ev.refStop.toFixed(2)}).`); }
      if (good.entryIdx > trigIdx) notes.push(`Entered ${good.entryIdx - trigIdx} bar${good.entryIdx - trigIdx > 1 ? 's' : ''} after the trigger.`);
    } else if (late) {
      decision = 15; timing = 0; verdict = 'Chased'; late.counted = true;
      notes.push(`Right idea, but you entered ${late.entryIdx - trigIdx} bars after the trigger (limit 3).`);
    } else {
      verdict = 'Missed setup';
      notes.push('A valid setup triggered and you didn\'t take it.');
    }
    const extra = others.filter((t) => !t.counted).length;
    let discipline = 15 - 8 * (early + wrongDir) - 4 * Math.max(0, extra - early - wrongDir);
    discipline = Math.max(0, discipline);
    if (early) notes.push(`${early} trade${early > 1 ? 's' : ''} taken before the setup triggered.`);
    if (wrongDir) notes.push(`${wrongDir} trade${wrongDir > 1 ? 's' : ''} against the setup's direction.`);
        const score = Math.round(decision + timing + stop + discipline);
    return { score: Math.max(0, Math.min(100, score)), correct, verdict,
      parts: { Decision: [decision, 50], Timing: [timing, 15], Stop: [stop, 20], Discipline: [discipline, 15] }, notes };
  }

  // ---------- Scoring ----------
  // trades: [{side,R,mfeR,maeR,entryIdx,exitIdx,reason}]
  function scoreRep(trades) {
    if (!trades.length) return { passed: true, score: null, netR: 0 };
    const netR = trades.reduce((a, t) => a + t.R, 0);
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const result = clamp(25 + 12.5 * netR, 0, 50);

    const capt = trades.filter((t) => t.mfeR >= 0.5);
    let captureAvg = null, capture = 10;
    if (capt.length) {
      captureAvg = capt.reduce((a, t) => a + (t.R > 0 ? clamp(t.R / t.mfeR, 0, 1) : 0), 0) / capt.length;
      capture = 20 * captureAvg;
    }
    const winners = trades.filter((t) => t.R > 0);
    let heatAvg = null, heat = 7.5;
    if (winners.length) {
      heatAvg = winners.reduce((a, t) => a + (1 - Math.min(1, t.maeR)), 0) / winners.length;
      heat = 15 * heatAvg;
    }
    let discipline = 15; const notes = [];
    if (trades.length > 2) { const p = Math.min(10, (trades.length - 2) * 4); discipline -= p; notes.push(`${trades.length} trades (−${p}): overtrading`); }
    let revenge = 0;
    for (let i = 1; i < trades.length; i++) {
      const p = trades[i - 1];
      if (p.R < 0 && trades[i].entryIdx - p.exitIdx <= 3) revenge++;
    }
    if (revenge) { const p = Math.min(10, revenge * 5); discipline -= p; notes.push(`${revenge} quick re-entr${revenge > 1 ? 'ies' : 'y'} after a loss (−${p})`); }
    discipline = clamp(discipline, 0, 15);
    const score = Math.round(result + capture + heat + discipline);
    return {
      passed: false, score, netR,
      parts: { result, capture, heat, discipline },
      captureAvg, heatAvg, notes,
    };
  }

  // ---------- Synthetic demo data ----------
  function nextWeekdays(endDateStr, count) {
    const out = []; let [y, m, d] = endDateStr.split('-').map(Number);
    let dt = new Date(Date.UTC(y, m - 1, d));
    while (out.length < count) {
      const wd = dt.getUTCDay();
      if (wd !== 0 && wd !== 6) out.push(dt.toISOString().slice(0, 10));
      dt = new Date(dt.getTime() - 86400000);
    }
    return out.reverse();
  }

  function genDay(rng, sym, date, prevClose, profile) {
    const N = 390;
    const o = new Array(N), h = new Array(N), l = new Array(N), c = new Array(N), v = new Array(N);
    const gapRoll = rng();
    const gap = gapRoll < 0.22 ? gauss(rng) * 0.016 + (rng() < 0.5 ? -0.01 : 0.01) : gauss(rng) * 0.003;
    let price = prevClose * (1 + gap);
    const trendRoll = rng();
    const drift = trendRoll < 0.3 ? (rng() < 0.5 ? -1 : 1) * (0.00004 + rng() * 0.00007) : 0;
    const baseSig = profile.sigma * (0.8 + rng() * 0.6);
    const meanRevTo = price; // mild mean reversion in chop days
    for (let i = 0; i < N; i++) {
      const u = i < 30 ? 2.2 - (i / 30) * 1.2 : i > 360 ? 1 + (i - 360) / 30 * 0.6 : 0.85 + 0.15 * Math.sin(i / 60);
      const sig = baseSig * u;
      const open = price;
      let ret = gauss(rng) * sig + drift;
      if (drift === 0) ret += (meanRevTo - price) / price * 0.01;
      // occasional momentum burst
      if (rng() < 0.012) ret += gauss(rng) * sig * 4;
      const close = Math.max(0.5, open * (1 + ret));
      const ex = Math.abs(gauss(rng)) * sig * 0.7;
      const hi = Math.max(open, close) * (1 + ex * rng());
      const lo = Math.min(open, close) * (1 - ex * rng());
      o[i] = r2(open); c[i] = r2(close); h[i] = r2(Math.max(hi, open, close)); l[i] = r2(Math.min(lo, open, close));
      if (h[i] < Math.max(o[i], c[i])) h[i] = Math.max(o[i], c[i]);
      if (l[i] > Math.min(o[i], c[i])) l[i] = Math.min(o[i], c[i]);
      const vm = profile.vol * u * Math.exp(gauss(rng) * 0.5) * (1 + Math.abs(ret) / sig * 0.3);
      v[i] = Math.max(100, Math.round(vm));
      price = close;
    }
    return { sym, date, pc: r2(prevClose), o, h, l, c, v };
  }

  function genDataset(seed, endDate, nDays) {
    const rng = mulberry32(seed);
    const profiles = [
      ['DEMO1', 180, { sigma: 0.0007, vol: 90000 }], ['DEMO2', 420, { sigma: 0.0006, vol: 60000 }],
      ['DEMO3', 95, { sigma: 0.0011, vol: 150000 }], ['DEMO4', 260, { sigma: 0.0009, vol: 80000 }],
      ['DEMO5', 52, { sigma: 0.0013, vol: 220000 }], ['DEMO6', 340, { sigma: 0.0008, vol: 50000 }],
    ];
    const dates = nextWeekdays(endDate, nDays);
    const days = [];
    for (const [sym, start, prof] of profiles) {
      let pc = start;
      for (const date of dates) {
        const d = genDay(rng, sym, date, pc, prof);
        days.push(d);
        pc = d.c[d.c.length - 1];
      }
    }
    return { meta: { source: 'synthetic demo', note: 'Randomly generated — not real prices.', symbols: profiles.map((p) => p[0]) }, days };
  }

  return {
    mulberry32, gauss, r2, r4, dayStartTs, hhmm, prepDay, vwapAt, bucketBar, aggregate,
    evalBar, simulateTrade, evaluate, gradeDecision, relVol, indicators, emaArr, smaArr, rsiArr, SETUPS, scoreRep, genDataset, genDay, nextWeekdays,
  };
})();
if (typeof module !== 'undefined') module.exports = Core;
