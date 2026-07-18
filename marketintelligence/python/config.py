"""
BKQ Market Intelligence - Configuration
All API endpoints are free / no-key-required.
"""

import os

# ---------------------------------------------------------------------------
# Assets tracked
# ---------------------------------------------------------------------------
ASSETS = {
    "BTC": {"coingecko_id": "bitcoin", "name": "Bitcoin"},
    "ETH": {"coingecko_id": "ethereum", "name": "Ethereum"},
}

# ---------------------------------------------------------------------------
# Free API endpoints
# ---------------------------------------------------------------------------
COINGECKO_SIMPLE_PRICE = "https://api.coingecko.com/api/v3/simple/price"
COINGECKO_GLOBAL = "https://api.coingecko.com/api/v3/global"
COINGECKO_MARKET_CHART = "https://api.coingecko.com/api/v3/coins/{id}/market_chart"

FEAR_GREED_API = "https://api.alternative.me/fng/?limit=1&format=json"

NEWS_FEEDS = [
    "https://cointelegraph.com/rss",
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
]

# ---------------------------------------------------------------------------
# Scoring weights (must sum to 1.0)
# ---------------------------------------------------------------------------
OVERALL_WEIGHTS = {
    "macro": 0.25,
    "technical": 0.25,
    "flow": 0.20,
    "sentiment": 0.15,
    "risk": 0.15,  # NOTE: risk score is inverted before blending (100 - risk)
}

# Keyword lists used for very-lightweight headline sentiment scoring.
# This is intentionally simple/rule-based (no paid NLP APIs).
BULLISH_KEYWORDS = [
    "rally", "surge", "record high", "all-time high", "inflow", "approval",
    "bullish", "breakout", "adoption", "upgrade", "etf inflow", "buy the dip",
    "accumulate", "green light", "pass", "passes", "advances",
]
BEARISH_KEYWORDS = [
    "crash", "plunge", "sell-off", "selloff", "outflow", "rejection",
    "bearish", "breakdown", "hack", "exploit", "lawsuit", "ban", "halt",
    "liquidation", "delay", "fails", "rejects", "investigation",
]

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
HISTORY_DIR = os.path.join(DATA_DIR, "history")
EVENTS_FILE = os.path.join(DATA_DIR, "events.json")
OUTPUT_FILE = os.path.join(DATA_DIR, "market.json")

REQUEST_TIMEOUT = 12  # seconds
IST_OFFSET_HOURS = 5.5
