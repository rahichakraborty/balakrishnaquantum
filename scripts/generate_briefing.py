#!/usr/bin/env python3
"""
BKQ Daily Pre-Market Briefing Generator
Runs via GitHub Actions daily at 06:30 UTC (12:00 PM IST).

Pulls live BTC/ETH/SOL/PAXG data, sentiment, and a couple of fresh news
headlines, then asks Claude to write the narrative in the site's house
style. Falls back to a plain templated version (no AI prose) if the
Claude call fails for any reason, so the workflow never breaks outright.

Writes:
  - blog/YYYY-MM-DD-premarket.html   (the new post)
  - blog/index.html                  (prepends a row for the new post)
  - index.html                       (updates the homepage preview card)
"""
import os
import re
import json
import datetime
import xml.etree.ElementTree as ET
import urllib.request
import urllib.error

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = "claude-sonnet-5"

IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
NOW_IST = datetime.datetime.now(datetime.timezone.utc).astimezone(IST)
DATE_STR = NOW_IST.strftime("%Y-%m-%d")
DATE_HUMAN = NOW_IST.strftime("%b %d, %Y")


def get_json(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (BKQ-Briefing-Bot)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def get_text(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (BKQ-Briefing-Bot)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode(errors="ignore")


# ---------------- Market data ----------------
COINGECKO_IDS = {
    "BTCUSDT": "bitcoin", "ETHUSDT": "ethereum", "SOLUSDT": "solana", "PAXGUSDT": "pax-gold"
}

def fetch_binance_ticker(symbol):
    try:
        d = get_json(f"https://api.binance.com/api/v3/ticker/24hr?symbol={symbol}")
        return {"price": float(d["lastPrice"]), "change": float(d["priceChangePercent"])}
    except Exception as e:
        print(f"Binance fetch failed for {symbol} ({e}), trying CoinGecko fallback...")
        return fetch_coingecko_ticker(symbol)


def fetch_coingecko_ticker(symbol):
    """Fallback for when Binance blocks/rate-limits the CI runner's IP (a known,
    recurring issue — cloud/CI datacenter IP ranges are frequently rate-limited by
    exchanges regardless of request volume)."""
    coin_id = COINGECKO_IDS.get(symbol)
    if not coin_id:
        return None
    try:
        d = get_json(f"https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies=usd&include_24hr_change=true")
        entry = d.get(coin_id, {})
        if "usd" not in entry:
            return None
        return {"price": float(entry["usd"]), "change": float(entry.get("usd_24h_change", 0))}
    except Exception as e:
        print(f"CoinGecko fallback also failed for {symbol} ({e})")
        return None


def fetch_btc_pivots():
    """Classic floor pivots from the previous completed daily candle."""
    try:
        kl = get_json("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=2")
        y = kl[0]
        h, l, c = float(y[2]), float(y[3]), float(y[4])
        return _calc_pivots(h, l, c)
    except Exception as e:
        print(f"Binance klines fetch failed ({e}), trying CoinGecko OHLC fallback...")
        try:
            ohlc = get_json("https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=2")
            y = ohlc[-2] if len(ohlc) >= 2 else ohlc[-1]  # [timestamp, open, high, low, close]
            h, l, c = float(y[2]), float(y[3]), float(y[4])
            return _calc_pivots(h, l, c)
        except Exception as e2:
            print(f"CoinGecko OHLC fallback also failed ({e2})")
            return None


def _calc_pivots(h, l, c):
    p = (h + l + c) / 3
    r1, s1 = 2 * p - l, 2 * p - h
    r2, s2 = p + (h - l), p - (h - l)
    return {"p": p, "r1": r1, "r2": r2, "s1": s1, "s2": s2}


def fetch_fear_greed():
    try:
        d = get_json("https://pro-api.coinmarketcap.com/public-api/v3/fear-and-greed/latest")
        v = d["data"]
        return {"value": int(v["value"]), "label": v["value_classification"]}
    except Exception:
        try:
            d = get_json("https://api.alternative.me/fng/?limit=1")
            v = d["data"][0]
            return {"value": int(v["value"]), "label": v["value_classification"]}
        except Exception:
            return None


def fetch_dxy():
    hosts = [
        "https://api.frankfurter.app/latest?from=USD&to=EUR,JPY,GBP,CAD,SEK,CHF",
        "https://api.frankfurter.dev/v1/latest?from=USD&to=EUR,JPY,GBP,CAD,SEK,CHF",
    ]
    for url in hosts:
        try:
            d = get_json(url)
            r = d["rates"]
            dxy = (50.14348112
                   * (1 / r["EUR"]) ** -0.576 * r["JPY"] ** 0.136 * (1 / r["GBP"]) ** -0.119
                   * r["CAD"] ** 0.091 * r["SEK"] ** 0.042 * r["CHF"] ** 0.036)
            return round(dxy, 2)
        except Exception:
            continue
    return None


def fetch_headlines(rss_url, limit=3):
    try:
        xml_text = get_text(rss_url)
        root = ET.fromstring(xml_text)
        items = root.findall(".//item")[:limit]
        out = []
        for it in items:
            title = it.findtext("title") or ""
            out.append(title.strip())
        return out
    except Exception:
        return []


# ---------------- Yahoo Finance (indices, equities, commodities) ----------------
# Unofficial but very widely used and stable endpoint. Requires a real browser
# User-Agent — the default urllib/requests UA gets rejected outright.
YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def fetch_yahoo_series(symbol, rng="5d", interval="1d"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={rng}&interval={interval}"
    req = urllib.request.Request(url, headers={"User-Agent": YAHOO_UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode())
    result = data["chart"]["result"][0]
    closes = result["indicators"]["quote"][0]["close"]
    closes = [c for c in closes if c is not None]
    return closes


def fetch_index_quote(symbol, label):
    """Returns price + % change vs previous close, for indices/equities/commodities
    that Binance doesn't cover. Change computed from the last two closes rather than
    relying on meta fields, which vary in availability across symbols."""
    try:
        closes = fetch_yahoo_series(symbol, rng="5d")
        if len(closes) < 2:
            return None
        price, prev = closes[-1], closes[-2]
        change_pct = (price - prev) / prev * 100
        return {"label": label, "price": price, "change": change_pct}
    except Exception as e:
        print(f"Yahoo fetch failed for {symbol} ({label}): {e}")
        return None


# ---------------- Technical indicators (pure stdlib, no pandas/numpy needed) ----------------
def compute_ema(closes, period):
    if len(closes) < period:
        return None
    k = 2 / (period + 1)
    ema = sum(closes[:period]) / period  # seed with SMA
    for price in closes[period:]:
        ema = price * k + ema * (1 - k)
    return ema


def compute_rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def compute_bollinger(closes, period=20, num_std=2):
    if len(closes) < period:
        return None
    window = closes[-period:]
    mean = sum(window) / period
    variance = sum((x - mean) ** 2 for x in window) / period
    std = variance ** 0.5
    return {"mid": mean, "upper": mean + num_std * std, "lower": mean - num_std * std}


def fetch_binance_klines_closes(symbol, limit=250):
    """Extended daily close history for technical indicators. Falls back to
    Yahoo's equivalent crypto ticker (e.g. BTC-USD) if Binance is rate-limited."""
    try:
        kl = get_json(f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval=1d&limit={limit}")
        return [float(c[4]) for c in kl]
    except Exception as e:
        print(f"Binance extended klines failed for {symbol} ({e}), trying Yahoo fallback...")
        yahoo_symbol = {"BTCUSDT": "BTC-USD", "ETHUSDT": "ETH-USD"}.get(symbol)
        if not yahoo_symbol:
            return []
        try:
            return fetch_yahoo_series(yahoo_symbol, rng="1y")
        except Exception as e2:
            print(f"Yahoo crypto fallback also failed ({e2})")
            return []


def compute_technical_summary(closes):
    """Everything here is computed directly from real fetched price history —
    nothing here is estimated or invented."""
    if len(closes) < 30:
        return None
    current = closes[-1]
    summary = {
        "current": current,
        "ema20": compute_ema(closes, 20),
        "ema50": compute_ema(closes, 50) if len(closes) >= 50 else None,
        "ema100": compute_ema(closes, 100) if len(closes) >= 100 else None,
        "ema200": compute_ema(closes, 200) if len(closes) >= 200 else None,
        "rsi14": compute_rsi(closes, 14),
        "bollinger": compute_bollinger(closes, 20),
        "recent_30d_high": max(closes[-30:]),
        "recent_30d_low": min(closes[-30:]),
    }
    if len(closes) >= 31:
        month_ago = closes[-31]
        summary["change_30d_pct"] = (current - month_ago) / month_ago * 100
    return summary


# ---------------- Gather everything ----------------
btc = fetch_binance_ticker("BTCUSDT")
eth = fetch_binance_ticker("ETHUSDT")
sol = fetch_binance_ticker("SOLUSDT")
paxg = fetch_binance_ticker("PAXGUSDT")
pivots = fetch_btc_pivots()
fng = fetch_fear_greed()
dxy = fetch_dxy()

# Broader, more targeted news than the generic feeds alone — these queries are
# built to actually surface the kind of macro-moving stories (Fed/rates, Middle
# East/oil, inflation prints) rather than whatever happens to be on a general feed.
crypto_headlines = fetch_headlines("https://cointelegraph.com/rss", limit=4)
global_headlines = fetch_headlines("https://www.investing.com/rss/news.rss", limit=4)
macro_headlines = fetch_headlines(
    "https://news.google.com/rss/search?q=(Federal+Reserve+OR+inflation+OR+CPI+OR+interest+rates)+when:2d&hl=en-US&gl=US&ceid=US:en",
    limit=5,
)
geopolitical_headlines = fetch_headlines(
    "https://news.google.com/rss/search?q=(oil+prices+OR+Iran+OR+Middle+East+OR+crude)+when:2d&hl=en-US&gl=US&ceid=US:en",
    limit=4,
)

# Indian indices — Yahoo Finance, not covered by Binance/crypto sources at all.
sensex = fetch_index_quote("^BSESN", "Sensex")
nifty = fetch_index_quote("^NSEI", "Nifty 50")
banknifty = fetch_index_quote("^NSEBANK", "Bank Nifty")

# US equities — same source, different symbols.
sp500 = fetch_index_quote("^GSPC", "S&P 500")
nasdaq = fetch_index_quote("^IXIC", "Nasdaq")
dow = fetch_index_quote("^DJI", "Dow")

# Commodities — gold futures and Brent crude, supplementing PAXG/DXY.
gold_futures = fetch_index_quote("GC=F", "Gold futures")
brent_crude = fetch_index_quote("BZ=F", "Brent crude")

# Real technical structure for BTC/ETH — every number here is computed directly
# from actual fetched price history, nothing estimated or invented.
btc_closes = fetch_binance_klines_closes("BTCUSDT", limit=250)
eth_closes = fetch_binance_klines_closes("ETHUSDT", limit=250)
btc_technicals = compute_technical_summary(btc_closes) if btc_closes else None
eth_technicals = compute_technical_summary(eth_closes) if eth_closes else None

data_summary = {
    "date": DATE_HUMAN,
    "btc": btc, "eth": eth, "sol": sol, "paxg": paxg,
    "pivots": pivots, "fear_greed": fng, "dxy": dxy,
    "btc_technicals": btc_technicals, "eth_technicals": eth_technicals,
    "sensex": sensex, "nifty": nifty, "banknifty": banknifty,
    "sp500": sp500, "nasdaq": nasdaq, "dow": dow,
    "gold_futures": gold_futures, "brent_crude": brent_crude,
    "crypto_headlines": crypto_headlines, "global_headlines": global_headlines,
    "macro_headlines": macro_headlines, "geopolitical_headlines": geopolitical_headlines,
}


# ---------------- Bias heuristic (used regardless of whether Claude writes prose) ----------------
def compute_bias():
    if not btc or not pivots:
        return "NEUTRAL", "mechanical execution favored"
    price, chg = btc["price"], btc["change"]
    p = pivots["p"]
    if price > p and chg > 0:
        return "LONG BIAS", "price above pivot with positive momentum"
    if price < p and chg < 0:
        return "SHORT BIAS", "price below pivot with negative momentum"
    return "NEUTRAL", "price near pivot — no clean directional edge"


bias_tag, bias_reason = compute_bias()


# ---------------- Claude call (optional — falls back to template on any failure) ----------------
def call_claude():
    if not ANTHROPIC_API_KEY:
        return None
    prompt = f"""You are writing the daily market brief for BalakrishnaQuantum (BKQ), a solo trader's
site. House style: institutional-desk tone, punchy, specific, no fluff, no generic disclaimers in
the body text. Bullet points over paragraphs wherever the data supports it.

CRITICAL — accuracy rules, follow exactly:
- Use ONLY the numbers given to you in the data block below. Never invent, estimate, or guess at
  a specific figure (price, level, percentage, EMA, RSI) that isn't directly present in the data.
- Do NOT mention ETF flows, whale accumulation, or any other on-chain/institutional-flow figures —
  that data was deliberately excluded from this pipeline because it can't be sourced reliably for
  free. Do not reference it, do not approximate it, do not imply it either way.
- If a data point is missing (null), simply omit that specific detail rather than guessing or
  writing around it awkwardly.
- The technical figures (EMAs, RSI, Bollinger Bands, 30-day high/low) ARE real, computed directly
  from actual price history — you may reference these confidently and specifically.

Write these sections as HTML (bullet lists as <ul><li>, no markdown, no <html> wrapper):
1. macro_html — ONE punchy sentence (as a <p>) naming the actual macro driver(s) for today, synthesized
   from the macro/geopolitical headlines below — not a generic "markets await Fed" line, an actual
   specific driver if the headlines support one.
2. crypto_html — <ul> bullets: BTC price + recent range/tone, ETH price + recent range/tone, one
   bullet on overall crypto tone (trending vs. chopping) using the fear/greed context.
3. indices_html — <ul> bullets: Sensex, Nifty 50, Bank Nifty — price, point change, % change, and
   one line of color if a notable support/resistance level is mentioned in headlines or implied by
   the numbers (e.g. "holding above X support").
4. equities_html — <ul> bullets: S&P 500, Nasdaq, Dow — price and % change, one bullet of context
   if the headlines mention a specific earnings/sector driver.
5. commodities_html — <ul> bullets: gold price + % change + one line on what's driving it (DXY,
   rate expectations), Brent crude price + % change + one line on why (only if headlines support it,
   e.g. geopolitical risk — do not invent a reason if none is given).
6. technical_html — <ul> bullets, BTC only, using btc_technicals: current EMA structure (above/below
   20/50/100/200 EMA), RSI14 level and what it implies, Bollinger band position, 30-day high/low as
   support/resistance reference. Every number here must come directly from btc_technicals — do not
   round differently than given or invent additional levels.
7. session_html — 1-2 sentences tying today's setup to BKQ's own recurring patterns: historically
   weak on off-session trades and on PAXG specifically, R:R below 1.0 outside BTC. Reference the
   bias tag: {bias_tag} ({bias_reason}). Make this feel like a specific note for today, not boilerplate.

Data:
{json.dumps(data_summary, indent=2, default=str)}

Return ONLY a JSON object with keys: "headline" (one punchy sentence, no quotes inside),
"macro_html", "crypto_html", "indices_html", "equities_html", "commodities_html", "technical_html",
"session_html" — each a string of HTML. No other text, no markdown fences."""

    body = json.dumps({
        "model": MODEL,
        "max_tokens": 1600,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            resp = json.loads(r.read().decode())
        text = "".join(b["text"] for b in resp["content"] if b["type"] == "text")
        text = re.sub(r"^```json|```$", "", text.strip()).strip()
        return json.loads(text)
    except Exception as e:
        print(f"Claude call failed, falling back to template: {e}")
        return None


def fmt_change(val):
    return f"{val:+.2f}%" if val is not None else "n/a"


def index_bullet(q):
    if not q:
        return None
    return f"<li>{q['label']}: {q['price']:,.2f} ({fmt_change(q['change'])})</li>"


ai = call_claude()

if ai:
    headline = ai.get("headline", "Daily market brief")
    macro_html = ai.get("macro_html", "")
    crypto_html = ai.get("crypto_html", "")
    indices_html = ai.get("indices_html", "")
    equities_html = ai.get("equities_html", "")
    commodities_html = ai.get("commodities_html", "")
    technical_html = ai.get("technical_html", "")
    session_html = ai.get("session_html", "")
else:
    # Richer fallback than before — even without AI prose, all the new real data
    # (indices, equities, commodities, computed technicals) is still available and
    # gets rendered as plain bullet lists, not just a "check headlines yourself" line.
    btc_txt = f"${btc['price']:,.0f} ({btc['change']:+.2f}% 24h)" if btc else "unavailable"
    headline = f"Daily market data update — BTC {btc_txt}"

    macro_html = "<p>Automated macro synthesis unavailable this run — see headlines feeding this page's data sources directly.</p>"

    crypto_bullets = []
    if btc:
        crypto_bullets.append(f"<li>BTC: {btc_txt}</li>")
    if eth:
        crypto_bullets.append(f"<li>ETH: ${eth['price']:,.2f} ({eth['change']:+.2f}%)</li>")
    if sol:
        crypto_bullets.append(f"<li>SOL: ${sol['price']:,.2f} ({sol['change']:+.2f}%)</li>")
    if fng:
        crypto_bullets.append(f"<li>Fear &amp; Greed: {fng['value']} ({fng['label']})</li>")
    crypto_html = "<ul>" + "".join(crypto_bullets) + "</ul>" if crypto_bullets else "<p>Crypto data unavailable this run.</p>"

    idx_bullets = [b for b in [index_bullet(sensex), index_bullet(nifty), index_bullet(banknifty)] if b]
    indices_html = "<ul>" + "".join(idx_bullets) + "</ul>" if idx_bullets else "<p>Indian indices data unavailable this run.</p>"

    eq_bullets = [b for b in [index_bullet(sp500), index_bullet(nasdaq), index_bullet(dow)] if b]
    equities_html = "<ul>" + "".join(eq_bullets) + "</ul>" if eq_bullets else "<p>US equities data unavailable this run.</p>"

    comm_bullets = []
    if gold_futures:
        comm_bullets.append(f"<li>Gold: ${gold_futures['price']:,.0f} ({fmt_change(gold_futures['change'])})</li>")
    if brent_crude:
        comm_bullets.append(f"<li>Brent crude: ${brent_crude['price']:,.2f} ({fmt_change(brent_crude['change'])})</li>")
    if paxg:
        comm_bullets.append(f"<li>PAXG: ${paxg['price']:,.0f} ({paxg['change']:+.2f}%)</li>")
    if dxy:
        comm_bullets.append(f"<li>DXY reference: {dxy}</li>")
    commodities_html = "<ul>" + "".join(comm_bullets) + "</ul>" if comm_bullets else "<p>Commodities data unavailable this run.</p>"

    tech_bullets = []
    if btc_technicals:
        t = btc_technicals
        if t.get("rsi14") is not None:
            tech_bullets.append(f"<li>RSI14: {t['rsi14']:.1f}</li>")
        if t.get("ema50") is not None:
            pos = "above" if t["current"] > t["ema50"] else "below"
            tech_bullets.append(f"<li>Price is {pos} the 50-day EMA (${t['ema50']:,.0f})</li>")
        if t.get("ema200") is not None:
            pos = "above" if t["current"] > t["ema200"] else "below"
            tech_bullets.append(f"<li>Price is {pos} the 200-day EMA (${t['ema200']:,.0f})</li>")
        tech_bullets.append(f"<li>30-day range: ${t['recent_30d_low']:,.0f} – ${t['recent_30d_high']:,.0f}</li>")
    technical_html = "<ul>" + "".join(tech_bullets) + "</ul>" if tech_bullets else ""

    session_html = f"<p>Bias: {bias_tag} — {bias_reason}. Historically a weaker setup off-session and on PAXG specifically — worth the extra discipline today.</p>"

pivot_row = ""
if pivots:
    pivot_row = f"""
  <div class="panel">
    <div class="stat-row"><span class="k">R2</span><span class="v">${pivots['r2']:,.0f}</span></div>
    <div class="stat-row"><span class="k">R1</span><span class="v">${pivots['r1']:,.0f}</span></div>
    <div class="stat-row"><span class="k">Pivot</span><span class="v">${pivots['p']:,.0f}</span></div>
    <div class="stat-row"><span class="k">S1</span><span class="v">${pivots['s1']:,.0f}</span></div>
    <div class="stat-row"><span class="k">S2</span><span class="v">${pivots['s2']:,.0f}</span></div>
  </div>"""

bias_class = "long" if "LONG" in bias_tag else "short" if "SHORT" in bias_tag else "neutral"

POST_HTML = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Daily Market Brief — {DATE_HUMAN} | Balakrishna Quantum</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{{--bg:#0a0d12;--panel:#11151c;--panel-2:#161c25;--line:#232b36;--line-soft:#1a212b;
    --gold:#d4a017;--gold-soft:#f0c453;--teal:#2dd4bf;--orange:#f97316;--text:#e7e6e2;--muted:#8b93a1;--muted-2:#5c6472;
    --green:#22c55e;--red:#ef4444;--mono:'JetBrains Mono',monospace;--sans:'IBM Plex Sans',sans-serif;}}
  *{{box-sizing:border-box;}}
  body{{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);}}
  a{{color:inherit;text-decoration:none;}}
  nav{{display:flex;align-items:center;justify-content:space-between;padding:14px 32px;border-bottom:1px solid var(--line-soft);}}
  .logo{{font-family:var(--mono);font-weight:700;font-size:17px;display:flex;align-items:center;gap:10px;}}
  .logo .dot{{width:8px;height:8px;border-radius:50%;background:var(--gold);}}
  nav a{{font-family:var(--mono);font-size:13px;color:var(--muted);}}
  main{{max-width:760px;margin:0 auto;padding:56px 32px;}}
  .eyebrow{{font-family:var(--mono);font-size:12px;letter-spacing:.14em;color:var(--teal);text-transform:uppercase;margin-bottom:12px;}}
  h1{{font-family:var(--mono);font-size:clamp(22px,3.4vw,30px);line-height:1.3;margin:0 0 18px;}}
  .meta{{font-family:var(--mono);font-size:12.5px;color:var(--muted-2);margin-bottom:36px;}}
  h2{{font-family:var(--mono);font-size:16px;color:var(--gold-soft);margin:34px 0 12px;}}
  p{{color:var(--text);opacity:.92;line-height:1.75;font-size:14.5px;margin:0 0 14px;}}
  .stat-row{{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px;}}
  .stat-row .k{{color:var(--muted);}}
  .stat-row .v{{font-family:var(--mono);font-weight:600;}}
  .panel{{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:18px 20px;margin:16px 0;}}
  .bias-tag{{display:inline-block;font-family:var(--mono);font-size:12px;padding:4px 12px;border-radius:20px;border:1px solid var(--teal);color:var(--teal);}}
  .bias-tag.long{{border-color:var(--green);color:var(--green);}}
  .bias-tag.short{{border-color:var(--red);color:var(--red);}}
  ul{{margin:0 0 14px;padding-left:20px;}}
  li{{color:var(--text);opacity:.92;line-height:1.7;font-size:14.5px;margin-bottom:6px;}}
  li::marker{{color:var(--teal);}}
  footer{{border-top:1px solid var(--line-soft);padding:30px 32px;margin-top:40px;}}
  .disclaimer{{max-width:760px;margin:0 auto;color:var(--muted-2);font-size:11px;line-height:1.6;}}
</style>
</head>
<body>
<nav>
  <div class="logo"><span class="dot"></span>BKQ</div>
  <div style="display:flex;gap:18px;">
    <a href="../index.html">← Home</a>
    <a href="index.html">All briefings</a>
  </div>
</nav>
<main>
  <div class="eyebrow">Daily market brief</div>
  <h1>{headline}</h1>
  <div class="meta">{DATE_HUMAN} · 12:00 IST · Auto-generated</div>

  <h2>Macro</h2>
  {macro_html}

  <h2>Crypto</h2>
  {crypto_html}
  {pivot_row}

  <h2>Indian Indices</h2>
  {indices_html}

  <h2>US Equities</h2>
  {equities_html}

  <h2>Commodities</h2>
  {commodities_html}

  {"<h2>BTC Technical Snapshot</h2>" + technical_html if technical_html else ""}

  <h2>For your session</h2>
  <p><span class="bias-tag {bias_class}">{bias_tag} — {bias_reason}</span></p>
  {session_html}
</main>
<footer>
  <div class="disclaimer">This briefing is generated automatically from public market data (Binance, Yahoo Finance, Alternative.me, Frankfurter) and public news headlines. It is not financial advice and is not a recommendation to take any specific position.</div>
</footer>
</body>
</html>
"""

os.makedirs("blog", exist_ok=True)
post_filename = f"blog/{DATE_STR}-premarket.html"
with open(post_filename, "w") as f:
    f.write(POST_HTML)
print(f"Wrote {post_filename}")

# ---------------- Update blog/index.html (prepend a row) ----------------
BLOG_INDEX_PATH = "blog/index.html"
new_row = (
    f'    <a class="blog-row" href="{DATE_STR}-premarket.html">\n'
    f'      <span class="blog-date">{NOW_IST.strftime("%b %d, %Y")} · 12:00 IST</span>\n'
    f'      <span class="blog-title">{headline}</span>\n'
    f'      <span class="blog-tag">pre-market</span>\n'
    f'    </a>\n'
)
try:
    with open(BLOG_INDEX_PATH, "r") as f:
        blog_index = f.read()
    marker = '<div class="blog-list" id="blog-list">'
    if marker in blog_index and new_row.strip() not in blog_index:
        blog_index = blog_index.replace(marker, marker + "\n" + new_row, 1)
        with open(BLOG_INDEX_PATH, "w") as f:
            f.write(blog_index)
        print("Updated blog/index.html")
except FileNotFoundError:
    print("blog/index.html not found — skipping index update")

# ---------------- Update homepage preview card ----------------
HOMEPAGE_PATH = "index.html"
try:
    with open(HOMEPAGE_PATH, "r") as f:
        homepage = f.read()
    homepage = re.sub(
        r'(<a class="blog-row" href="blog/)[\d-]+-premarket\.html(">\s*<span class="blog-date">)[^<]*(</span>\s*<span class="blog-title">)[^<]*(</span>)',
        rf'\g<1>{DATE_STR}-premarket.html\g<2>{NOW_IST.strftime("%b %d, %Y")} · 12:00 IST\g<3>{headline}\g<4>',
        homepage,
        count=1,
    )
    with open(HOMEPAGE_PATH, "w") as f:
        f.write(homepage)
    print("Updated homepage preview card")
except FileNotFoundError:
    print("index.html not found — skipping homepage update")

print("Done.")
