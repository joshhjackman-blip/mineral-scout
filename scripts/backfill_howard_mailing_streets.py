#!/usr/bin/env python3
"""Backfill Howard mailing addresses from the CAD mineral roll.

Howard CAD commonly leaves ``address1`` blank and puts the street line in
``address2`` (e.g. AMBURGEY SARA ELIZABETH → ``15515 E 87TH PL N``). An earlier
load/enrich pass left ``mailing_address`` / ``address_1`` empty while still
populating city/state/zip, so the Owner drawer showed only ``OWASSO OK 74055``.

This script:

1. Builds ``owner_name → [distinct full addresses]`` from
   ``data/howard_mineral_roll.csv`` (address1..address4 + city/state/zip).
   If an owner has two different streets on the roll, both are kept.
2. Patches every matching owner in the enriched parcel GeoJSON
   (``public/`` and ``data/``): sets ``address_1`` (primary street),
   ``mailing_addresses`` (all distinct full lines), and city/state/zip
   from the first roll row when those were empty.
3. Optionally updates ``howard_mineral_ownership.mailing_address`` in
   Supabase when credentials are present (``--apply-db``). Multiple
   streets are joined with `` | ``.

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


def norm_key(value: str) -> str:
    return " ".join(value.upper().split())


def street_from_row(row: dict[str, str]) -> str | None:
    parts = [
        clean_str(row.get("address1")),
        clean_str(row.get("address2")),
        clean_str(row.get("address3")),
        clean_str(row.get("address4")),
    ]
    joined = ", ".join(p for p in parts if p)
    return joined or None


def city_line_from_row(row: dict[str, str]) -> str | None:
    city = clean_str(row.get("city"))
    state = clean_str(row.get("state"))
    zip_code = clean_str(row.get("zip"))
    parts = [p for p in (city, state, zip_code) if p]
    return " ".join(parts) if parts else None


def full_address_from_row(row: dict[str, str]) -> str | None:
    street = street_from_row(row)
    city_line = city_line_from_row(row)
    if street and city_line:
        return f"{street} · {city_line}"
    return street or city_line


class OwnerAddresses:
    __slots__ = ("streets", "fulls", "city", "state", "zip", "_street_keys", "_full_keys")

    def __init__(self) -> None:
        self.streets: list[str] = []
        self.fulls: list[str] = []
        self.city: str | None = None
        self.state: str | None = None
        self.zip: str | None = None
        self._street_keys: set[str] = set()
        self._full_keys: set[str] = set()

    def add_row(self, row: dict[str, str]) -> None:
        street = street_from_row(row)
        full = full_address_from_row(row)
        if street:
            key = norm_key(street)
            if key not in self._street_keys:
                self._street_keys.add(key)
                self.streets.append(street)
        if full:
            key = norm_key(full)
            if key not in self._full_keys:
                self._full_keys.add(key)
                self.fulls.append(full)
        if self.city is None:
            self.city = clean_str(row.get("city"))
        if self.state is None:
            self.state = clean_str(row.get("state"))
        if self.zip is None:
            self.zip = clean_str(row.get("zip"))

    @property
    def primary_street(self) -> str | None:
        if self.streets:
            # Prefer a real street / PO Box over care-of / "UNKNOWN" noise
            # when multiple exist; still keep all in ``streets`` / ``fulls``.
            ranked = sorted(
                self.streets,
                key=lambda s: (
                    0 if norm_key(s) in {"ADDRESS UNKNOWN", "UNKNOWN ADDRESS", "UNKNOWN"} else 1,
                    len(s),
                ),
                reverse=True,
            )
            return ranked[0]
        return None

    @property
    def mailing_address_db(self) -> str | None:
        if self.streets:
            return " | ".join(self.streets)
        if self.fulls:
            return " | ".join(self.fulls)
        return None


def load_addresses_by_owner(csv_path: Path) -> dict[str, OwnerAddresses]:
    by_owner: dict[str, OwnerAddresses] = {}
    with csv_path.open(newline="", encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh):
            name = clean_str(row.get("owner"))
            if not name:
                continue
            if not full_address_from_row(row):
                continue
            key = name.upper()
            bucket = by_owner.get(key)
            if bucket is None:
                bucket = OwnerAddresses()
                by_owner[key] = bucket
            bucket.add_row(row)
    return by_owner


def street_from_raw_record(raw: Any) -> str | None:
    if not isinstance(raw, dict):
        return None
    lower = {str(k).strip().lower(): v for k, v in raw.items()}
    parts = [
        clean_str(lower.get("address1")),
        clean_str(lower.get("address2")),
        clean_str(lower.get("address3")),
        clean_str(lower.get("address4")),
    ]
    joined = ", ".join(p for p in parts if p)
    return joined or None


def patch_geojson(
    path: Path, by_owner: dict[str, OwnerAddresses], dry_run: bool
) -> tuple[int, int, int]:
    if not path.exists():
        print(f"Skip missing geojson: {path}")
        return 0, 0, 0

    print(f"Loading {path} …")
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)

    filled = 0
    multi = 0
    touched = 0
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
            name = clean_str(owner.get("owner_name"))
            if not name:
                continue
            bucket = by_owner.get(name.upper())
            if not bucket:
                continue

            primary = bucket.primary_street
            fulls = list(bucket.fulls)
            if not primary and not fulls:
                continue

            prev_street = clean_str(owner.get("address_1")) or clean_str(
                owner.get("mailing_address")
            )
            owner["address_1"] = primary or (fulls[0] if fulls else "")
            owner["mailing_addresses"] = fulls
            if bucket.city and not clean_str(owner.get("mailing_city")):
                owner["mailing_city"] = bucket.city
            if bucket.state and not clean_str(owner.get("mailing_state")):
                owner["mailing_state"] = bucket.state
            if bucket.zip and not clean_str(owner.get("mailing_zip")):
                owner["mailing_zip"] = bucket.zip

            touched += 1
            if not prev_street and primary:
                filled += 1
            if len(fulls) > 1:
                multi += 1
            changed = True
        if changed:
            props["owners_json"] = owners

    print(
        f"  {path.name}: touched {touched} owners; "
        f"newly filled streets {filled}; multi-address {multi}"
    )
    if not dry_run and touched:
        print(f"  Writing {path} …")
        with path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"))
            fh.write("\n")
    return filled, multi, touched


def apply_db(by_owner: dict[str, OwnerAddresses], dry_run: bool) -> int:
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
            "supabase-py is required for --apply-db. pip install supabase"
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
            name = clean_str(row.get("owner_name"))
            bucket = by_owner.get((name or "").upper()) if name else None
            street = bucket.mailing_address_db if bucket else None
            if not street:
                street = street_from_raw_record(row.get("raw_record"))
            if not street:
                continue
            existing = clean_str(row.get("mailing_address"))
            # Refresh when empty, or when roll has more distinct streets.
            if existing and ("|" not in street or existing == street):
                if existing == street or (
                    "|" not in street and existing.upper() == street.upper()
                ):
                    continue
                if "|" not in street and street.upper() in existing.upper():
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

    print(
        f"DB mailing_address backfill candidates: {updated}"
        + (" (dry-run)" if dry_run else "")
    )
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument(
        "--apply-db",
        action="store_true",
        help="Also UPDATE howard_mineral_ownership.mailing_address",
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

    by_owner = load_addresses_by_owner(args.csv)
    multi = sum(1 for b in by_owner.values() if len(b.fulls) > 1)
    print(
        f"Loaded {len(by_owner):,} owners with roll addresses "
        f"({multi:,} with 2+ distinct addresses) from {args.csv.name}"
    )
    sample = by_owner.get("AMBURGEY SARA ELIZABETH")
    if sample:
        print(f"  Sample AMBURGEY → {sample.fulls!r}")

    if not args.skip_geojson:
        for path in GEOJSON_PATHS:
            patch_geojson(path, by_owner, dry_run=args.dry_run)

    if args.apply_db:
        apply_db(by_owner, dry_run=args.dry_run)

    if args.dry_run:
        print("Dry run complete — no files written.")


if __name__ == "__main__":
    main()
    sys.exit(0)
