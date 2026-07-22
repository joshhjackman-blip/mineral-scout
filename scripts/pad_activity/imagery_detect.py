"""Phase 2b — before/after Sentinel chips → change → classify → events.

For each pad target:
  1. Pull an "after" chip (recent STAC window)
  2. Pull a "before" chip (prior window), or reuse an older pad_imagery_log row
  3. compare_chips → pad_change_log
  4. On MAJOR_CHANGE → classify_signature → pad_activity_events
     (with before_path / after_path for the Pad Activity UI)
"""

from __future__ import annotations

import datetime as dt
import time
from typing import Any, Iterable

from .change import compare_chips
from .classify import classify_signature, summary_for_signature
from .propagate import (
    attach_owners,
    bump_propensity_and_tag_deals,
    upsert_events,
)
from .sentinel import (
    ChipResult,
    PadTarget,
    download_chip_rgb,
    pad_id,
    pull_chip_for_target,
)


def _week_start(day: dt.date) -> dt.date:
    return day - dt.timedelta(days=day.weekday())  # Monday


def _find_prior_logged_chip(
    client: Any,
    target: PadTarget,
    *,
    before: dt.date,
) -> ChipResult | None:
    """Newest pad_imagery_log row for this pad strictly older than `before`."""
    q = (
        client.table("pad_imagery_log")
        .select(
            "storage_path,imagery_date,cloud_cover,api_number,rrc_lease_id"
        )
        .eq("county_id", target.county_id)
        .lt("imagery_date", before.isoformat())
        .order("imagery_date", desc=True)
        .limit(5)
    )
    if target.api_number:
        q = q.eq("api_number", target.api_number)
    elif target.rrc_lease_id:
        q = q.eq("rrc_lease_id", target.rrc_lease_id)
    else:
        return None

    try:
        rows = (q.execute().data) or []
    except Exception as exc:
        print(f"    warn: prior chip lookup failed: {exc}", flush=True)
        return None
    if not rows:
        return None
    row = rows[0]
    try:
        imagery_date = dt.date.fromisoformat(str(row["imagery_date"])[:10])
    except ValueError:
        return None
    try:
        rgb = download_chip_rgb(client, row["storage_path"])
    except Exception as exc:
        print(
            f"    warn: prior chip download failed ({row['storage_path']}): {exc}",
            flush=True,
        )
        return None
    return ChipResult(
        storage_path=row["storage_path"],
        imagery_date=imagery_date,
        cloud_cover=float(row["cloud_cover"])
        if row.get("cloud_cover") is not None
        else None,
        scene_id="",
        width=int(rgb.shape[1]),
        height=int(rgb.shape[0]),
        rgb=rgb,
    )


def _upsert_change_log(
    client: Any,
    *,
    target: PadTarget,
    week_start: dt.date,
    change_score: float,
    classification: str,
    before_path: str,
    after_path: str,
    metrics: dict[str, Any],
    dry_run: bool,
) -> None:
    row = {
        "county_id": target.county_id,
        "rrc_lease_id": target.rrc_lease_id,
        "api_number": target.api_number,
        "abstract_number": target.abstract_number,
        "week_start": week_start.isoformat(),
        "change_score": change_score,
        "classification": classification,
        "before_path": before_path,
        "after_path": after_path,
        "metrics": metrics,
    }
    if dry_run:
        return
    q = (
        client.table("pad_change_log")
        .delete()
        .eq("county_id", target.county_id)
        .eq("week_start", week_start.isoformat())
    )
    if target.api_number:
        q = q.eq("api_number", target.api_number)
    elif target.rrc_lease_id:
        q = q.eq("rrc_lease_id", target.rrc_lease_id)
    q.execute()
    client.table("pad_change_log").insert(row).execute()


def detect_pad_change(
    client: Any,
    target: PadTarget,
    *,
    week_end: dt.date,
    lookback_days: int = 14,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Pull before/after, score change, optionally emit a user-facing event."""
    week_start = _week_start(week_end)
    result: dict[str, Any] = {
        "pad_id": pad_id(target),
        "status": "ok",
        "classification": None,
        "signature": None,
        "event": None,
        "after_path": None,
        "before_path": None,
    }

    after = pull_chip_for_target(
        client,
        target,
        week_end=week_end,
        lookback_days=lookback_days,
        dry_run=dry_run,
    )
    if after.skipped or after.rgb is None:
        result["status"] = "no_after_scene"
        return result
    result["after_path"] = after.storage_path

    # Prefer a logged prior chip; else pull a fresh one from the prior window.
    before = _find_prior_logged_chip(client, target, before=after.imagery_date)
    if before is None:
        prior_end = after.imagery_date - dt.timedelta(days=1)
        before = pull_chip_for_target(
            client,
            target,
            week_end=prior_end,
            lookback_days=lookback_days,
            dry_run=dry_run,
        )
        if before.skipped or before.rgb is None:
            result["status"] = "no_before_scene"
            return result
    result["before_path"] = before.storage_path

    if before.storage_path == after.storage_path:
        result["status"] = "same_chip"
        return result

    change = compare_chips(before.rgb, after.rgb)
    result["classification"] = change.classification
    result["change_score"] = change.change_score

    _upsert_change_log(
        client,
        target=target,
        week_start=week_start,
        change_score=change.change_score,
        classification=change.classification,
        before_path=before.storage_path,
        after_path=after.storage_path,
        metrics={
            **change.metrics,
            "before_date": before.imagery_date.isoformat(),
            "after_date": after.imagery_date.isoformat(),
            "before_scene": before.scene_id,
            "after_scene": after.scene_id,
        },
        dry_run=dry_run,
    )

    # NO_CHANGE stays log-only. MINOR_CHANGE always enters the human
    # review queue as AMBIGUOUS (more photo sets for brokers to triage).
    # MAJOR_CHANGE goes through the classifier as before.
    if change.classification == "NO_CHANGE":
        result["status"] = "logged_no_event"
        return result

    sig = classify_signature(before.rgb, after.rgb, change.metrics)
    signature = sig.signature
    confidence = sig.confidence
    if change.classification == "MINOR_CHANGE":
        signature = "AMBIGUOUS"
        confidence = min(confidence, 0.55)
    elif signature == "NON_RELEVANT":
        result["status"] = "major_non_relevant"
        result["signature"] = signature
        return result

    event = {
        "county_id": target.county_id,
        "rrc_lease_id": target.rrc_lease_id,
        "api_number": target.api_number,
        "abstract_number": target.abstract_number,
        "owner_name": None,
        "lease_name": target.lease_name,
        "operator_name": target.operator_name,
        "signature": signature,
        "confidence": confidence,
        "change_score": change.change_score,
        "summary": summary_for_signature(
            signature, confidence, lease_name=target.lease_name
        ),
        "before_path": before.storage_path,
        "after_path": after.storage_path,
        "week_start": week_start.isoformat(),
        "propensity_bump": 0,
        "source": "sentinel_change",
        "raw": {
            "features": sig.features,
            "metrics": change.metrics,
            "change_classification": change.classification,
            "needs_review": signature == "AMBIGUOUS",
            "before_date": before.imagery_date.isoformat(),
            "after_date": after.imagery_date.isoformat(),
        },
    }
    result["status"] = "event"
    result["signature"] = signature
    result["event"] = event
    return result


def run_imagery_detection(
    client: Any,
    targets: Iterable[PadTarget],
    *,
    week_end: dt.date | None = None,
    lookback_days: int = 14,
    max_chips: int = 25,
    sleep_s: float = 0.35,
    dry_run: bool = False,
) -> dict[str, int]:
    """End-to-end Phase 2b for up to max_chips pads. Returns counters."""
    week_end = week_end or dt.date.today()
    stats = {
        "attempted": 0,
        "chips_uploaded": 0,
        "pairs_scored": 0,
        "major_changes": 0,
        "events": 0,
        "events_written": 0,
        "propensity_bumps": 0,
        "deals_tagged_hot": 0,
        "skipped": 0,
        "errors": 0,
    }
    events: list[dict[str, Any]] = []

    for i, target in enumerate(targets):
        if i >= max_chips:
            break
        stats["attempted"] += 1
        try:
            out = detect_pad_change(
                client,
                target,
                week_end=week_end,
                lookback_days=lookback_days,
                dry_run=dry_run,
            )
            status = out.get("status")
            if status == "event":
                stats["chips_uploaded"] += 2  # before+after (approx)
                stats["pairs_scored"] += 1
                if out.get("classification") == "MAJOR_CHANGE":
                    stats["major_changes"] += 1
                stats["events"] += 1
                events.append(out["event"])
                print(
                    f"    EVENT {out['pad_id']}: {out['signature']} "
                    f"({out.get('classification')}) "
                    f"score={out.get('change_score', 0):.3f} "
                    f"{out['before_path']} → {out['after_path']}",
                    flush=True,
                )
            elif status == "logged_no_event":
                stats["chips_uploaded"] += 2
                stats["pairs_scored"] += 1
                print(
                    f"    ok {out['pad_id']}: {out.get('classification')} "
                    f"score={out.get('change_score', 0):.3f}",
                    flush=True,
                )
            elif status == "major_non_relevant":
                stats["chips_uploaded"] += 2
                stats["pairs_scored"] += 1
                stats["major_changes"] += 1
                print(
                    f"    ok {out['pad_id']}: MAJOR but NON_RELEVANT",
                    flush=True,
                )
            else:
                stats["skipped"] += 1
                print(f"    skip {out['pad_id']}: {status}", flush=True)
        except Exception as exc:
            stats["errors"] += 1
            print(f"    ERR {pad_id(target)}: {exc}", flush=True)
        if sleep_s > 0:
            time.sleep(sleep_s)

    if events:
        # Attach owners (fan-out) then bump + upsert like the RRC path.
        by_county: dict[str, list[dict[str, Any]]] = {}
        for ev in events:
            by_county.setdefault(ev["county_id"], []).append(ev)

        enriched: list[dict[str, Any]] = []
        for county, county_events in by_county.items():
            enriched.extend(attach_owners(client, county, county_events))

        bump_stats = bump_propensity_and_tag_deals(
            client, enriched, dry_run=dry_run
        )
        for ev in enriched:
            if ev.get("signature") == "COMPLETION_CREW" and ev.get("owner_name"):
                ev["propensity_bump"] = ev.get("propensity_bump") or 3

        written = upsert_events(client, enriched, dry_run=dry_run)
        stats["events_written"] = written
        stats["propensity_bumps"] = bump_stats["propensity_bumps"]
        stats["deals_tagged_hot"] = bump_stats["deals_tagged_hot"]

    return stats
