# Setup Drill (POC)

Practice day-trading setups on replayed 1-minute charts. Pick a setup, get a random day where it happened, trade it blind, get scored.

## Run it
Open `dist/drill.html` in a browser. No install, no server. It runs on randomly generated demo data until you add real data.

## Real data (free, personal use)
**Easiest:** open `dist/drill.html` from your computer and click **Get real data (free)**.
1. Sign up at alpaca.markets as an individual (**Trading API**, not Broker API) and stay in **Paper Trading**. No deposit is needed.
2. On the paper dashboard, click **API Keys → Generate**, then paste the Key ID and Secret into the app.
3. Pick stocks and how many random days to sample (100 days takes about 2 minutes). The data is cached in your browser, and the keys are never saved.

This doesn't work in the online demo, because it blocks outside requests. Use the downloaded file.

**Fallback:** if your browser blocks the request, run the script and reload:
```
export APCA_API_KEY_ID=your_key  APCA_API_SECRET_KEY=your_secret
python3 fetch_alpaca.py --days 120 --years 3
```
This writes `dist/data/days.js`. Python 3.9+ standard library only.

Alpaca's free tier serves full-market (SIP) history as long as it's more than 15 minutes old. The data is for your own use only: Alpaca doesn't allow redistributing it.

## Controls
`→` step one bar · `Space` play/pause · click the chart to set your stop · `B` buy / `S` short · `F` flatten · `E` end rep · `N` next rep

## How setup drills work
Each setup has an explicit rule, shown during the rep (e.g. ORB: a 1-min candle *closes* outside the opening range on ≥1.5× relative volume within 90 min). About half the charts you get contain a valid trigger. The other half have the context (a range, a gap, a VWAP stretch) but the rule never fires. Near-misses like low-volume breaks or wrong-side-of-VWAP breaks are common there.

You're graded on the **decision**, not the P&L:
- **No valid setup:** pass = 100. Any trade = "Forced trade" (≤20).
- **Valid setup:** Decision 50 (right direction within 3 bars of the trigger) + Timing 15 + Stop 20 (beyond the trigger candle, no wider than the rule's limit) + Discipline 15 (early, wrong-way or extra trades cost points). Missing it scores 15. Entering more than 3 bars late is "Chased."
- The P&L outcome is shown but not scored. At the end, the chart reveals the trigger bar or explains why the setup didn't qualify.

### Setups
- Price action: Opening Range Breakout, Gap & Go, VWAP Reclaim
- Indicators (each shows only what it needs):
  - **9/20 EMA Pullback:** trend, pullback to the 20 EMA, resumption past the 9 EMA; no-trade if it closes through the 20
  - **MACD Cross (12, 26, 9):** valid only on the trend side of the zero line
  - **RSI Reclaim + 50 SMA:** RSI back over 30 (or under 70), valid only with the 50 SMA sloping your way

Indicators are computed on 1-minute bars and restart each day (no prior-day warmup), so indicator drills start later in the session.

**Free play** has no rules and is scored on P&L and trade management.

Rule thresholds live in `src/core.js` (`evalORB`, `evalGap`, `evalVWAP`). Change them to match your own playbook.

## Files
- `src/core.js`: replay, fills, setup detectors (ORB, Gap & Go, VWAP reclaim), scoring, demo data
- `src/app.js`, `src/template.html`: UI
- `build.js`: bundles everything into `dist/drill.html` (`npm i && node build.js`)
- `fetch_alpaca.py`: data pull
- `tests/`: `node --test tests/core.test.js`

Charts are TradingView Lightweight Charts (Apache 2.0). The TradingView logo on the chart is the required attribution.
