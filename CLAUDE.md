# Setup Drill

Personal POC for practicing day-trading setups on replayed 1-minute charts. Each rep is a random historical day (ticker/date hidden); about half the charts contain no valid setup. Grading is on the **decision** (take vs. pass) and execution, not P&L. User-facing docs are in `README.md`.

## Ground rules
- Goal: grow it step by step into something solid that the owner uses to learn trading; the owner is also learning to build it. Possible SaaS later, not a priority now.
- Prefer incremental, well-structured changes over big rewrites. Don't over-engineer; use quick spikes to de-risk.
- Keep it free/cheap and personal-use first.
- Never commit `.env`, `data/` (Alpaca data is not redistributable) or `journal/` (the owner's personal trade diary). All gitignored.
- Don't write test reps into the owner's real `journal/journal.json`; if a browser test creates entries, delete them via `DELETE /api/journal/<id>`.

## Commands
- `npm run dev` (or `npm start`): Vite dev server on :5173. The `server/dataSync.ts` plugin reads keys from `.env`, syncs random Alpaca days into `data/days.json` in the background (incremental, saves every 10 dates), and serves `/api/data` + `/api/status`. The browser never calls Alpaca. Disabled under Vitest.
- `npm test` (Vitest), `npm run typecheck`, `npm run build`.
- Sync knobs in `.env`: `SYNC_DAYS` (100), `SYNC_YEARS` (3), `SYNC_SYMBOLS`. Changing symbols resets the cache.
- Alpaca auth needs BOTH Key ID and Secret (key-only gets 401). History comes from data.alpaca.markets, not paper-api. Free plan 403s on SIP data from the last 15 min, so request end times stay 20 min behind now.

## Layout
- `src/core/`: pure logic, no DOM. `types.ts`, `day.ts` (time, VWAP, relVol), `candles.ts` (TF type, multi-day candle building, History), `overlays.ts` (user indicator config + computation), `indicators.ts`, `fills.ts`, `grading.ts`, `demo.ts`.
- `src/setups/`: one file per setup exporting a `SetupDef` (label, rule text, `evaluate`, optional `preset` of indicators to switch on). Thresholds are constants at the top of each file. Register in `index.ts`.
- `src/engine/replay.ts`: `Replay` class = one rep (clock, stepping, play, orders, fills, restart, grading). Emits changes; React reads via `useSyncExternalStore`.
- `src/data/alpaca.ts`: Alpaca client, session/bar conversion, `fetchHistory` (Node-side).
- `src/ui/`: React. `App.tsx` (boot, data sync, rep lifecycle), `Home.tsx`, `Session.tsx` (top bar, side panel, result sheet, keyboard), `ChartPane.tsx` (declarative lines/markers), `ChartOverlay.tsx` (SVG layer over the price pane: SL/TP bracket + drawings, all drag handling), `OrderTicket.tsx` (ticket + position card), `AccountPanel.tsx` (bottom panel), `drawings.ts`, `IndicatorPanel.tsx`, `chart/ChartView.ts` (imperative Lightweight Charts wrapper, blind axis labels), `state.ts` (settings, history, pools, toasts), `data.ts` (API calls).
- `src/core/journal.ts`: JournalEntry/JournalTrade types, `summarize`, `equityCurve`, `streakDays`, `tagCounts`, `toCsv`.
- `server/journal.ts`: journal file store + Vite plugin: `GET/POST /api/journal`, `PATCH/DELETE /api/journal/<id>`, atomic writes to `journal/journal.json`.
- UI shell: `App.tsx` tabs Practice (`Home.tsx`) / Journal (`Journal.tsx`, also exports `ReviewBox` used on the grade sheet) / Settings (`Settings.tsx`). `journalStore.ts` = client store (falls back to localStorage, migrates legacy `drill.history`). Note: macOS is case-insensitive, so don't name modules `journal.ts` next to `Journal.tsx`.
- `server/dataSync.ts`: Vite plugin. Background sync of rep days into `data/days.json`; `/api/history` fetches+caches per sym/date history in `data/history/`.
- Tests: `tests/*.test.ts` (Vitest). Per-setup checks run for every registered setup automatically.
- TypeScript pinned to 5.9: TS 7.0.2 with `jsx: react-jsx` mis-parses `<const T>` generics in @types/node.

## Roadmap (agreed 2026-11-15)
1. Done: React UI, timeframes 1m–1D with history, configurable indicators, restart, OHLCV legend.
2. Done: TradingView-style layout; order ticket ($ / % risk, R:R, auto SL/TP, share sizing, 4× buying power), draggable SL/TP, positions/history/account panel, $ P&L.
3. Partly done: horizontal + trend lines (per rep, not persisted). Could add: rays, rectangles, saving drawings.
4. Combine mode: $50K account across reps with Topstep-style rules (verify current rules first). Each rep = one trading day.
5. More setups: 1-2-3 trend continuation, range fade/breakout, S/R rejection, flag breakout.

## Design notes
- Day shape: `{sym, date, pc, o[], h[], l[], c[], v[]}`, one bar/min from 09:30 ET, RTH only; missing minutes filled flat with 0 volume. Chart time = ET wall-clock treated as UTC.
- Evaluators return `null` (day lacks context) or `{valid, dir, trigIdx, refStop, startIdx, windowEnd, why}`. Each setup's pool is split valid/no-trade; reps sample 50/50. Rep runs `startIdx` → `windowEnd` (rule deadline + 5 bars). One event per day per setup.
- Flat: chart shows no bracket; the ticket holds settings (risk $/%, R:R, TP on/off) and Buy/Sell buttons. SL/TP lines appear only after entry, on the traded side.
- History: daily (~300), 5-min (40 sessions), 1-min (previous `M1_DAYS`=2 sessions). Cached files without `m1` are refetched.
- Live P&L view (`order.pnlView`, default ticks; `src/ui/pnl.ts`, tick = $0.01): while in a trade the UI shows ticks/R/$ as chosen; Balance changes only on close, Equity shown only in $ view.
- Orders: market only. `Replay.plan` is what the ticket would send (side, entry, stop, target, qty, error); qty = floor(risk$ / per-share risk), capped at 4× balance. Auto stop = 5-bar extreme but at least 0.15% away. Trades carry `qty` and `pnl`; grading stays in R.
- Fills: last price + slippage (max $0.01 / 0.02%). Stop required before entry. Stop-and-target on the same bar → stop first. Gapped stops fill at the open.
- Decision grade: no-trade chart → pass 100, any trade ≤20. Valid chart → Decision 50 (right dir within 3 bars) + Timing (15 − 5×bars late) + Stop 20/10/5 (good/too wide/too tight vs. trigger candle & `refStop`) + Discipline 15. Missed valid ≈ 15. >3 bars late = "Chased".
- Free play is scored on R, capture, heat, discipline.
- Indicator drills open on 1m with their preset indicators switched on; the user can switch timeframe/indicators freely. Rules are always evaluated on 1-min bars of the rep day only.
- Rep history/stats in `journal/journal.json` (one entry per finished rep; `attempt` increments after Restart). UI prefs in `localStorage`. Market data in `data/days.json`.

## Known limitations (accepted for POC)
- Setup rules evaluate on the rep day only, while chart indicators now warm up across earlier sessions, so a drawn indicator can differ slightly from the rule's.
- Rule thresholds are defaults, not the owner's playbook — expect tuning.
- Demo data skews ORB heavily valid (~315 vs 45); 50/50 sampling compensates.

## Open questions / next steps
- Practice on real data, then tune thresholds.
- Optional: 5-min indicator drills, prior-day warmup, multiple events/day, Bollinger/Stochastic drills, per-setup mistake review.

## Licensing / data constraints
- Charts: TradingView Lightweight Charts (Apache 2.0) — keep the TradingView logo for attribution. (Advanced Charts is not available for personal/hobby use.)
- Data: Alpaca free plan via a **paper** Trading API account — SIP history (except last 15 min), 200 req/min, ~7 yrs. Personal use only; no redistribution. If this is ever shared, users must bring their own key (current design).
