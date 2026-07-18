"""
BKQ Market Intelligence - Macro Calendar
There is no reliable free API for a forward economic/crypto-legislation
calendar, so this module reads a small hand-maintained JSON file
(data/events.json) and computes "days remaining" dynamically each run.

Update data/events.json whenever a date changes (e.g. after a Fed
announcement, or once the CLARITY Act timeline moves) - it's a 30 second
edit, not a code change.
"""

import json
from datetime import datetime, date
import config


def _load_events():
    try:
        with open(config.EVENTS_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"[macro] WARN could not read {config.EVENTS_FILE}: {e}")
        return []


def _days_until(target_date_str):
    try:
        target = datetime.strptime(target_date_str, "%Y-%m-%d").date()
        delta = (target - date.today()).days
        return delta
    except Exception:
        return None


def get_upcoming_events():
    """
    Returns a list of {"label": ..., "when": ..., "raw_days": int|None}
    ready to render directly in the "Upcoming Events" card.
    Events with an explicit "status" (e.g. "Awaiting Senate") skip the
    date math and show the status text as-is.
    """
    events = _load_events()
    output = []

    for ev in events:
        label = ev.get("label", "Unknown")
        note = ev.get("note", "")

        if ev.get("status"):
            output.append({"label": label, "when": ev["status"], "raw_days": None, "note": note})
            continue

        days = _days_until(ev.get("date", ""))
        if days is None:
            when = "TBD"
        elif days < 0:
            continue  # event has passed, drop it
        elif days == 0:
            when = "Today"
        elif days == 1:
            when = "Tomorrow"
        else:
            when = f"{days} Days"

        output.append({"label": label, "when": when, "raw_days": days, "note": note})

    return output


def get_macro_risk_flag():
    """
    Returns True if any high-impact event lands within 2 days -
    used by scoring.py to push the Risk score up ("Watch Headlines").
    """
    for ev in get_upcoming_events():
        if ev["raw_days"] is not None and ev["raw_days"] <= 2:
            return True
    return False
