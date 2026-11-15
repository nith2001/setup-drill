#!/usr/bin/env python3
"""
Pull free historical 1-minute bars from Alpaca and write dist/data/days.js for Setup Drill.

Free Alpaca account (paper trading is fine). Historical SIP (all-exchange) data is free
as long as it is older than 15 minutes, so feed=sip works for practice data.

  export APCA_API_KEY_ID=...   APCA_API_SECRET_KEY=...
  python3 fetch_alpaca.py --days 120 --years 3
  python3 fetch_alpaca.py --symbols AAPL,TSLA,NVDA --days 60

Personal use only: Alpaca's terms don't allow redistributing this data.
"""
import argparse, datetime as dt, json, os, random, sys, time, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
BASE = "https://data.alpaca.markets/v2/stocks/bars"
DEFAULT_SYMBOLS = "AAPL,MSFT,NVDA,TSLA,AMD,META,AMZN,GOOGL,NFLX,COIN,PLTR,SHOP,UBER,SQ,BA,JPM,XOM,SMCI,MU,SOFI"


def get(params, key, secret):
    url = BASE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 + attempt * 3); continue
            raise SystemExit(f"Alpaca error {e.code}: {e.read().decode()[:300]}")
    raise SystemExit("Rate limited too many times")


def fetch_bars(symbols, timeframe, start, end, key, secret):
    """Returns {sym: [bar,...]} following next_page_token."""
    out, token = {}, None
    while True:
        p = {"symbols": ",".join(symbols), "timeframe": timeframe, "start": start, "end": end,
             "limit": 10000, "adjustment": "split", "feed": "sip"}
        if token: p["page_token"] = token
        js = get(p, key, secret)
        for s, bars in (js.get("bars") or {}).items():
            out.setdefault(s, []).extend(bars)
        token = js.get("next_page_token")
        time.sleep(0.35)  # stay well under 200 req/min
        if not token: return out


def to_day(sym, date, bars, prev_close):
    """Regular session only, 1 bar per minute from 09:30 ET; gaps filled flat with 0 volume."""
    by_min = {}
    for b in bars:
        t = dt.datetime.fromisoformat(b["t"].replace("Z", "+00:00")).astimezone(ET)
        m = (t.hour * 60 + t.minute) - (9 * 60 + 30)
        if 0 <= m < 390: by_min[m] = b
    if len(by_min) < 150 or 0 not in by_min and 1 not in by_min: return None
    last_m = max(by_min)
    o, h, l, c, v = [], [], [], [], []
    prev = by_min.get(0, by_min[min(by_min)])["o"]
    for m in range(last_m + 1):
        b = by_min.get(m)
        if b: vals = (b["o"], b["h"], b["l"], b["c"], b["v"]); prev = b["c"]
        else: vals = (prev, prev, prev, prev, 0)
        for arr, x in zip((o, h, l, c), vals[:4]): arr.append(round(x, 2))
        v.append(int(vals[4]))
    return {"sym": sym, "date": date, "pc": prev_close, "o": o, "h": h, "l": l, "c": c, "v": v}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=DEFAULT_SYMBOLS)
    ap.add_argument("--days", type=int, default=120, help="random trading days to sample")
    ap.add_argument("--years", type=float, default=3, help="sample from the last N years")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "dist", "data", "days.js"))
    a = ap.parse_args()
    key, secret = os.environ.get("APCA_API_KEY_ID"), os.environ.get("APCA_API_SECRET_KEY")
    if not key or not secret: sys.exit("Set APCA_API_KEY_ID and APCA_API_SECRET_KEY (free at alpaca.markets)")
    syms = [s.strip().upper() for s in a.symbols.split(",") if s.strip()]

    today = dt.date.today()
    first = today - dt.timedelta(days=int(a.years * 365))
    weekdays = [first + dt.timedelta(d) for d in range((today - first).days) if (first + dt.timedelta(d)).weekday() < 5]
    dates = sorted(random.sample(weekdays[:-1], min(a.days, len(weekdays) - 1)))

    print(f"Daily bars for prev close ({len(syms)} symbols)...")
    daily = fetch_bars(syms, "1Day", first.isoformat(), today.isoformat(), key, secret)
    closes = {s: {b["t"][:10]: b["c"] for b in bars} for s, bars in daily.items()}

    days = []
    for i, d in enumerate(dates, 1):
        ds = d.isoformat()
        print(f"[{i}/{len(dates)}] {ds}", end=" ", flush=True)
        mb = fetch_bars(syms, "1Min", f"{ds}T13:00:00Z", f"{ds}T21:00:00Z", key, secret)
        n = 0
        for s, bars in mb.items():
            prior = [k for k in closes.get(s, {}) if k < ds]
            pc = closes[s][max(prior)] if prior else None
            day = to_day(s, ds, bars, pc)
            if day: days.append(day); n += 1
        print(f"{n} symbol-days" if n else "(holiday/no data)")

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    meta = {"source": "alpaca sip historical", "symbols": syms, "generated": today.isoformat()}
    with open(a.out, "w") as f:
        f.write("window.DRILL_DATA=" + json.dumps({"meta": meta, "days": days}, separators=(",", ":")) + ";")
    print(f"Wrote {len(days)} symbol-days to {a.out} ({os.path.getsize(a.out)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
