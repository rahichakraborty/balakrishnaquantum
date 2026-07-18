"""
BKQ Market Intelligence - Engine
Entry point. Run with:  python3 engine.py

Pipeline:
  indicators.py -> news.py -> macro.py -> scoring.py -> writer.py -> market.json
"""

import traceback

import config
import indicators
import news
import macro
import scoring
import writer


def run():
    print("=== BKQ Market Intelligence engine starting ===")

    # 1. Raw data ------------------------------------------------------
    price_data = indicators.get_prices()
    btc_dominance = indicators.get_btc_dominance()
    fear_greed = indicators.get_fear_greed()

    asset_snapshots = {
        symbol: indicators.build_asset_snapshot(symbol, price_data)
        for symbol in config.ASSETS
    }

    headlines = news.fetch_headlines()
    sentiment = news.get_sentiment_score(headlines)

    upcoming_events = macro.get_upcoming_events()
    macro_risk_flag = macro.get_macro_risk_flag()

    # 2. Scores ----------------------------------------------------------
    technical_scores = {}
    asset_cards = {}
    for symbol, snap in asset_snapshots.items():
        tech_score, bias_label = scoring.score_technical(snap)
        technical_scores[symbol] = tech_score
        asset_cards[symbol] = {
            "name": snap["name"],
            "bias": bias_label,
            "confidence": tech_score,
            "support": snap.get("support"),
            "resistance": snap.get("resistance"),
            "trade_plan": (
                "Buy pullbacks while above support."
                if "Bullish" in bias_label
                else "Wait for confirmed breakout."
                if "Neutral" in bias_label
                else "Fade rallies while below resistance."
            ),
        }

    technical_score = round(sum(technical_scores.values()) / len(technical_scores))
    flow_score = scoring.score_flow(btc_dominance, asset_snapshots)
    macro_score = scoring.score_macro(sentiment["score"], macro_risk_flag)
    risk_score = scoring.score_risk(asset_snapshots, macro_risk_flag, fear_greed["value"])

    overall_score = scoring.compute_overall(
        macro_score, technical_score, flow_score, sentiment["score"], risk_score
    )
    overall_emoji, overall_bias = scoring.overall_bias_label(overall_score)

    preferred_symbol = max(technical_scores, key=technical_scores.get)
    trade_action, _ = scoring.todays_trade_plan(overall_score, risk_score, preferred_symbol)
    risk_level, risk_note = scoring.risk_level_label(risk_score)

    checklist = scoring.checklist_flags(
        asset_snapshots, fear_greed["value"], macro_risk_flag, sentiment["score"]
    )

    # 3. Assemble + write --------------------------------------------------
    payload = writer.build_payload(
        overall_score=overall_score,
        overall_emoji=overall_emoji,
        overall_bias=overall_bias,
        trade_action=trade_action,
        preferred_symbol=preferred_symbol,
        risk_level=risk_level,
        risk_note=risk_note,
        asset_scores=asset_cards,
        macro_score=macro_score,
        flow_score=flow_score,
        technical_score=technical_score,
        risk_score=risk_score,
        drivers=sentiment["drivers"],
        events=upcoming_events,
        checklist=checklist,
    )

    writer.write(payload)
    print("=== BKQ Market Intelligence engine finished OK ===")


if __name__ == "__main__":
    try:
        run()
    except Exception:
        print("[engine] FATAL error - dashboard will keep showing last good data")
        traceback.print_exc()
        raise
