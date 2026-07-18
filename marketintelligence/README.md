# BKQ Market Intelligence — Engine

Automated, 100% free-tier crypto market briefing that powers
`balakrishnaquantum.com/marketintelligence`, plus wiring for the full
Macro Command Panel at `balakrishnaquantum.com/marketintelligence/macro.html`.

## Repo layout (this is the whole repo root)

```
balakrishnaquantum/
├── index.html                          <- homepage, links added in top bar
├── finance.html                        <- nav + cockpit-grid links added
├── .github/workflows/update-market.yml <- MUST stay at repo root, not inside marketintelligence/
└── marketintelligence/
    ├── index.html      <- Market Intelligence (crypto bias dashboard, this engine)
    ├── macro.html       <- Macro Command Panel (your existing dashboard, nav-wired)
    ├── css/market.css
    ├── js/market.js
    ├── data/
    │   ├── market.json
    │   ├── events.json
    │   └── history/YYYY-MM-DD.json
    └── python/
        ├── config.py / indicators.py / news.py / macro.py / scoring.py / writer.py / engine.py
        └── requirements.txt
```

## How it works

```
python/engine.py
   ├── indicators.py   -> CoinGecko (price, dominance, S/R, SMA20)
   ├── news.py         -> Cointelegraph / CoinDesk RSS + keyword sentiment
   ├── macro.py        -> data/events.json (hand-maintained calendar)
   └── scoring.py       -> combines everything into Macro/Technical/Flow/Risk
        └── writer.py  -> writes data/market.json + data/history/YYYY-MM-DD.json
```

GitHub Actions (`.github/workflows/update-market.yml`) runs this every day at
**09:00 IST** and commits the refreshed `market.json` automatically. Your
existing `index.html` / `market.js` just needs to read from
`data/market.json` — nothing on the frontend has to change if it already
matches the field names below.

## `market.json` schema

```jsonc
{
  "last_updated": { "date": "18 Jul 2026", "time": "09:00 IST", "iso": "..." },
  "overall": {
    "emoji": "🟢", "bias": "Mild Bullish", "confidence": 78,
    "todays_trade": "Buy Pullbacks", "preferred_asset": "BTC",
    "risk_level": "Medium", "risk_note": "Watch Headlines", "conviction": 78
  },
  "assets": {
    "BTC": { "name": "Bitcoin", "bias": "Bullish", "confidence": 76,
             "support": 63850, "resistance": 64150,
             "trade_plan": "Buy pullbacks while above support." },
    "ETH": { ... same shape ... }
  },
  "scores": { "macro": 84, "flow": 73, "technical": 81, "risk": 34 },
  "drivers": [ { "emoji": "✅", "text": "Bitcoin ETF flows remain positive." }, ... ],
  "events": [ { "label": "CPI", "when": "5 Days", "raw_days": 5 }, ... ],
  "checklist": { "ETF": "green", "Funding": "green", ... }
}
```

**Important:** compare this against your live `market.js` field names. If
your frontend expects different keys (e.g. `confidence` vs `score`), either
rename here or add a tiny adapter in `market.js` — say the word and I'll
generate the adapter.

## One-time setup

1. This zip's top level **is your repo root** — merge it directly in:
   `index.html`, `finance.html`, `.github/workflows/update-market.yml`, and
   `marketintelligence/` all overlay onto your existing repo.
2. `index.html` and `finance.html` here already have your original content
   plus the new Market Intel / Macro links spliced in — diff them against
   what's live if you've changed anything since you sent me those files.
3. Commit and push.
4. In GitHub → your repo → **Settings → Actions → General → Workflow
   permissions**, select "Read and write permissions" (needed for the bot
   to commit `market.json` back).
5. Go to the **Actions** tab → "Update BKQ Market Intelligence" → **Run
   workflow** to trigger it manually the first time and confirm it's green.

After that it runs on its own every morning at 09:00 IST.

`macro.html` is your existing Macro Command Panel, unchanged except for a
new "BKQ Site" nav group at the top of its sidebar (Home / Finance / Market
Intelligence) — none of its internal routing or live-data logic was touched.

## Maintaining the macro calendar

`data/events.json` is hand-edited — there's no reliable free API for a
forward crypto/economic calendar. Update dates here whenever something
shifts (e.g. once the CLARITY Act moves from "Awaiting Senate" to a
scheduled floor vote date). Takes 30 seconds:

```json
{ "label": "CLARITY Act", "date": "2026-08-05", "note": "Senate floor vote" }
```

(Swap `"status": "Awaiting Senate"` for a real `"date"` once one is set —
`macro.py` will then compute the countdown automatically.)

## Known limitations (free-tier tradeoffs)

- **ETF flow score** is currently a proxy (24h market-cap-weighted price
  change + BTC dominance), not real ETF creation/redemption data — those
  feeds (SoSoValue, Farside) aren't free. The `ETF`/`Funding`/`Open
  Interest` checklist rows are similarly placeholders until a funding-rate
  and OI feed is wired in (Binance's public futures endpoints are free and
  a natural next step — say the word and I'll add them).
- **News sentiment** is keyword-based, not an LLM sentiment model — it's
  simple on purpose, so you can see exactly why a headline was tagged
  bullish/bearish (see `config.py` → `BULLISH_KEYWORDS` / `BEARISH_KEYWORDS`).
- Support/Resistance is a simple 7-day rolling low/high, not a real
  pivot-point or volume-profile calculation.

## Roadmap (matches the original plan)

- v1 (this): dashboard + automated data + daily bias — **done**
- v2: accuracy tracking against `data/history/`, historical charts, real
  ETF-flow feed
- v3: funding rates, open interest, liquidation heatmap (Binance/Bybit free
  endpoints)
- v4: Telegram/email daily briefing, multi-asset (indices, gold, DXY)
