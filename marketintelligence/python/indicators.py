"""
BKQ Market Intelligence - Indicators
Pulls live price/technical data from free APIs (CoinGecko, alternative.me).
Every function fails soft: on error it returns a `None`-safe fallback so one
broken API never kills the whole daily update.
"""

import requests
import config


def _get(url, params=None):
    try:
        r = requests.get(url, params=params, timeout=config.REQUEST_TIMEOUT)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"[indicators] WARN request failed for {url}: {e}")
        return None


def get_prices():
    """Returns {'BTC': {...}, 'ETH': {...}} with price, 24h change, market cap."""
    ids = ",".join(a["coingecko_id"] for a in config.ASSETS.values())
    data = _get(
        config.COINGECKO_SIMPLE_PRICE,
        params={
            "ids": ids,
            "vs_currencies": "usd",
            "include_24hr_change": "true",
            "include_market_cap": "true",
        },
    )
    result = {}
    for symbol, meta in config.ASSETS.items():
        cg_id = meta["coingecko_id"]
        entry = (data or {}).get(cg_id, {})
        result[symbol] = {
            "price": entry.get("usd"),
            "change_24h": entry.get("usd_24h_change"),
            "market_cap": entry.get("usd_market_cap"),
        }
    return result


def get_btc_dominance():
    data = _get(config.COINGECKO_GLOBAL)
    try:
        return round(data["data"]["market_cap_percentage"]["btc"], 2)
    except Exception:
        return None


def get_fear_greed():
    data = _get(config.FEAR_GREED_API)
    try:
        entry = data["data"][0]
        return {
            "value": int(entry["value"]),
            "label": entry["value_classification"],
        }
    except Exception:
        return {"value": None, "label": "Unknown"}


def get_support_resistance(coingecko_id, days=7):
    """
    Simple, transparent S/R: recent rolling low/high over `days` days
    from CoinGecko's market_chart endpoint (free, no key).
    """
    url = config.COINGECKO_MARKET_CHART.format(id=coingecko_id)
    data = _get(url, params={"vs_currency": "usd", "days": days})
    try:
        prices = [p[1] for p in data["prices"]]
        support = round(min(prices), 2)
        resistance = round(max(prices), 2)
        return support, resistance
    except Exception:
        return None, None


def get_sma(coingecko_id, days=20):
    """Simple moving average over `days` days, used for bias direction."""
    url = config.COINGECKO_MARKET_CHART.format(id=coingecko_id)
    data = _get(url, params={"vs_currency": "usd", "days": days})
    try:
        prices = [p[1] for p in data["prices"]]
        return round(sum(prices) / len(prices), 2)
    except Exception:
        return None


def build_asset_snapshot(symbol, price_data):
    """Combines price + SMA + S/R into one snapshot per asset.

    `price_data` is the dict returned by get_prices() (fetched once for all
    assets by the caller, to avoid redundant API calls).
    """
    meta = config.ASSETS[symbol]
    cg_id = meta["coingecko_id"]

    prices = price_data.get(symbol, {})
    support, resistance = get_support_resistance(cg_id)
    sma20 = get_sma(cg_id, days=20)

    return {
        "name": meta["name"],
        "price": prices.get("price"),
        "change_24h": prices.get("change_24h"),
        "support": support,
        "resistance": resistance,
        "sma20": sma20,
    }
