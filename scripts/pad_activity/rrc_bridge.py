"""Phase-1 signal: detect recent completion activity from RRC tables.

Until Sentinel-2 weekly chips are calibrated, we still want a real
"call this owner now" event in pad_activity_events. Public permits /
wells with a fresh completion_date are the ground-truth proxy the
satellite classifier will later train against.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from supabase import Client

from .config import RRC_COMPLETION_LOOKBACK_DAYS
from .db import paginate_table


def _parse_date(raw: Any) -> dt.date | None:
    if raw is None:
        return None
    text = str(raw).strip()[:10]
    if not text or text in {"0", "None", "null"}:
        return None
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def detect_rrc_completions(
    client: Client,
    county: str,
    *,
    lookback_days: int = RRC_COMPLETION_LOOKBACK_DAYS,
    today: dt.date | None = None,
) -> list[dict[str, Any]]:
    """Return candidate completion events for one county.

    Sources (unioned, de-duped by api_number when present):
      1. {county}_permits with completion_date in the lookback window
      2. {county}_wells with completion_date in the lookback window
    """
    today = today or dt.date.today()
    cutoff = today - dt.timedelta(days=lookback_days)
    week_start = today - dt.timedelta(days=today.weekday())  # Monday

    permits_table = f"{county}_permits"
    wells_table = f"{county}_wells"

    permit_cols = (
        "id,permit_number,api_number,operator_name,lease_name,"
        "latitude,longitude,abstract_number,spud_date,completion_date,approved_date"
    )
    well_cols = (
        "api_number,operator_name,lease_name,rrc_lease_id,"
        "latitude,longitude,abstract,completion_date,well_status"
    )

    permits = paginate_table(client, permits_table, permit_cols)
    wells = paginate_table(client, wells_table, well_cols)

    events: list[dict[str, Any]] = []
    seen_apis: set[str] = set()

    for row in permits:
        completion = _parse_date(row.get("completion_date"))
        if completion is None or completion < cutoff:
            continue
        api = str(row.get("api_number") or "").strip()
        if api:
            seen_apis.add(api)
        abstract = str(row.get("abstract_number") or "").strip() or None
        lease = str(row.get("lease_name") or "").strip() or None
        operator = str(row.get("operator_name") or "").strip() or None
        events.append(
            {
                "county_id": county,
                "rrc_lease_id": None,
                "api_number": api or None,
                "abstract_number": abstract,
                "owner_name": None,  # filled in propagate via ownership join
                "lease_name": lease,
                "operator_name": operator,
                "signature": "RRC_COMPLETION",
                "confidence": 0.85,
                "change_score": None,
                "summary": (
                    f"Well activity update: RRC filing shows a completion date of "
                    f"{completion.isoformat()} on {lease or 'this lease'}"
                    f"{f' (API {api})' if api else ''}. "
                    f"Production and payout likely imminent — recommended follow-up."
                ),
                "before_path": None,
                "after_path": None,
                "week_start": week_start.isoformat(),
                "source": "rrc_transition",
                "raw": {
                    "permit_number": row.get("permit_number"),
                    "completion_date": completion.isoformat(),
                    "spud_date": row.get("spud_date"),
                    "approved_date": row.get("approved_date"),
                },
            }
        )

    for row in wells:
        completion = _parse_date(row.get("completion_date"))
        if completion is None or completion < cutoff:
            continue
        api = str(row.get("api_number") or "").strip()
        if api and api in seen_apis:
            continue
        if api:
            seen_apis.add(api)
        abstract = str(row.get("abstract") or "").strip() or None
        lease = str(row.get("lease_name") or "").strip() or None
        operator = str(row.get("operator_name") or "").strip() or None
        rrc = str(row.get("rrc_lease_id") or "").strip() or None
        events.append(
            {
                "county_id": county,
                "rrc_lease_id": rrc,
                "api_number": api or None,
                "abstract_number": abstract,
                "owner_name": None,
                "lease_name": lease,
                "operator_name": operator,
                "signature": "RRC_COMPLETION",
                "confidence": 0.8,
                "change_score": None,
                "summary": (
                    f"Well activity update: well file shows completion on "
                    f"{completion.isoformat()} for {lease or 'this lease'}"
                    f"{f' (API {api})' if api else ''}. "
                    f"Production and payout likely imminent — recommended follow-up."
                ),
                "before_path": None,
                "after_path": None,
                "week_start": week_start.isoformat(),
                "source": "rrc_transition",
                "raw": {
                    "completion_date": completion.isoformat(),
                    "well_status": row.get("well_status"),
                },
            }
        )

    return events
