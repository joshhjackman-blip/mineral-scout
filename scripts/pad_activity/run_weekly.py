#!/usr/bin/env python3
"""Weekly pad-activity job.

Default path (Phase 1 — ships real signal today, no imagery needed):
  1. Scan {county}_permits / {county}_wells for recent
     completion_date, spud_date, or approved/filed_date (90d default)
  2. Attach mineral owners
  3. Upsert pad_activity_events
  4. Bump propensity_score + tag CRM deals hot (completion signals)

Optional (`--enable-sentinel`):
  Plan / pull Sentinel-2 chips, run change+classify, write pad_change_log.
  Chip crop is still stubbed — this flag validates STAC connectivity and
  pad targeting until rasterio crop lands in Phase 2.

Usage:
  python -m scripts.pad_activity.run_weekly --county howard,martin
  python -m scripts.pad_activity.run_weekly --county howard --dry-run
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
from scripts.pad_activity.sentinel import PadTarget, plan_weekly_pull  # noqa: E402


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
        help="Also plan/pull Sentinel-2 chips (Phase 2 path)",
    )
    p.add_argument(
        "--plan-only",
        action="store_true",
        help="With --enable-sentinel, only print the pull plan",
    )
    p.add_argument(
        "--lookback-days",
        type=int,
        default=90,
        help="RRC activity lookback window in days (default 90)",
    )
    return p.parse_args()


def _wells_as_pad_targets(client, county: str) -> list[PadTarget]:
    rows = paginate_table(
        client,
        f"{county}_wells",
        "api_number,rrc_lease_id,abstract,latitude,longitude,lease_name,operator_name",
    )
    targets: list[PadTarget] = []
    for r in rows:
        lat, lon = r.get("latitude"), r.get("longitude")
        if lat is None or lon is None:
            continue
        try:
            lat_f, lon_f = float(lat), float(lon)
        except (TypeError, ValueError):
            continue
        if lat_f == 0 and lon_f == 0:
            continue
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


def main() -> int:
    args = parse_args()
    counties = [c.strip().lower() for c in args.county.split(",") if c.strip()]
    unknown = [c for c in counties if c not in PERMIAN_PAD_COUNTIES]
    if unknown:
        print(f"WARN: counties not in Permian pad list: {unknown}", flush=True)

    client = make_client()
    total_events = 0
    total_bumps = 0

    for county in counties:
        print(f"\n=== {county} ===", flush=True)

        if args.enable_sentinel:
            targets = _wells_as_pad_targets(client, county)
            print(f"  pad targets with coords: {len(targets):,}", flush=True)
            plan = plan_weekly_pull(targets, week_end=dt.date.today())
            print(f"  sentinel pull plan rows: {len(plan):,}", flush=True)
            if args.plan_only:
                for row in plan[:5]:
                    print(f"    e.g. {row['storage_key']}", flush=True)
                if len(plan) > 5:
                    print(f"    … +{len(plan) - 5} more", flush=True)
                continue
            print(
                "  sentinel chip crop is stubbed — skipping imagery write. "
                "RRC bridge still runs below.",
                flush=True,
            )

        events = detect_rrc_completions(
            client, county, lookback_days=args.lookback_days
        )
        print(f"  rrc completion candidates: {len(events):,}", flush=True)
        events = attach_owners(client, county, events)
        print(f"  after owner attach: {len(events):,}", flush=True)

        bump_stats = bump_propensity_and_tag_deals(
            client, events, dry_run=args.dry_run
        )
        # propensity_bump stamped onto events before upsert
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
        f"\nDone. events={total_events:,} propensity_bumps={total_bumps:,}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
