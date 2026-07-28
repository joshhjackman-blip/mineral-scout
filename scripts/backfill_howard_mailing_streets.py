#!/usr/bin/env python3
"""Backfill Howard street mailing addresses from the CAD mineral roll.

Howard CAD commonly leaves ``address1`` blank and puts the street line in
``address2`` (e.g. AMBURGEY SARA ELIZABETH → ``15515 E 87TH PL N``). An earlier
load/enrich pass left ``mailing_address`` / ``address_1`` empty while still
populating city/state/zip, so the Owner drawer showed only ``OWASSO OK 74055``.

This script:

1. Builds ``owner_name → street`` from ``data/howard_mineral_roll.csv``
   (address1..address4 joined, same rules as ``load_county_mineral_records``).
2. Patches ``address_1`` on empty streets in the enriched parcel GeoJSON
   (``public/`` and ``data/`` copies).
3. Optionally updates ``howard_mineral_ownership.mailing_address`` in Supabase
   when ``SUPABASE_URL`` + service role key are present (``--apply-db``).

Usage::

    python3 scripts/backfill_howard_mailing_streets.py
    python3 scripts/backfill_howard_mailing_streets.py --apply-db
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CSV = ROOT / "data" / "howard_mineral_roll.csv"
GEOJSON_PATHS = [
    ROOT / "public" / "howard_parcels_enriched.geojson",
    ROOT / "data" / "howard_parcels_enriched.geojson",
]
OWNERSHIP_TABLE = "howard_mineral_ownership"


def clean_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def street_from_row(row: dict[str, str]) -> str | None:
    parts = [
        clean_str(row.get("address1")),
        clean_str(row.get("address2")),
        clean_str(row.get("address3")),
        clean_str(row.get("address4")),
    ]
    joined = ", ".join(p for p in parts if p)
    return joined or None


def load_street_by_owner(csv_path: Path) -> dict[str, str]:
    """Map normalized owner name → preferred street line."""
    by_owner: dict[str, str] = {}
    with csv_path.open(newline="", encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh):
            name = clean_str(row.get("owner"))
            street = street_from_row(row)
            if not name or not street:
                continue
            key = name.upper()
            # Prefer the longest non-empty street seen for an owner (covers
            # truncated / spacing variants across lease rows).
            prev = by_owner.get(key)
            if prev is None or len(street) > len(prev):
                by_owner[key] = street
    return by_owner


def street_from_raw_record(raw: Any) -> str | None:
    if not isinstance(raw, dict):
        return None
    # raw_record may use original CAD keys.
    lower = {str(k).strip().lower(): v for k, v in raw.items()}
    parts = [
        clean_str(lower.get("address1")),
        clean_str(lower.get("address2")),
        clean_str(lower.get("address3")),
        clean_str(lower.get("address4")),
    ]
    joined = ", ".join(p for p in parts if p)
    return joined or None


def patch_geojson(path: Path, streets: dict[str, str], dry_run: bool) -> tuple[int, int]:
    if not path.exists():
        print(f"Skip missing geojson: {path}")
        return 0, 0

    print(f"Loading {path} …")
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)

    filled = 0
    already = 0
    for feat in data.get("features") or []:
        props = feat.get("properties") or {}
        owners_raw = props.get("owners_json")
        if owners_raw is None:
            continue
        owners = json.loads(owners_raw) if isinstance(owners_raw, str) else owners_raw
        if not isinstance(owners, list):
            continue
        changed = False
        for owner in owners:
            if not isinstance(owner, dict):
                continue
            existing = clean_str(owner.get("address_1")) or clean_str(
                owner.get("mailing_address")
            )
            if existing:
                already += 1
                continue
            name = clean_str(owner.get("owner_name"))
            if not name:
                continue
            street = streets.get(name.upper())
            if not street:
                continue
            owner["address_1"] = street
            filled += 1
            changed = True
        if changed:
            # Keep list form (matches existing Howard file shape).
            props["owners_json"] = owners

    print(f"  {path.name}: filled {filled} empty streets; {already} already had street")
    if not dry_run and filled:
        print(f"  Writing {path} …")
        with path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"))
            fh.write("\n")
    return filled, already


def apply_db(streets: dict[str, str], dry_run: bool) -> int:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        print("No Supabase credentials in env; skipping --apply-db.")
        return 0

    try:
        from supabase import create_client
    except ImportError as exc:
        raise SystemExit(
            "supabase-py is required for --apply-db. "
            "pip install supabase"
        ) from exc

    client = create_client(url, key)
    updated = 0
    page_size = 1000
    last_id: int | None = None
    page = 0

    while True:
        query = (
            client.table(OWNERSHIP_TABLE)
            .select("id, owner_name, mailing_address, raw_record")
            .order("id", desc=False)
            .limit(page_size)
        )
        if last_id is not None:
            query = query.gt("id", last_id)
        result = query.execute()
        rows = result.data or []
        if not rows:
            break
        page += 1
        for row in rows:
            last_id = int(row["id"])
            existing = clean_str(row.get("mailing_address"))
            if existing:
                continue
            name = clean_str(row.get("owner_name"))
            street = streets.get((name or "").upper()) if name else None
            if not street:
                street = street_from_raw_record(row.get("raw_record"))
            if not street:
                continue
            updated += 1
            if dry_run:
                continue
            client.table(OWNERSHIP_TABLE).update(
                {"mailing_address": street}
            ).eq("id", row["id"]).execute()
        print(f"  DB page {page}: scanned {len(rows)}; updates so far {updated}")
        if len(rows) < page_size:
            break

    print(f"DB mailing_address backfill candidates: {updated}" + (" (dry-run)" if dry_run else ""))
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument(
        "--apply-db",
        action="store_true",
        help="Also UPDATE howard_mineral_ownership.mailing_address when empty",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report counts without writing geojson or DB",
    )
    parser.add_argument(
        "--skip-geojson",
        action="store_true",
        help="Only run DB backfill (requires --apply-db)",
    )
    args = parser.parse_args()

    if not args.csv.exists():
        raise SystemExit(f"CSV not found: {args.csv}")

    streets = load_street_by_owner(args.csv)
    print(f"Loaded {len(streets):,} unique owner streets from {args.csv.name}")
    sample = streets.get("AMBURGEY SARA ELIZABETH")
    if sample:
        print(f"  Sample AMBURGEY SARA ELIZABETH → {sample!r}")

    if not args.skip_geojson:
        total_filled = 0
        for path in GEOJSON_PATHS:
            filled, _ = patch_geojson(path, streets, dry_run=args.dry_run)
            total_filled += filled
        print(f"GeoJSON empty→street fills: {total_filled}")

    if args.apply_db:
        apply_db(streets, dry_run=args.dry_run)

    if args.dry_run:
        print("Dry run complete — no files written.")


if __name__ == "__main__":
    main()
    sys.exit(0)
