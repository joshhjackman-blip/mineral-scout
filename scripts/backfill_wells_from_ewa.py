#!/usr/bin/env python3
"""Backfill ``<county>_wells`` rrc_lease_id / lease_name / operator_name / oil_gas_code
from the Texas RRC OG_WELLBORE_EWA report.

The CAD owner roll only carries lease IDs for wells that have an active
mineral-tax interest, which leaves ~50% of the RRC well shapefile
unmatched (plugged / abandoned / disposal wells the CAD doesn't track).
This script uses the master EWA wellbore report — the same source the
RRC publishes — to fill the gap.

EWA layout (no header, ~1.36 M rows, 59 cols, 495 MB):
    col 3  -> 8-digit API ("RRC county code" + 5-digit well number)
    col 4  -> county name (HOWARD / MARTIN / ...)
    col 5  -> oil/gas code ('O' or 'G')
    col 6  -> lease name
    col 9  -> RRC lease number (mapped to rrc_lease_id)
    col 12 -> operator name

Usage::

    python3 scripts/backfill_wells_from_ewa.py --county howard
    python3 scripts/backfill_wells_from_ewa.py --county martin
    python3 scripts/backfill_wells_from_ewa.py --county howard --dry-run
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from pathlib import Path
from typing import Any

DEFAULT_EWA_PATH = Path("data/ewa/OG_WELLBORE_EWA_Report_2026-03-03.csv")
PAGE_SIZE = 1000

# CSV files in EWA can have very long fields.
csv.field_size_limit(5_000_000)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--county", required=True, help="County id (martin, howard).")
    parser.add_argument("--ewa-path", default=str(DEFAULT_EWA_PATH))
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument(
        "--only-missing",
        action="store_true",
        default=True,
        help="Only patch rows where rrc_lease_id IS NULL (default).",
    )
    parser.add_argument(
        "--all",
        dest="only_missing",
        action="store_false",
        help="Patch every row, overwriting any existing rrc_lease_id.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--supabase-url")
    parser.add_argument("--supabase-key")
    return parser.parse_args()


def require_env_or_arg(value: str | None, *env_names: str) -> str:
    if value:
        return value
    for env_name in env_names:
        env_value = os.getenv(env_name)
        if env_value:
            return env_value
    joined = " / ".join(env_names)
    raise ValueError(f"Missing required value. Pass argument or set one of: {joined}")


def normalize_api(value: Any) -> str | None:
    text = str(value or "").strip().strip('"')
    digits = "".join(c for c in text if c.isdigit())
    if not digits:
        return None
    # Strip leading zeros for canonical comparison (matches what
    # load_county_wells_shapefile.normalize_api produces).
    return digits.lstrip("0") or "0"


def clean_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().strip('"')
    return text or None


def build_lookup(ewa_path: Path, county_name_upper: str) -> dict[str, dict[str, str]]:
    """Stream the EWA CSV and return a ``api -> {fields}`` dict for one county.

    Keeps only the first hit per API to avoid storing every wellbore status
    revision. EWA appears to be deduped by 8-digit API already (1.36 M rows
    for ~1 M wells in Texas), but we de-dup defensively anyway.
    """
    lookup: dict[str, dict[str, str]] = {}
    matched = 0
    scanned = 0
    start = time.time()
    with ewa_path.open(encoding="latin-1") as f:
        reader = csv.reader(f)
        for row in reader:
            scanned += 1
            if len(row) < 13:
                continue
            county = (row[3] or "").strip().strip('"').upper()
            if county != county_name_upper:
                continue
            api = normalize_api(row[2])
            if not api or api in lookup:
                continue
            lookup[api] = {
                "rrc_lease_id": clean_str(row[8]),
                "lease_name": clean_str(row[5]),
                "operator_name": clean_str(row[11]),
                "oil_gas_code": (clean_str(row[4]) or "").upper() or None,
            }
            matched += 1
            if matched % 5000 == 0:
                print(f"  matched {matched:,} / scanned {scanned:,} ({time.time()-start:.0f}s)", flush=True)
    print(
        f"Built lookup with {len(lookup):,} unique API entries for {county_name_upper} "
        f"(scanned {scanned:,} EWA rows in {time.time()-start:.0f}s).",
        flush=True,
    )
    return lookup


def fetch_wells_to_patch(client, table: str, only_missing: bool) -> list[dict[str, Any]]:
    """Page through ``<county>_wells`` and pull the rows that need patching."""
    all_rows: list[dict[str, Any]] = []
    last_id = 0
    while True:
        query = (
            client.table(table)
            .select("id, api_number, rrc_lease_id, lease_name, operator_name, oil_gas_code")
            .gt("id", last_id)
            .order("id", desc=False)
            .limit(PAGE_SIZE)
        )
        if only_missing:
            query = query.is_("rrc_lease_id", "null")
        result = query.execute()
        rows = result.data or []
        if not rows:
            break
        all_rows.extend(rows)
        last_id = rows[-1]["id"]
        print(f"  fetched {len(all_rows):,} target rows", flush=True)
        if len(rows) < PAGE_SIZE:
            break
    return all_rows


def main() -> None:
    args = parse_args()
    county_id = args.county.strip().lower()
    table = f"{county_id}_wells"
    ewa_path = Path(args.ewa_path)
    if not ewa_path.exists():
        sys.exit(f"EWA file not found at {ewa_path}. Download it first.")

    print(f"Building EWA lookup for {county_id.upper()} from {ewa_path}…", flush=True)
    lookup = build_lookup(ewa_path, county_id.upper())
    if not lookup:
        sys.exit(f"No EWA rows for county {county_id.upper()} — aborting.")

    try:
        from supabase import create_client
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "Missing dependency 'supabase'. Install with: pip install supabase"
        ) from exc

    supabase_url = require_env_or_arg(args.supabase_url, "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL")
    supabase_key = require_env_or_arg(args.supabase_key, "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY")
    client = create_client(supabase_url, supabase_key)

    print(f"Fetching {table} rows that need patching…", flush=True)
    target_rows = fetch_wells_to_patch(client, table, args.only_missing)
    print(f"Got {len(target_rows):,} rows to consider.", flush=True)

    patches: list[tuple[int, dict[str, Any]]] = []
    matched = 0
    for row in target_rows:
        api = normalize_api(row.get("api_number"))
        if not api:
            continue
        ewa = lookup.get(api)
        if not ewa:
            continue
        update: dict[str, Any] = {}
        if ewa.get("rrc_lease_id") and not row.get("rrc_lease_id"):
            update["rrc_lease_id"] = ewa["rrc_lease_id"]
        if ewa.get("lease_name") and not row.get("lease_name"):
            update["lease_name"] = ewa["lease_name"]
        if ewa.get("operator_name") and not row.get("operator_name"):
            update["operator_name"] = ewa["operator_name"]
        if ewa.get("oil_gas_code") and not row.get("oil_gas_code"):
            update["oil_gas_code"] = ewa["oil_gas_code"]
        if update:
            patches.append((row["id"], update))
            matched += 1

    print(f"Prepared {len(patches):,} PATCH updates ({matched:,} wells matched in EWA).", flush=True)

    if args.dry_run:
        print("Dry run — first 3 patch payloads:")
        for entry in patches[:3]:
            print(f"  {entry}")
        return

    written = 0
    start = time.time()
    for row_id, update in patches:
        # PATCH by primary key — fastest possible path, no scans.
        for attempt in range(3):
            try:
                client.table(table).update(update).eq("id", row_id).execute()
                break
            except Exception as exc:
                if attempt < 2:
                    time.sleep(0.4)
                    continue
                print(f"  giving up on id={row_id}: {exc!r}", flush=True)
        written += 1
        if written % 500 == 0 or written == len(patches):
            print(
                f"  patched {written:,}/{len(patches):,} "
                f"({written / len(patches) * 100:.1f}%, {time.time()-start:.0f}s)",
                flush=True,
            )
    print(f"Done. Patched {written:,} {table} rows.")


if __name__ == "__main__":
    main()
