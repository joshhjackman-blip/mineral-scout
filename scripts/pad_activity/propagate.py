"""Write pad_activity_events, bump propensity, tag CRM deals hot."""

from __future__ import annotations

from typing import Any

from supabase import Client

from .config import COMPLETION_PROPENSITY_BUMP, PROPENSITY_SCORE_CAP
from .db import paginate_table


COMPLETION_SIGNATURES = frozenset({"COMPLETION_CREW", "RRC_COMPLETION"})


def _normalize_lease(raw: Any) -> str:
    text = str(raw or "").strip()
    return text.lstrip("0") or text


def attach_owners(
    client: Client,
    county: str,
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Best-effort fill owner_name from {county}_mineral_ownership."""
    if not events:
        return events
    table = f"{county}_mineral_ownership"
    owners = paginate_table(
        client,
        table,
        "owner_name,rrc_lease_id,abstract,propensity_score",
        max_rows=50_000,
    )
    by_abstract: dict[str, list[dict[str, Any]]] = {}
    by_lease: dict[str, list[dict[str, Any]]] = {}
    for o in owners:
        abs_key = str(o.get("abstract") or "").strip()
        if abs_key:
            by_abstract.setdefault(abs_key, []).append(o)
        lease_key = _normalize_lease(o.get("rrc_lease_id"))
        if lease_key:
            by_lease.setdefault(lease_key, []).append(o)

    enriched: list[dict[str, Any]] = []
    for ev in events:
        matches: list[dict[str, Any]] = []
        abs_key = str(ev.get("abstract_number") or "").strip()
        if abs_key and abs_key in by_abstract:
            matches = by_abstract[abs_key]
        else:
            lease_key = _normalize_lease(ev.get("rrc_lease_id"))
            if lease_key and lease_key in by_lease:
                matches = by_lease[lease_key]

        if not matches:
            enriched.append(ev)
            continue

        # Emit one event per matched owner so each drawer lights up.
        # Cap at 8 owners per pad to avoid fan-out explosions on
        # heavily fractionalized abstracts.
        for owner in matches[:8]:
            clone = dict(ev)
            clone["owner_name"] = owner.get("owner_name")
            clone["_prior_propensity"] = owner.get("propensity_score")
            enriched.append(clone)
    return enriched


def upsert_events(
    client: Client,
    events: list[dict[str, Any]],
    *,
    dry_run: bool = False,
) -> int:
    if not events:
        return 0
    payload = []
    for ev in events:
        row = {
            "county_id": ev["county_id"],
            "rrc_lease_id": ev.get("rrc_lease_id"),
            "api_number": ev.get("api_number"),
            "abstract_number": ev.get("abstract_number"),
            "owner_name": ev.get("owner_name"),
            "lease_name": ev.get("lease_name"),
            "operator_name": ev.get("operator_name"),
            "signature": ev["signature"],
            "confidence": ev.get("confidence") or 0,
            "change_score": ev.get("change_score"),
            "summary": ev.get("summary") or "",
            "before_path": ev.get("before_path"),
            "after_path": ev.get("after_path"),
            "week_start": ev["week_start"],
            "propensity_bump": ev.get("propensity_bump") or 0,
            "source": ev.get("source") or "sentinel_change",
            "raw": ev.get("raw") or {},
        }
        payload.append(row)

    if dry_run:
        print(f"  [dry-run] would upsert {len(payload)} pad_activity_events")
        return len(payload)

    # No natural unique key across all sources — insert and rely on
    # weekly idempotency via a soft de-dupe on (county, api, week, signature).
    # Delete this week's same-source rows first for the counties present.
    counties = sorted({r["county_id"] for r in payload})
    week = payload[0]["week_start"]
    sources = sorted({r["source"] for r in payload})
    for county in counties:
        for source in sources:
            try:
                (
                    client.table("pad_activity_events")
                    .delete()
                    .eq("county_id", county)
                    .eq("week_start", week)
                    .eq("source", source)
                    .execute()
                )
            except Exception as exc:
                print(f"  warn: pre-delete failed for {county}/{source}: {exc}")

    batch = 200
    written = 0
    for i in range(0, len(payload), batch):
        chunk = payload[i : i + batch]
        client.table("pad_activity_events").insert(chunk).execute()
        written += len(chunk)
    return written


def bump_propensity_and_tag_deals(
    client: Client,
    events: list[dict[str, Any]],
    *,
    dry_run: bool = False,
    bump: int = COMPLETION_PROPENSITY_BUMP,
) -> dict[str, int]:
    """For completion-consistent events: bump ownership propensity + tag deals hot."""
    stats = {"propensity_bumps": 0, "deals_tagged_hot": 0}
    completion_events = [
        e for e in events
        if e.get("signature") in COMPLETION_SIGNATURES and e.get("owner_name")
    ]
    if not completion_events:
        return stats

    # Dedupe owners so we don't triple-bump multi-API events.
    seen: set[tuple[str, str]] = set()
    for ev in completion_events:
        county = ev["county_id"]
        owner_name = str(ev["owner_name"])
        key = (county, owner_name)
        if key in seen:
            continue
        seen.add(key)
        table = f"{county}_mineral_ownership"
        prior = ev.get("_prior_propensity")
        try:
            prior_i = int(prior) if prior is not None else 0
        except (TypeError, ValueError):
            prior_i = 0
        new_score = min(PROPENSITY_SCORE_CAP, prior_i + bump)
        ev["propensity_bump"] = bump

        if dry_run:
            stats["propensity_bumps"] += 1
            stats["deals_tagged_hot"] += 1
            continue

        try:
            (
                client.table(table)
                .update({"propensity_score": new_score, "motivated": new_score >= 5})
                .eq("owner_name", owner_name)
                .execute()
            )
            stats["propensity_bumps"] += 1
        except Exception as exc:
            print(f"  warn: propensity bump failed for {owner_name}: {exc}")

        try:
            (
                client.table("deals")
                .update({"tag": "hot"})
                .eq("owner_name", owner_name)
                .eq("county", county)
                .execute()
            )
            stats["deals_tagged_hot"] += 1
        except Exception as exc:
            # deals.county may be null / differently cased — soft-fail.
            print(f"  warn: deal hot-tag failed for {owner_name}: {exc}")

    return stats
