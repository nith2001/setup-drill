# Setup Drill

Personal POC for practicing day-trading setups on replayed 1-minute charts. Each rep is a random historical day (ticker/date hidden); about half the charts contain no valid setup. Grading is on the **decision** (take vs. pass) and execution, not P&L. User-facing docs are in `README.md`.

## Ground rules
- Keep it a simple POC that works. Don't over-engineer.
- Use quick spikes to de-risk a step before building it out.
- Keep it free/cheap and personal-use first.
- Never commit API keys or anything under `dist/data/` (Alpaca data is not redistributable; it's gitignored).

## Commands
- Run: open `dist/drill.html` directly in a browser (no server).
- Build after editing `src/`: `npm run build` (inlines `lightweight-charts` + `src/core.js` + `src/app.js` into `dist/drill.html`). Commit the rebuilt `dist/drill.html` with source changes.
- Test: `npm test` (`node --test tests/core.test.js`).
- Real data via script: `APCA_API_KEY_ID=… APCA_API_SECRET_KEY=… python3 fetch_alpaca.py --days 120 --years 3` → writes `dist/data/days.js`, which the app loads automatically.

## Layout
- `src/core.js` — pure logic shared by browser and Node: RNG + demo data, bar aggregation, VWAP, EMA/SMA/RSI/MACD, fill engine (`evalBar`, `simulateTrade`), setup evaluators (`evalORB/evalGap/evalVWAP/evalEMA/evalMACD/evalRSI`), `SETUPS`, `gradeDecision`, `scoreRep`. **Rule thresholds live here.**
- `src/app.js` — UI: home/stats, chart (Lightweight Charts v5 + indicator panes), replay, order entry, grading sheet, IndexedDB cache, in-browser Alpaca loader.
- `src/template.html` — markup/CSS with build placeholders.
- `fetch_alpaca.py` — stdlib-only fallback data pull.

## Design notes
- Day shape: `{sym, date, pc, o[], h[], l[], c[], v[]}`, one bar/min from 09:30 ET, RTH only; missing minutes filled flat with 0 volume. Chart time = ET wall-clock treated as UTC.
- Evaluators return `null` (day lacks context) or `{valid, dir, trigIdx, refStop, startIdx, windowEnd, why}`. Each setup's pool is split valid/no-trade; reps sample 50/50. Rep runs `startIdx` → `windowEnd` (rule deadline + 5 bars). One event per day per setup.
- Fills: last price + slippage (max $0.01 / 0.02%). Stop required before entry. Stop-and-target on the same bar → stop first. Gapped stops fill at the open.
- Decision grade: no-trade chart → pass 100, any trade ≤20. Valid chart → Decision 50 (right dir within 3 bars) + Timing (15 − 5×bars late) + Stop 20/10/5 (good/too wide/too tight vs. trigger candle & `refStop`) + Discipline 15. Missed valid ≈ 15. >3 bars late = "Chased".
- Free play is scored on R, capture, heat, discipline.
- Indicator drills: 1-min bars only, VWAP off by default, only that setup's indicators drawn.
- History/stats in `localStorage`; data in IndexedDB (per-browser).

## Known limitations (accepted for POC)
- Indicators restart each day (no prior-day warmup).
- Thresholds are defaults, not the owner's playbook — expect tuning.
- Demo data skews ORB heavily valid (~315 vs 45); 50/50 sampling compensates.

## Open questions / next steps
- **Unverified:** whether `data.alpaca.markets` allows browser CORS. In-app loader was only tested against a mock; if blocked, use `fetch_alpaca.py` or add a tiny local proxy.
- Practice on real data, then tune thresholds.
- Optional: 5-min indicator drills, prior-day warmup, multiple events/day, Bollinger/Stochastic drills, per-setup mistake review.

## Licensing / data constraints
- Charts: TradingView Lightweight Charts (Apache 2.0) — keep the TradingView logo for attribution. (Advanced Charts is not available for personal/hobby use.)
- Data: Alpaca free plan via a **paper** Trading API account — SIP history (except last 15 min), 200 req/min, ~7 yrs. Personal use only; no redistribution. If this is ever shared, users must bring their own key (current design).
