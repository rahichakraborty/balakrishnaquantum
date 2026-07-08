# BalakrishnaQuantum (BKQ) — v1

First working version of the site. This is a static site — no build step, no backend server required to get it live.

## What's in this version

- **`index.html`** — homepage with the live dashboard: TradingView chart + watchlist, Fear & Greed, funding/OI/volume, a self-computed Max Pain (Deribit options data), a live liquidation feed (Binance forceOrder WebSocket), placeholders for your X List and Telegram feeds, the philosophy section, all 9 indicators, a blog preview, and the founder/about section.
- **`blog/index.html`** — running archive of daily briefings.
- **`blog/2026-07-09-premarket.html`** — one sample briefing, styled and structured as the template every future automated post should follow.
- **`.github/workflows/daily-briefing.yml`** — the scheduled automation, scaffolded but **not active yet** (see below).

## Go live on GitHub Pages (5 minutes)

1. Create a new GitHub repo (public), push these files to it.
2. Repo → Settings → Pages → Source: deploy from `main` branch, root folder.
3. Repo → Settings → Pages → Custom domain: enter `balakrishnaquantum.com`.
4. At your domain registrar, add these DNS records:
   - **A records** (4 of them) pointing `@` to: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - **CNAME record**: `www` → `yourusername.github.io`
5. Wait for DNS to propagate (can take a few minutes to a few hours), then check "Enforce HTTPS" in the Pages settings once it's available.

## Things to customize before/after going live

- **X List feed**: find `YOUR_LIST_ID` in `index.html` and replace it with your real X List's numeric ID (from a URL like `https://twitter.com/i/lists/1234567890`).
- **Telegram feed**: find `CHANNEL_NAME` in `index.html` and replace it with a real public Telegram channel username.
- **Indicator links**: each indicator card in `index.html` has two placeholder `<a href="#">` links — point these to your actual published TradingView scripts and hosted PDF guidebooks once those are uploaded.
- **Founder bio**: the `#about` section content is a first draft — edit freely.

## Wiring up the daily briefing (next step, not done yet)

The workflow file runs on a schedule but currently has no script to call. To make it real:

1. Write `scripts/generate_briefing.py` — it should:
   - Pull BTC/ETH/SOL from Binance, PAXG/silver from a spot source, SPX/NDX/named stocks from a free equities API, and sentiment from Alternative.me.
   - Either template the numbers directly into HTML, or call the Anthropic API with those numbers to have Claude write the narrative in the same voice as `blog/2026-07-09-premarket.html`.
   - Write the result to `blog/YYYY-MM-DD-premarket.html` and add a new row to `blog/index.html`.
2. If using the Claude API step, add an `ANTHROPIC_API_KEY` secret under repo Settings → Secrets and variables → Actions.
3. Test it manually first via the Actions tab → "Daily Pre-Market Briefing" → "Run workflow" (the `workflow_dispatch` trigger in the yml enables this) before trusting the schedule.

## Known limitations in this first version

- Liquidation panel is a **live approximation**, not Coinglass's actual heatmap model — it streams real Binance forced-liquidation events and buckets them, which is free and genuinely live, but won't visually match Coinglass's paid heatmap product.
- Max Pain calculation queries Deribit's public API for up to 60 strikes on the nearest BTC options expiry — on a slow connection this panel may take a few seconds to populate.
- No trade journal or orderflow tool yet — both are flagged as "soon" in the nav and are the planned next builds.
- All social feed embeds require your own List/channel to be filled in — they will show a placeholder note otherwise, not a broken widget.
