"""Phase-1 signal: detect recent well activity from RRC tables.

Imagery is NOT required. The daily permit scrape populates
filed_date / approved_date reliably; completion_date / spud_date
are sparse until detail enrichment catches up. So Phase 1 emits
events from whatever date signal we actually have:

  1. completion_date in window  → RRC_COMPLETION  (strongest)
  2. spud_date in window        → RIG_MOVE_IN     (drilling started)
  3. approved_date in window    → RRC_APPROVED    (permit just issued)
  4. wells.completion_date      → RRC_COMPLETION

Priority is completion > spud > approved per API so we don't triple-
notify the same pad.
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


def _in_window(d: dt.date | None, cutoff: dt.date) -> bool:
    return d is not None and d >= cutoff


def _load_permits(client: Client, county: str) -> list[dict[str, Any]]:
    table = f"{county}_permits"
    full = (
        "id,permit_number,api_number,operator_name,lease_name,"
        "latitude,longitude,abstract_number,spud_date,completion_date,"
        "approved_date,filed_date,permit_type,status"
    )
    minimal = (
        "id,permit_number,api_number,operator_name,lease_name,"
        "latitude,longitude,abstract_number,approved_date,filed_date,"
        "permit_type,status"
    )
    try:
        return paginate_table(client, table, full)
    except Exception as exc:
        message = str(exc).lower()
        if "column" in message:
            return paginate_table(client, table, minimal)
        raise


def _load_wells(client: Client, county: str) -> list[dict[str, Any]]:
    table = f"{county}_wells"
    full = (
        "api_number,operator_name,lease_name,rrc_lease_id,"
        "latitude,longitude,abstract,completion_date,well_status"
    )
    minimal = (
        "api_number,operator_name,lease_name,rrc_lease_id,"
        "latitude,longitude,abstract,well_status"
    )
    try:
        return paginate_table(client, table, full)
    except Exception as exc:
        message = str(exc).lower()
        if "column" in message:
            return paginate_table(client, table, minimal)
        raise


def _coords(row: dict[str, Any]) -> dict[str, float | None]:
    """Normalize lat/lon onto event.raw so the UI can fetch Sentinel chips."""
    lat = row.get("latitude")
    lon = row.get("longitude")
    try:
        lat_f = float(lat) if lat is not None else None
    except (TypeError, ValueError):
        lat_f = None
    try:
        lon_f = float(lon) if lon is not None else None
    except (TypeError, ValueError):
        lon_f = None
    if lat_f is not None and not (-90.0 <= lat_f <= 90.0):
        lat_f = None
    if lon_f is not None and not (-180.0 <= lon_f <= 180.0):
        lon_f = None
    return {"latitude": lat_f, "longitude": lon_f}


def _event(
    *,
    county: str,
    week_start: dt.date,
    signature: str,
    confidence: float,
    summary: str,
    api: str | None,
    abstract: str | None,
    lease: str | None,
    operator: str | None,
    rrc_lease_id: str | None = None,
    raw: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "county_id": county,
        "rrc_lease_id": rrc_lease_id,
        "api_number": api,
        "abstract_number": abstract,
        "owner_name": None,
        "lease_name": lease,
        "operator_name": operator,
        "signature": signature,
        "confidence": confidence,
        "change_score": None,
        "summary": summary,
        "before_path": None,
        "after_path": None,
        "week_start": week_start.isoformat(),
        "source": "rrc_transition",
        "raw": raw or {},
    }


def detect_rrc_completions(
    client: Client,
    county: str,
    *,
    lookback_days: int = RRC_COMPLETION_LOOKBACK_DAYS,
    today: dt.date | None = None,
) -> list[dict[str, Any]]:
    today = today or dt.date.today()
    cutoff = today - dt.timedelta(days=lookback_days)
    week_start = today - dt.timedelta(days=today.weekday())  # Monday

    permits = _load_permits(client, county)
    wells = _load_wells(client, county)
    print(
        f"  rrc rows loaded: permits={len(permits):,} wells={len(wells):,} "
        f"cutoff={cutoff.isoformat()} lookback={lookback_days}d",
        flush=True,
    )

    events: list[dict[str, Any]] = []
    claimed_apis: set[str] = set()

    # Pass 1 — completions (strongest)
    for row in permits:
        completion = _parse_date(row.get("completion_date"))
        if not _in_window(completion, cutoff):
            continue
        api = str(row.get("api_number") or "").strip() or None
        if api:
            claimed_apis.add(api)
        lease = str(row.get("lease_name") or "").strip() or None
        events.append(
            _event(
                county=county,
                week_start=week_start,
                signature="RRC_COMPLETION",
                confidence=0.85,
                summary=(
                    f"Well activity update: RRC filing shows a completion date of "
                    f"{completion.isoformat()} on {lease or 'this lease'}"
                    f"{f' (API {api})' if api else ''}. "
                    f"Production and payout likely imminent — recommended follow-up."
                ),
                api=api,
                abstract=str(row.get("abstract_number") or "").strip() or None,
                lease=lease,
                operator=str(row.get("operator_name") or "").strip() or None,
                raw={
                    "permit_number": row.get("permit_number"),
                    "completion_date": completion.isoformat() if completion else None,
                    "spud_date": row.get("spud_date"),
                    "approved_date": row.get("approved_date"),
                    **_coords(row),
                },
            )
        )

    for row in wells:
        completion = _parse_date(row.get("completion_date"))
        if not _in_window(completion, cutoff):
            continue
        api = str(row.get("api_number") or "").strip() or None
        if api and api in claimed_apis:
            continue
        if api:
            claimed_apis.add(api)
        lease = str(row.get("lease_name") or "").strip() or None
        events.append(
            _event(
                county=county,
                week_start=week_start,
                signature="RRC_COMPLETION",
                confidence=0.8,
                summary=(
                    f"Well activity update: well file shows completion on "
                    f"{completion.isoformat()} for {lease or 'this lease'}"
                    f"{f' (API {api})' if api else ''}. "
                    f"Production and payout likely imminent — recommended follow-up."
                ),
                api=api,
                abstract=str(row.get("abstract") or "").strip() or None,
                lease=lease,
                operator=str(row.get("operator_name") or "").strip() or None,
                rrc_lease_id=str(row.get("rrc_lease_id") or "").strip() or None,
                raw={
                    "completion_date": completion.isoformat() if completion else None,
                    "well_status": row.get("well_status"),
                    **_coords(row),
                },
            )
        )

    # Pass 2 — recent spuds (rig on location / DUC forming)
    for row in permits:
        spud = _parse_date(row.get("spud_date"))
        completion = _parse_date(row.get("completion_date"))
        if not _in_window(spud, cutoff):
            continue
        if completion is not None:
            continue  # already completed — covered above
        api = str(row.get("api_number") or "").strip() or None
        if api and api in claimed_apis:
            continue
        if api:
            claimed_apis.add(api)
        lease = str(row.get("lease_name") or "").strip() or None
        events.append(
            _event(
                county=county,
                week_start=week_start,
                signature="RIG_MOVE_IN",
                confidence=0.7,
                summary=(
                    f"Well activity update: spud date {spud.isoformat()} on "
                    f"{lease or 'this lease'}"
                    f"{f' (API {api})' if api else ''}. "
                    f"Drilling underway — watch for completion crew next."
                ),
                api=api,
                abstract=str(row.get("abstract_number") or "").strip() or None,
                lease=lease,
                operator=str(row.get("operator_name") or "").strip() or None,
                raw={
                    "permit_number": row.get("permit_number"),
                    "spud_date": spud.isoformat() if spud else None,
                    "approved_date": row.get("approved_date"),
                    **_coords(row),
                },
            )
        )

    # Pass 3 — recently approved drilling permits (what the scrape
    # actually delivers every night). This is the volume signal that
    # populates the Pad Activity page today.
    for row in permits:
        approved = _parse_date(row.get("approved_date"))
        filed = _parse_date(row.get("filed_date"))
        # Prefer approved; fall back to filed if approved missing.
        signal_date = approved if _in_window(approved, cutoff) else (
            filed if _in_window(filed, cutoff) else None
        )
        if signal_date is None:
            continue
        api = str(row.get("api_number") or "").strip() or None
        if api and api in claimed_apis:
            continue
        # Deduplicate by permit_number when API missing.
        permit_number = str(row.get("permit_number") or "").strip()
        dedupe_key = api or (f"permit:{permit_number}" if permit_number else None)
        if dedupe_key and dedupe_key in claimed_apis:
            continue
        if dedupe_key:
            claimed_apis.add(dedupe_key)

        lease = str(row.get("lease_name") or "").strip() or None
        kind = "approved" if approved and signal_date == approved else "filed"
        events.append(
            _event(
                county=county,
                week_start=week_start,
                signature="RRC_APPROVED",
                confidence=0.65 if kind == "approved" else 0.55,
                summary=(
                    f"Well activity update: drilling permit {kind} "
                    f"{signal_date.isoformat()} on {lease or 'this lease'}"
                    f"{f' (#{permit_number})' if permit_number else ''}. "
                    f"Operator commitment on this tract — prioritize outreach."
                ),
                api=api,
                abstract=str(row.get("abstract_number") or "").strip() or None,
                lease=lease,
                operator=str(row.get("operator_name") or "").strip() or None,
                raw={
                    "permit_number": permit_number or None,
                    "approved_date": approved.isoformat() if approved else None,
                    "filed_date": filed.isoformat() if filed else None,
                    "permit_type": row.get("permit_type"),
                    "status": row.get("status"),
                    **_coords(row),
                },
            )
        )

    return events
