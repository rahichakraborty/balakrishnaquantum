"""
BKQ Market Intelligence - Writer
Assembles the final market.json payload and writes it + a dated history copy.
"""

import json
import os
from datetime import datetime, timezone, timedelta

import config


def _ist_now():
    return datetime.now(timezone.utc) + timedelta(hours=config.IST_OFFSET_HOURS)


def build_payload(
    overall_score,
    overall_emoji,
    overall_bias,
    trade_action,
    preferred_symbol,
    risk_level,
    risk_note,
    asset_scores,   # {"BTC": {...card fields...}, "ETH": {...}}
    macro_score,
    flow_score,
    technical_score,
    risk_score,
    drivers,
    events,
    checklist,
):
    ist_now = _ist_now()
    return {
        "last_updated": {
            "date": ist_now.strftime("%d %b %Y"),
            "time": ist_now.strftime("%H:%M IST"),
            "iso": ist_now.isoformat(),
        },
        "overall": {
            "emoji": overall_emoji,
            "bias": overall_bias,
            "confidence": overall_score,
            "todays_trade": trade_action,
            "preferred_asset": preferred_symbol,
            "risk_level": risk_level,
            "risk_note": risk_note,
            "conviction": overall_score,
        },
        "assets": asset_scores,
        "scores": {
            "macro": macro_score,
            "flow": flow_score,
            "technical": technical_score,
            "risk": risk_score,
        },
        "drivers": drivers,
        "events": events,
        "checklist": checklist,
    }


def write(payload):
    os.makedirs(config.DATA_DIR, exist_ok=True)
    os.makedirs(config.HISTORY_DIR, exist_ok=True)

    with open(config.OUTPUT_FILE, "w") as f:
        json.dump(payload, f, indent=2)

    date_str = _ist_now().strftime("%Y-%m-%d")
    history_path = os.path.join(config.HISTORY_DIR, f"{date_str}.json")
    with open(history_path, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"[writer] wrote {config.OUTPUT_FILE}")
    print(f"[writer] archived {history_path}")
