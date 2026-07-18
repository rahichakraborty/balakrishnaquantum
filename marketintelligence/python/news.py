"""
BKQ Market Intelligence - News
Pulls recent headlines from free RSS feeds and scores sentiment with a
simple keyword match (no paid NLP API). This is intentionally transparent
and auditable rather than a black-box model.
"""

import feedparser
import config


def fetch_headlines(max_per_feed=10):
    headlines = []
    for feed_url in config.NEWS_FEEDS:
        try:
            parsed = feedparser.parse(feed_url)
            for entry in parsed.entries[:max_per_feed]:
                headlines.append(entry.get("title", "").strip())
        except Exception as e:
            print(f"[news] WARN failed to parse {feed_url}: {e}")
    return [h for h in headlines if h]


def score_headline(headline):
    """Returns +1 (bullish), -1 (bearish), or 0 (neutral) for one headline."""
    text = headline.lower()
    bullish_hit = any(kw in text for kw in config.BULLISH_KEYWORDS)
    bearish_hit = any(kw in text for kw in config.BEARISH_KEYWORDS)
    if bullish_hit and not bearish_hit:
        return 1
    if bearish_hit and not bullish_hit:
        return -1
    return 0


def get_sentiment_score(headlines=None):
    """
    Returns a 0-100 sentiment score plus the top drivers (headlines) used,
    tagged bullish/bearish/neutral for the "Today's Market Drivers" section.
    """
    if headlines is None:
        headlines = fetch_headlines()

    if not headlines:
        return {"score": 50, "drivers": []}

    scores = [score_headline(h) for h in headlines]
    bullish_count = scores.count(1)
    bearish_count = scores.count(-1)
    net = bullish_count - bearish_count
    total = max(len(scores), 1)

    # Map net ratio (-1..1) onto a 0-100 scale, centered at 50.
    ratio = net / total
    sentiment_score = round(50 + ratio * 50, 1)
    sentiment_score = max(0, min(100, sentiment_score))

    drivers = []
    for headline, s in zip(headlines, scores):
        emoji = "✅" if s == 1 else ("🔴" if s == -1 else "🟡")
        drivers.append({"emoji": emoji, "text": headline})

    return {"score": sentiment_score, "drivers": drivers[:8]}
