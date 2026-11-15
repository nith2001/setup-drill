# Setup Drill

Practice day-trading setups on replayed 1-minute charts. Pick a setup, get a random day (ticker and date hidden), step through it bar by bar, and decide whether to take the trade. About half the charts have no valid setup. You're graded on the **decision**, not the P&L.

## Quick start
```bash
npm install
cp .env.example .env   # then add your Alpaca paper keys (optional)
npm run dev            # opens http://localhost:5173, syncs real data, reloads on save
```
Without keys it runs on generated demo data.

## Real data (free, personal use)
1. Sign up at alpaca.markets as an individual (**Trading API**), stay in **Paper Trading**. No deposit needed.
2. Paper dashboard → **API Keys → Generate** (or Regenerate). Copy both the Key ID and the Secret into `.env`.
3. `npm run dev`. That's it.

On startup the dev server downloads random historical days in the background into `data/days.json` (100 trading days × 20 symbols by default, about a minute the first time). The page shows progress and switches to the new data as it arrives, but never in the middle of a rep. Later launches reuse the cache and only fetch what's missing. Change `SYNC_DAYS`, `SYNC_YEARS` or `SYNC_SYMBOLS` in `.env` to get more or different data. Delete `data/days.json` to start fresh.

Keys stay on the server side; the browser never talks to Alpaca. Alpaca's free tier serves full-market (SIP) history older than 15 minutes. The data is for your own use only: Alpaca doesn't allow redistributing it.

## Scripts
| | |
|---|---|
| `npm run dev` / `npm start` | Dev server with hot reload |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Typecheck + production build to `dist/` |

## Controls
| Key | Action |
|---|---|
| `→` / `Shift+→` | Step one candle of the current timeframe / one minute |
| `Space` | Play / pause (speed 1–60 min of market time per second) |
| `1`–`6` | Timeframe: 1m, 5m, 15m, 1h, 4h, 1D |
| `I` | Indicators: any number of EMAs/SMAs (any length), VWAP, volume, RSI, MACD |
| click chart | Set your stop (or move it while in a trade) |
| `B` / `S` | Buy / short at market |
| `F` | Flatten |
| `R` | Restart the chart from the beginning |
| `E` / `N` | End and grade the rep / next rep |

Higher timeframes show the weeks and months before the rep day. On real data the dev server fetches them from Alpaca the first time you open that day (cached in `data/history/`). With **Blind** on, the axis shows days relative to the rep day (D-3, Today) instead of dates.

## How grading works
- **No valid setup:** pass = 100. Any trade = "Forced trade" (≤20).
- **Valid setup:** Decision 50 (right direction within 3 bars of the trigger) + Timing 15 + Stop 20 (beyond the trigger candle, no wider than the rule's limit) + Discipline 15. Missing it scores ~15. Entering more than 3 bars late is "Chased."
- P&L is shown but not scored. At the end, the chart reveals the trigger bar or explains why the setup didn't qualify.
- **Free play** has no rules and is scored on P&L, capture, heat taken and discipline.

## Project layout
```
src/
  core/      pure logic, no DOM: bars/VWAP, indicators, fills, grading, demo data
  setups/    one file per setup (rule text + evaluator + chart plots); index.ts is the registry
  data/      Alpaca client and bar conversion (used by the dev server)
  engine/    replay clock, orders, fills, grading for one rep (no UI)
  ui/        React screens (Home, Session, ChartPane, IndicatorPanel) + ChartView (chart wrapper)
  main.ts    entry point
server/      Vite plugin: syncs data at startup; serves /api/data, /api/status, /api/history
data/        local data cache (gitignored)
tests/       Vitest unit tests
```

### Adding a setup
1. Copy a file in `src/setups/` (e.g. `macd.ts`) and change `id`, labels, `rule`, `evaluate`, and `plots` if it needs indicators.
2. Add it to the `SETUPS` array in `src/setups/index.ts`.
3. `npm test`: every registered setup is automatically checked to produce both valid and no-trade charts on demo data.

Charts are TradingView Lightweight Charts (Apache 2.0). The TradingView logo on the chart is the required attribution.
