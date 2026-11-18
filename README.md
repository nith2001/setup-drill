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
`.env` knobs: `SYNC_DAYS` (100 random dates), `SYNC_YEARS` (3), `SYNC_SYMBOLS`, `SYNC_INDEX_SYMBOLS` (SPY,QQQ), `SYNC_INDEX_DAYS` (500). Changing symbols adds to the cache instead of resetting it.

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

## The app
Three tabs:
- **Practice**: pick a setup drill or free play. Shows today's reps, P&L and your streak. Every setup card has a **Tutorial**: a real chart where the setup worked, replayed from before the pattern. It explains the idea and what to look for, then plays forward and stops at each key moment (point 1, 2, 3; the pole; the retest…) with an explanation, shows the entry, stop and target (and why the target is there) at the trigger, then the result and the common mistakes. Each card also has **See an example**: a real chart, already played out, with the pattern labelled and the textbook entry, stop and target drawn. From there you can switch to a **valid one that lost** (every rule met, still stopped out: a well-played losing trade) or a **no-trade** example (a fakeout or failed version), or replay it with ↺ to watch it form. Drills pick valid charts regardless of how they turned out, so many valid reps lose; the grade sheet says so and still scores the decision.
- **Journal**: your trade diary. Every finished rep is saved with its trades (entry, exit, stop, ticks, $ P&L, R), the grade, and your notes and tags. See net P&L, win rate, average win/loss, profit factor, right-call rate, an equity curve, a per-setup breakdown and your most-used tags. Filter by 7 / 30 days or by setup; export CSV (one row per trade) or JSON.
- **Settings**: **Practice on** (SPY/QQQ, stocks, or everything), **rule candles** (5-min default, or 1-min), blind mode, opening range length, free play start (random time or the open) and length, account size, risk per trade, take-profit R, how live P&L is shown (ticks / $ / R), market data status.

**Where the journal lives:** `journal/journal.json` in this folder, a plain JSON file written by the dev server (gitignored, never committed). Back it up like any file. If the dev server isn't reachable, entries are kept in the browser until it is. History saved by older versions of the app is imported into the file automatically.

See a chart that doesn't fit the strategy (a bad example, a wrong label, a no-trade that should count)? Press **⚑ Report** in the top bar, tick what's wrong and add a note. Reports are saved locally in `reports/reports.jsonl`; `npm run reports` lists them and shows what the current rules say about each chart. `npm run audit` shows each setup's pool size and how its textbook trades did on the cached data.

**The model every setup follows:** bias (4-hour week + older levels) → the setup's price action (levels need two touches; indicators need to be proven and retested) → a **trigger candle** right after it (bullish engulfing or hammer for longs; bearish engulfing or shooting star for shorts) → enter at that candle's close. Gap & Go uses its breakout candle as the trigger.

**Bias first.** Every setup follows your process: bias, then pattern, then trigger. The bias comes from the **past week on the 4-hour chart** (decided before the day, so nothing is peeked): higher highs and higher lows = **up** (longs only), lower highs and lower lows = **down** (shorts only), anything else = **sideways**. Older levels win: if the week ran into support or resistance that price turned at twice in the past ~3 months (daily chart) and got **rejected**, the bias turns with the rejection; still pressing into it with no rejection = **wait** (no trades). A **sideways** week is a range day: Range Fade and S/R Retest trade both edges, breakout and trend setups pass. A pattern against the bias is a no-trade chart, and the explanation tells you the bias. Drills are half valid, half no-trade; a third of the no-trade charts are **quiet**: the setup never even starts, like most of a real day (not for the open-only setups: ORB, ORB Retest, Gap). Check it yourself on the 4h and daily timeframes before you trade.

**Real-time replay.** Price moves inside each candle, so a 1-minute candle takes a real minute to form at **1× real time** (and a 5-minute candle five minutes). Speed is a time multiplier (1×, 2×, 5×, 10×, 30×, 60×, 300×; `+`/`−` keys): faster speeds play the same price movement, just faster. Drills and free play start at 1×; tutorials and examples at 60×. With **Slow down on entry** (Settings, on by default) the replay drops to 1× when you open a trade, so you manage it live. ▶| and → still jump straight to the next candle's close. The movement inside each minute is simulated (the data only has each minute's open/high/low/close), but every finished candle matches the real data. Stops and targets fill when price actually reaches them along that path.

**Moving the chart.** Drag in any direction to pan, like TradingView. Dragging up or down turns off auto-scale so you can move freely; click **Auto** (bottom-right of the chart) or double-click the price axis to fit the candles again.

After each rep, tag it (Followed plan, Chased, FOMO, Moved stop…) and jot a note right on the grade sheet.

## The setups
Support/resistance and indicator setups follow one model: **prove it, retest it, confirm it.** A level or indicator counts only after price has turned there once (touch 1). You trade the retest (touch 2), and only after a candle confirms the turn. The prior-day high/low/close and daily SMAs count as levels only once price has turned at them.

| Setup | Valid when | Key no-trade cases | Target |
|---|---|---|---|
| ORB Breakout | first close outside the 15-min range, in the bias direction, on a strong candle (body ≥ 60%, closes in the top quarter, or engulfing) with at least normal volume for that time of day | weak or wicky breakout candle, below-normal volume | 2R |
| ORB Retest | breakout of the first 15-min range on 1.5× volume (vs the previous 10 candles), price pushes on, pulls back to the range edge and holds, then a bullish engulfing or hammer | weak-volume break, close back inside the range (failed breakout), no retest, no trigger candle | 2R |
| Gap & Go | 1.5%+ gap closes through the 5-min range on the right side of VWAP | no follow-through by 10:05 | 2R |
| 1-2-3 Pattern | long bias, swing low (1), swing high (2), higher low (3) 2+ candles after 2 and 25%+ deep, trigger candle (engulfing, hammer or strong candle) closes above 2 (4) | against the bias, no trigger candle within 3 candles of the break, 3 breaks below 1, pullback too shallow | 2R |
| Flag Breakout | fast pole, a flag giving back ≤ 61.8%, a trigger candle (engulfing, hammer or strong candle) closes above the pole high | flag too deep, drags on, weak or wicky breakout candle | measured move (pole length) |
| VWAP Bounce | price on one side of VWAP; touch 1 bounces; touch 2 closes back on its side; then a bullish engulfing or hammer | close through VWAP, no trigger candle | 2R |
| 9/20 EMA Pullback | trend (9 over a rising 20); touch 1 of the 20 bounces; touch 2 holds; then a bullish engulfing or hammer | close below the 20, no trigger candle | 2R |
| S/R Retest | two swing lows at a common price (or prior day low + one); price comes back a third time and holds; then a bullish engulfing or hammer | close through the level, no trigger candle, target < 1.5R | bounce high between the touches |
| S/R Flip (Break & Retest) | resistance breaks (two highs at a common price today, the prior day high, or an older daily level tested twice); price moves away, comes back to it from above and holds; then a bullish engulfing or hammer | close back through (fakeout), no retest, no trigger candle | 2R |
| Range Fade | 60-min range, 2+ touches of each edge, VWAP inside; at an edge a reversal candle (engulfing / hammer, or the bearish versions at the top) | breakout, no turn, target < 1.5R | the other side of the range |
| MACD Cross | MACD crosses its signal on the trend side of zero, after 8 quiet candles; then a bullish engulfing or hammer within 3 candles | counter-trend cross, no trigger candle | 2R |
| RSI Reclaim + 50 SMA | RSI dips below 35 and closes back above with the 50 SMA rising; then a bullish engulfing or hammer within 3 candles | 50 SMA falling, no trigger candle | 2R |

**Targets.** Where structure gives an obvious place price turned before (the bounce after touch 1, the other side of a range, a flag's measured move), that is the target, and the trade is skipped if it's less than 1.5R away. Continuation trades (trend, flip, indicator bounces) head for new highs with nothing ahead, so they use a fixed 2R. Examples and tutorials show the target and why it's there.

Mirror rules apply for shorts. Thresholds are constants at the top of each file in `src/setups/`.

**Candles.** Rules run on **5-minute candles** by default (Settings → Rule candles). "Enter within 3 candles" means three 5-min candles, the stop goes beyond the 5-min trigger candle, and drills open on the 5m chart. Fills are still checked minute by minute. Size thresholds are in *average candles* (the instrument's own typical 5-min range), so "a real move" means the same on SPY as on NVDA. Indicators on 5-min rules are warmed up with the previous session, so the EMAs match the chart from the open. A day can hold several events of a setup; each is its own rep.

**Symbols.** The sync downloads 100 random dates for 20 stocks, plus ~500 consecutive recent days of **SPY and QQQ** (stand-ins for ES and NQ futures). Practice defaults to SPY/QQQ. Gap & Go rarely triggers on index ETFs (gaps of 1.5%+ are rare).

**Indicators** (`I`): moving averages (any EMA/SMA), VWAP, volume, RSI, MACD, plus three level overlays: **Opening range**, **Prior day high / low / close**, and **Daily 50 & 200 SMA** (the daily averages drawn as lines on intraday charts; a 200 SMA on a 1-min chart is only 200 minutes). Drills switch on what they need.

## The screen
Laid out like TradingView: timeframes and indicators across the top, drawing tools on the left, a replay bar floating over the chart, the order panel on the right, and positions / trade history / account balance along the bottom.

**Placing a trade.** Set your risk in **$** or **% of balance** and a take-profit R (1R–3R) in the order panel; the share count is worked out for you, capped at 4× buying power. Click Buy or Sell (or press `B`/`S`) to send a market order. The stop (5-bar extreme by default) and target appear on the chart once you're in, on the side you traded. Drag either line, type a price, move the stop to breakeven, remove the TP, or close. Live P&L shows in ticks, $ or R.

Account starts at **$50,000** each rep. Order settings (risk, R:R) are remembered. **Contracts** start at 1 each rep: one contract risks your risk-per-trade (1R), so 2 contracts risk 2R and a full stop-out is −2R. In a trade, the entry line and the position panel show one **R:R** (target vs the current stop, updating as you drag either line) plus your 1R.

## Controls
| Key | Action |
|---|---|
| `→` / `Shift+→` | Next candle on the current timeframe / one minute |
| `Space` | Play / pause (speed 1–60 min of market time per second) |
| `1`–`6` | Timeframe: 1m, 5m, 15m, 1h, 4h, 1D |
| `I` | Indicators: any number of EMAs/SMAs (any length), VWAP, volume, RSI, MACD |
| `Alt+T` / `Alt+H` / `Alt+B` | Trend line / horizontal line / box (click to place, two clicks for lines and boxes; drag to move; `Del` deletes; `Esc` cancels) |
| `B` / `S` | Buy / sell short at market with the current ticket |
| `F` | Close position |
| `R` | Restart the chart from the beginning (practice only: just the first run of a chart goes in your journal) |
| `E` / `N` | Finish and grade the rep / next rep |

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
  setups/    one file per setup (rule text + evaluator + indicator preset); util.ts = swings, key levels; index.ts is the registry
  data/      Alpaca client and bar conversion (used by the dev server)
  engine/    replay clock, orders, fills, grading for one rep (no UI)
  ui/        React screens (Home, Session, ChartPane, IndicatorPanel) + ChartView (chart wrapper)
  main.ts    entry point
server/      Vite plugin: syncs data at startup; serves /api/data, /api/status, /api/history
data/        local data cache (gitignored)
tests/       Vitest unit tests
```

### Adding a setup
1. Copy a file in `src/setups/` (e.g. `srFlip.ts`) and change `id`, labels, `rule`, `evaluate`, and `preset` (the indicators its drills show). Add its lesson to `src/setups/lessons.ts` (keys in `steps` match the `marks` text). Return `marks` (labelled points) and `lines` (levels) so the grade sheet and examples can show the pattern.
2. Add it to the `SETUPS` array in `src/setups/index.ts`.
3. `npm test`: every registered setup is automatically checked to produce both valid and no-trade charts on demo data.

Charts are TradingView Lightweight Charts (Apache 2.0). The TradingView logo on the chart is the required attribution.

## License

MIT. See [LICENSE](LICENSE). Market data you sync with your own Alpaca key is not covered and stays out of the repo.
