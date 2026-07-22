#!/usr/bin/env python3
"""Weekly pad-activity job.

Default path (Phase 1 — ships real signal today, no imagery needed):
  1. Scan {county}_permits / {county}_wells for recent
     completion_date, spud_date, or approved/filed_date (90d default)
  2. Attach mineral owners
  3. Upsert pad_activity_events
  4. Bump propensity_score + tag CRM deals hot (completion signals)

Optional (`--enable-sentinel`):
  Pull Sentinel-2 chips for recent active pads (crop → Raw-Data/
  pad-imagery → pad_imagery_log). Change+classify wiring is next.

Usage:
  python -m scripts.pad_activity.run_weekly --county howard,martin
  python -m scripts.pad_activity.run_weekly --county howard --dry-run
  python -m scripts.pad_activity.run_weekly --county howard --enable-sentinel --max-chips 10
  python -m scripts.pad_activity.run_weekly --county howard --enable-sentinel --plan-only
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

# Allow `python scripts/pad_activity/run_weekly.py` as well as -m.
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scripts.pad_activity import PERMIAN_PAD_COUNTIES  # noqa: E402
from scripts.pad_activity.db import make_client, paginate_table  # noqa: E402
from scripts.pad_activity.propagate import (  # noqa: E402
    attach_owners,
    bump_propensity_and_tag_deals,
    upsert_events,
)
from scripts.pad_activity.rrc_bridge import detect_rrc_completions  # noqa: E402
from scripts.pad_activity.sentinel import (  # noqa: E402
    PadTarget,
    plan_weekly_pull,
    pull_chips,
)


ACTIVE_DEFAULT = ("howard", "martin")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--county",
        default=",".join(ACTIVE_DEFAULT),
        help="Comma-separated county ids (default: howard,martin)",
    )
    p.add_argument("--dry-run", action="store_true")
    p.add_argument(
        "--enable-sentinel",
        action="store_true",
        help="Pull Sentinel-2 pad chips into Raw-Data/pad-imagery",
    )
    p.add_argument(
        "--plan-only",
        action="store_true",
        help="With --enable-sentinel, only print the pull plan",
    )
    p.add_argument(
        "--max-chips",
        type=int,
        default=25,
        help="Max Sentinel chips to pull per county (default 25)",
    )
    p.add_argument(
        "--sentinel-lookback-days",
        type=int,
        default=14,
        help="STAC search window ending today (default 14)",
    )
    p.add_argument(
        "--lookback-days",
        type=int,
        default=90,
        help="RRC activity lookback window in days (default 90)",
    )
    p.add_argument(
        "--skip-rrc",
        action="store_true",
        help="Skip Phase-1 RRC bridge (imagery-only run)",
    )
    return p.parse_args()


def _coord_pair(row: dict) -> tuple[float, float] | None:
    lat, lon = row.get("latitude"), row.get("longitude")
    if lat is None or lon is None:
        return None
    try:
        lat_f, lon_f = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if lat_f == 0 and lon_f == 0:
        return None
    # Rough Permian bounds — drop obvious junk coords.
    if not (29.0 <= lat_f <= 34.5 and -105.5 <= lon_f <= -100.0):
        return None
    return lat_f, lon_f


def _wells_as_pad_targets(client, county: str) -> list[PadTarget]:
    rows = paginate_table(
        client,
        f"{county}_wells",
        "api_number,rrc_lease_id,abstract,latitude,longitude,lease_name,operator_name",
    )
    targets: list[PadTarget] = []
    for r in rows:
        coords = _coord_pair(r)
        if not coords:
            continue
        lat_f, lon_f = coords
        targets.append(
            PadTarget(
                county_id=county,
                api_number=str(r.get("api_number") or "") or None,
                rrc_lease_id=str(r.get("rrc_lease_id") or "") or None,
                abstract_number=str(r.get("abstract") or "") or None,
                latitude=lat_f,
                longitude=lon_f,
                lease_name=str(r.get("lease_name") or "") or None,
                operator_name=str(r.get("operator_name") or "") or None,
            )
        )
    return targets


def _active_pad_targets(client, county: str, lookback_days: int) -> list[PadTarget]:
    """Prefer pads with recent permit activity + coords (smaller pull set)."""
    cutoff = dt.date.today() - dt.timedelta(days=lookback_days)
    rows = paginate_table(
        client,
        f"{county}_permits",
        "api_number,abstract_number,latitude,longitude,lease_name,operator_name,"
        "approved_date,filed_date,spud_date,completion_date",
    )
    seen: set[str] = set()
    targets: list[PadTarget] = []

    def _parse(raw: object) -> dt.date | None:
        if raw is None:
            return None
        text = str(raw).strip()[:10]
        try:
            return dt.date.fromisoformat(text)
        except ValueError:
            return None

    for r in rows:
        dates = [
            _parse(r.get("completion_date")),
            _parse(r.get("spud_date")),
            _parse(r.get("approved_date")),
            _parse(r.get("filed_date")),
        ]
        if not any(d and d >= cutoff for d in dates):
            continue
        coords = _coord_pair(r)
        if not coords:
            continue
        lat_f, lon_f = coords
        api = str(r.get("api_number") or "").strip() or None
        key = api or f"{lat_f:.5f},{lon_f:.5f}"
        if key in seen:
            continue
        seen.add(key)
        targets.append(
            PadTarget(
                county_id=county,
                api_number=api,
                rrc_lease_id=None,
                abstract_number=str(r.get("abstract_number") or "") or None,
                latitude=lat_f,
                longitude=lon_f,
                lease_name=str(r.get("lease_name") or "") or None,
                operator_name=str(r.get("operator_name") or "") or None,
            )
        )
    return targets


def main() -> int:
    args = parse_args()
    counties = [c.strip().lower() for c in args.county.split(",") if c.strip()]
    unknown = [c for c in counties if c not in PERMIAN_PAD_COUNTIES]
    if unknown:
        print(f"WARN: counties not in Permian pad list: {unknown}", flush=True)

    client = make_client()
    total_events = 0
    total_bumps = 0
    total_chips = 0

    for county in counties:
        print(f"\n=== {county} ===", flush=True)

        if args.enable_sentinel:
            # Plan against the full well inventory; pull only recent-active pads.
            all_targets = _wells_as_pad_targets(client, county)
            active_targets = _active_pad_targets(
                client, county, lookback_days=args.lookback_days
            )
            pull_targets = active_targets or all_targets
            print(
                f"  pad targets: wells_with_coords={len(all_targets):,} "
                f"recent_active={len(active_targets):,} "
                f"pull_queue={min(len(pull_targets), args.max_chips):,}",
                flush=True,
            )
            plan = plan_weekly_pull(pull_targets, week_end=dt.date.today())
            print(f"  sentinel pull plan rows: {len(plan):,}", flush=True)
            if args.plan_only:
                for row in plan[:5]:
                    print(f"    e.g. {row['storage_key']}", flush=True)
                if len(plan) > 5:
                    print(f"    … +{len(plan) - 5} more", flush=True)
                if args.skip_rrc:
                    continue
            else:
                stats = pull_chips(
                    client,
                    pull_targets,
                    week_end=dt.date.today(),
                    lookback_days=args.sentinel_lookback_days,
                    max_chips=args.max_chips,
                    dry_run=args.dry_run,
                )
                print(
                    f"  sentinel chips: attempted={stats['attempted']} "
                    f"uploaded={stats['uploaded']} "
                    f"no_scene={stats['skipped_no_scene']} "
                    f"errors={stats['errors']}",
                    flush=True,
                )
                total_chips += stats["uploaded"]

        if args.skip_rrc:
            continue

        events = detect_rrc_completions(
            client, county, lookback_days=args.lookback_days
        )
        print(f"  rrc completion candidates: {len(events):,}", flush=True)
        events = attach_owners(client, county, events)
        print(f"  after owner attach: {len(events):,}", flush=True)

        bump_stats = bump_propensity_and_tag_deals(
            client, events, dry_run=args.dry_run
        )
        for ev in events:
            if ev.get("signature") in {"COMPLETION_CREW", "RRC_COMPLETION"} and ev.get(
                "owner_name"
            ):
                ev["propensity_bump"] = ev.get("propensity_bump") or 3

        written = upsert_events(client, events, dry_run=args.dry_run)
        print(
            f"  events written: {written:,} | "
            f"propensity bumps: {bump_stats['propensity_bumps']:,} | "
            f"deals tagged hot: {bump_stats['deals_tagged_hot']:,}",
            flush=True,
        )
        total_events += written
        total_bumps += bump_stats["propensity_bumps"]

    print(
        f"\nDone. events={total_events:,} propensity_bumps={total_bumps:,} "
        f"chips_uploaded={total_chips:,}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
