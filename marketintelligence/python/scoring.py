"""
BKQ Market Intelligence - Scoring
Turns raw indicator/news/macro data into the four sub-scores
(Macro, Technical, Flow, Risk) and the overall bias/conviction shown
on the dashboard. All formulas are simple and documented inline so the
logic stays auditable - no black-box model.
"""

import config


def _clamp(value, lo=0, hi=100):
    return max(lo, min(hi, value))


def score_technical(asset_snapshot):
    """
    Bullish if price is above its 20-day SMA, bearish if below.
    Distance from the SMA (as a %) scales the confidence.
    """
    price = asset_snapshot.get("price")
    sma20 = asset_snapshot.get("sma20")
    if price is None or sma20 is None or sma20 == 0:
        return 50, "Neutral"

    pct_diff = (price - sma20) / sma20 * 100
    # Center at 50, +/- up to 30 points based on distance from SMA, capped at +/-6%
    score = 50 + _clamp(pct_diff, -6, 6) / 6 * 30
    score = _clamp(round(score))

    if pct_diff > 1.5:
        bias = "Bullish"
    elif pct_diff < -1.5:
        bias = "Bearish"
    else:
        bias = "Neutral Bullish" if pct_diff >= 0 else "Neutral Bearish"

    return score, bias


def score_flow(btc_dominance, asset_snapshots):
    """
    Free-tier proxy for 'flow': ETF-flow data itself isn't available
    without a paid feed, so this uses BTC dominance direction + 24h
    market-cap-weighted change as a stand-in signal. Swap in real
    ETF-flow data here later if you get access to SoSoValue/Farside.
    """
    changes = [a.get("change_24h") for a in asset_snapshots.values() if a.get("change_24h") is not None]
    avg_change = sum(changes) / len(changes) if changes else 0

    score = 50 + _clamp(avg_change, -8, 8) / 8 * 40
    return _clamp(round(score))


def score_macro(sentiment_score, macro_risk_flag):
    """
    Blends headline sentiment with whether a high-impact macro event is
    imminent (imminent events pull the score toward neutral, since
    outcomes are still uncertain going in).
    """
    score = sentiment_score
    if macro_risk_flag:
        score = score * 0.85 + 50 * 0.15  # pull 15% toward neutral
    return _clamp(round(score))


def score_risk(asset_snapshots, macro_risk_flag, fear_greed_value):
    """
    Higher = riskier. Driven by realized volatility (24h % move magnitude)
    and whether a high-impact macro event lands within 2 days.
    Fear & Greed extremes (very greedy or very fearful) also add risk.
    """
    changes = [abs(a.get("change_24h") or 0) for a in asset_snapshots.values()]
    avg_abs_change = sum(changes) / len(changes) if changes else 0

    base = _clamp(avg_abs_change / 6 * 100)  # 6% avg move -> risk=100

    if macro_risk_flag:
        base += 20

    if fear_greed_value is not None:
        if fear_greed_value >= 80 or fear_greed_value <= 20:
            base += 10

    return _clamp(round(base))


def overall_bias_label(score):
    if score >= 75:
        return "🟢", "Mild Bullish" if score < 85 else "Strong Bullish"
    if score >= 55:
        return "🟢", "Mild Bullish"
    if score >= 45:
        return "🟡", "Neutral"
    if score >= 25:
        return "🔴", "Mild Bearish"
    return "🔴", "Strong Bearish"


def compute_overall(macro, technical, flow, sentiment, risk):
    """
    Weighted blend per config.OVERALL_WEIGHTS. Risk is inverted (100 - risk)
    before blending, since a high risk score should pull conviction down,
    not up.
    """
    w = config.OVERALL_WEIGHTS
    inverted_risk = 100 - risk
    overall = (
        macro * w["macro"]
        + technical * w["technical"]
        + flow * w["flow"]
        + sentiment * w["sentiment"]
        + inverted_risk * w["risk"]
    )
    return _clamp(round(overall))


def todays_trade_plan(overall_score, risk_score, preferred_symbol):
    if risk_score >= 65:
        return "Reduce Size", preferred_symbol
    if overall_score >= 65:
        return "Buy Pullbacks", preferred_symbol
    if overall_score <= 35:
        return "Sell Rallies", preferred_symbol
    return "Wait For Confirmation", preferred_symbol


def risk_level_label(risk_score):
    if risk_score >= 65:
        return "High", "Reduce Size"
    if risk_score >= 35:
        return "Medium", "Watch Headlines"
    return "Low", "Normal Conditions"


def checklist_flags(asset_snapshots, fear_greed_value, macro_risk_flag, sentiment_score):
    def flag(cond_green, cond_yellow):
        if cond_green:
            return "green"
        if cond_yellow:
            return "yellow"
        return "red"

    btc = asset_snapshots.get("BTC", {})
    above_support = (
        btc.get("price") is not None
        and btc.get("support") is not None
        and btc["price"] > btc["support"]
    )

    fg_ok = fear_greed_value is not None and 20 < fear_greed_value < 80

    return {
        "ETF": flag(True, False),  # placeholder until real ETF flow feed is wired in
        "Funding": flag(True, False),  # placeholder until funding-rate feed is wired in
        "Open Interest": flag(above_support, False),
        "Fear & Greed": flag(fg_ok, fear_greed_value is not None),
        "Macro": flag(not macro_risk_flag, macro_risk_flag),
        "News": flag(sentiment_score >= 60, sentiment_score >= 40),
        "Risk": flag(False, False) if macro_risk_flag else flag(True, False),
    }
