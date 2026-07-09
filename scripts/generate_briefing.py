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


# ---------------- Gather everything ----------------
btc = fetch_binance_ticker("BTCUSDT")
eth = fetch_binance_ticker("ETHUSDT")
sol = fetch_binance_ticker("SOLUSDT")
paxg = fetch_binance_ticker("PAXGUSDT")
pivots = fetch_btc_pivots()
fng = fetch_fear_greed()
dxy = fetch_dxy()
crypto_headlines = fetch_headlines("https://cointelegraph.com/rss")
global_headlines = fetch_headlines("https://www.investing.com/rss/news.rss")

data_summary = {
    "date": DATE_HUMAN,
    "btc": btc, "eth": eth, "sol": sol, "paxg": paxg,
    "pivots": pivots, "fear_greed": fng, "dxy": dxy,
    "crypto_headlines": crypto_headlines, "global_headlines": global_headlines,
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
    prompt = f"""You are writing the daily pre-market briefing for BalakrishnaQuantum (BKQ), a solo
trader's site. House style: concise, institutional-desk tone, no fluff, no generic disclaimers
in the body text. Write 4 short sections as HTML <p> tags (no markdown, no <html> wrapper):
1. Macro — 2-3 sentences synthesizing the global headlines below into what actually matters for
   today's session.
2. Crypto — 2-3 sentences on BTC/ETH/SOL price action and what the fear/greed + DXY context implies.
3. Metals — 1-2 sentences on PAXG/gold given the DXY level.
4. Session bias — 1-2 sentences explaining today's bias tag: {bias_tag} ({bias_reason}).

Data:
{json.dumps(data_summary, indent=2, default=str)}

Return ONLY a JSON object with keys: "headline" (one punchy sentence, no quotes inside),
"macro_html", "crypto_html", "metals_html", "bias_html" — each a string of one or more <p> tags.
No other text, no markdown fences."""

    body = json.dumps({
        "model": MODEL,
        "max_tokens": 900,
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
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read().decode())
        text = "".join(b["text"] for b in resp["content"] if b["type"] == "text")
        text = re.sub(r"^```json|```$", "", text.strip()).strip()
        return json.loads(text)
    except Exception as e:
        print(f"Claude call failed, falling back to template: {e}")
        return None


ai = call_claude()

if ai:
    headline = ai.get("headline", "Pre-market briefing")
    macro_html = ai.get("macro_html", "")
    crypto_html = ai.get("crypto_html", "")
    metals_html = ai.get("metals_html", "")
    bias_html = ai.get("bias_html", "")
else:
    btc_txt = f"${btc['price']:,.0f} ({btc['change']:+.2f}% 24h)" if btc else "unavailable"
    headline = f"Pre-market data update — BTC {btc_txt}"
    macro_html = f"<p>DXY reference: {dxy if dxy else 'n/a'}. Check macro headlines directly — automated summary unavailable this run.</p>"
    crypto_html = (
        f"<p>BTC {btc_txt}. "
        + (f"ETH ${eth['price']:,.0f} ({eth['change']:+.2f}%). " if eth else "")
        + (f"SOL ${sol['price']:,.2f} ({sol['change']:+.2f}%). " if sol else "")
        + (f"Fear &amp; Greed: {fng['value']} ({fng['label']}).</p>" if fng else "</p>")
    )
    metals_html = f"<p>PAXG {'$' + format(paxg['price'], ',.0f') if paxg else 'n/a'}. DXY at {dxy if dxy else 'n/a'}.</p>"
    bias_html = f"<p>Bias: {bias_tag} — {bias_reason}.</p>"

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
<title>Pre-Market Briefing — {DATE_HUMAN} | Balakrishna Quantum</title>
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
  <div class="eyebrow">Pre-market briefing</div>
  <h1>{headline}</h1>
  <div class="meta">{DATE_HUMAN} · 12:00 IST · Auto-generated</div>

  <h2>Macro</h2>
  {macro_html}

  <h2>Crypto</h2>
  {crypto_html}
  {pivot_row}

  <h2>Metals</h2>
  {metals_html}

  <h2>Session bias</h2>
  <p><span class="bias-tag {bias_class}">{bias_tag} — {bias_reason}</span></p>
  {bias_html}
</main>
<footer>
  <div class="disclaimer">This briefing is generated automatically from public market data (Binance, Alternative.me, Frankfurter) and public news headlines. It is not financial advice and is not a recommendation to take any specific position.</div>
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
