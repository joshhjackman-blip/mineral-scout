#!/usr/bin/env python3
"""Backfill ``<county>_permits`` spud_date / completion_date / permit_status
by joining on api_number against the RRC OG_WELLBORE_EWA_Report_2026-03-03.csv.

The RRC public drilling-permit query only publishes an *approved_date*;
spud + completion filings are stored under W-2 / G-1 / Rule 8 records
that don't show up on the daily permit HTML. The EWA master wellbore
report (1.36 M rows, ~495 MB) aggregates every well's spud + completion
history keyed by 8-digit API, which is enough to derive:

    approved_date set, spud_date null            -> permit_status='approved'
    spud_date set,     completion_date null      -> permit_status='spud'
    completion_date set                          -> permit_status='completed'
    approved > 24 mo, never spud                 -> permit_status='expired'

Ticket 1.3 §3 calls this out as the source for backfilling DUC signals.
Once this runs, ``scripts/compute_development_status.py`` starts
producing accurate PUD_DUC / PUD_PERMITTED classifications instead of
falling back to the SYMNUM heuristic for every non-PDP tract.

CSV column layout (RRC OG_WELLBORE_EWA_Report_2026-03-03, no header):
  col 3   API number       (8-digit '48227...' style, sometimes with leading 0)
  col 4   County name       (HOWARD, MARTIN, GONZALES, ...)
  col 5   Oil / Gas code    ('O' | 'G')
  col 6   Lease name
  col 9   RRC lease number
  col 12  Operator name
  --- date columns exposed by --spud-col / --completion-col overrides ---
  Standard RRC EWA lays date columns between col 13-25. The exact index
  varies with vendor exports; pass --print-columns on a first run to
  eyeball them.

Usage
-----
::

    # Backfill Gonzales, only rows whose spud/completion are currently null
    python3 scripts/backfill_permits_from_ewa.py --county gonzales

    # Backfill Howard, overriding column indices after inspection
    python3 scripts/backfill_permits_from_ewa.py --county howard \\
        --spud-col 15 --completion-col 17

    # Print detected date columns from the first 20 rows and exit
    python3 scripts/backfill_permits_from_ewa.py --county gonzales --print-columns

    # Dry run — show updates without writing
    python3 scripts/backfill_permits_from_ewa.py --county gonzales --dry-run
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import os
import re
import sys
from pathlib import Path
from typing import Any

from supabase import Client, create_client

DEFAULT_EWA_PATH = Path("data/ewa/OG_WELLBORE_EWA_Report_2026-03-03.csv")
DEFAULT_EWA_BUCKET_KEY = "OG_WELLBORE_EWA_Report_2026-03-03.csv"
BUCKET_NAME = "Raw-Data"
PAGE_SIZE = 1000
BATCH_UPDATE = 200

csv.field_size_limit(5_000_000)

# Standard RRC EWA column indices (0-based) for the 2026-03-03 export.
# Override at the command line if a future EWA revision reshuffles them.
DEFAULT_API_COL = 3
DEFAULT_COUNTY_COL = 4
DEFAULT_SPUD_COL = 15         # observed in field on 2026-03-03 export
DEFAULT_COMPLETION_COL = 17   # ditto
PERMIT_EXPIRY_MONTHS = 24


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--county", required=True)
    parser.add_argument("--ewa-path", default=str(DEFAULT_EWA_PATH),
                        help="Local path to the EWA CSV. Falls back to "
                             f"downloading {DEFAULT_EWA_BUCKET_KEY} from the "
                             f"{BUCKET_NAME} bucket.")
    parser.add_argument("--api-col",        type=int, default=DEFAULT_API_COL)
    parser.add_argument("--county-col",     type=int, default=DEFAULT_COUNTY_COL)
    parser.add_argument("--spud-col",       type=int, default=DEFAULT_SPUD_COL)
    parser.add_argument("--completion-col", type=int, default=DEFAULT_COMPLETION_COL)
    parser.add_argument("--print-columns", action="store_true",
                        help="Print the first 20 rows' column values and exit "
                             "so you can pick the right --spud-col / "
                             "--completion-col.")
    parser.add_argument("--only-missing", action="store_true", default=True)
    parser.add_argument("--all", dest="only_missing", action="store_false")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def require_env(name: str, aliases: tuple[str, ...] = ()) -> str:
    value = os.getenv(name)
    if value:
        return value
    for alt in aliases:
        v = os.getenv(alt)
        if v:
            return v
    raise ValueError(f"Missing env: {name}")


def normalize_api(value: Any) -> str | None:
    text = str(value or "").strip().strip('"')
    digits = "".join(c for c in text if c.isdigit())
    if not digits:
        return None
    return digits.lstrip("0") or "0"


def parse_ewa_date(raw: Any) -> str | None:
    """Return ISO 'YYYY-MM-DD' or None. EWA dates land in a mix of
    'YYYY-MM-DD', 'MM/DD/YYYY', and 8-digit 'YYYYMMDD' shapes across
    revisions."""
    text = str(raw or "").strip().strip('"')
    if not text or text.lower() in {"null", "none", "0"}:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%d-%b-%Y"):
        try:
            return dt.datetime.strptime(text[:10] if fmt == "%Y-%m-%d" else text, fmt).date().isoformat()
        except ValueError:
            continue
    if re.fullmatch(r"\d{8}", text):
        try:
            return dt.date(int(text[:4]), int(text[4:6]), int(text[6:8])).isoformat()
        except ValueError:
            return None
    return None


def derive_permit_status(approved: str | None, spud: str | None,
                         completion: str | None, today: dt.date) -> str | None:
    if completion:
        return "completed"
    if spud:
        return "spud"
    if approved:
        try:
            d = dt.date.fromisoformat(approved[:10])
        except ValueError:
            return "approved"
        age_months = (today.year - d.year) * 12 + (today.month - d.month)
        return "expired" if age_months >= PERMIT_EXPIRY_MONTHS else "approved"
    return None


def resolve_ewa_path(args: argparse.Namespace, client: Client) -> Path:
    path = Path(args.ewa_path)
    if path.exists():
        return path
    print(f"local EWA missing at {path}; downloading {BUCKET_NAME}/{DEFAULT_EWA_BUCKET_KEY}...",
          flush=True)
    blob = client.storage.from_(BUCKET_NAME).download(DEFAULT_EWA_BUCKET_KEY)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(blob)
    return path


def print_columns(ewa_path: Path) -> None:
    with ewa_path.open("r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        for i, row in enumerate(reader):
            if i >= 20:
                break
            print(f"row {i}:")
            for j, cell in enumerate(row):
                cell_short = (cell or "").strip().strip('"')[:60]
                print(f"    col {j:>3d}: {cell_short}")
            print()


def build_ewa_index(ewa_path: Path, county_name_upper: str,
                    api_col: int, county_col: int,
                    spud_col: int, completion_col: int) -> dict[str, dict[str, str | None]]:
    """Return api -> {spud_date, completion_date} for one county."""
    lookup: dict[str, dict[str, str | None]] = {}
    scanned = 0
    with ewa_path.open("r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        for row in reader:
            scanned += 1
            if len(row) <= max(api_col, county_col, spud_col, completion_col):
                continue
            county = row[county_col].strip().strip('"').upper()
            if county != county_name_upper:
                continue
            api = normalize_api(row[api_col])
            if not api:
                continue
            spud = parse_ewa_date(row[spud_col])
            completion = parse_ewa_date(row[completion_col])
            if not spud and not completion:
                continue
            existing = lookup.get(api)
            if existing is None:
                lookup[api] = {"spud_date": spud, "completion_date": completion}
            else:
                # Keep the earliest spud + latest completion we see across
                # any wellbore revision rows for the same API.
                if spud and (not existing["spud_date"] or spud < existing["spud_date"]):
                    existing["spud_date"] = spud
                if completion and (not existing["completion_date"] or completion > existing["completion_date"]):
                    existing["completion_date"] = completion
            if scanned % 500_000 == 0:
                print(f"  scanned {scanned:,} rows...", flush=True)
    print(f"  scanned {scanned:,} rows total; matched {len(lookup):,} APIs for {county_name_upper}.")
    return lookup


def paginate_permits(client: Client, table: str, only_missing: bool) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    last_id = 0
    while True:
        query = (
            client.table(table)
            .select("id, api_number, approved_date, spud_date, completion_date, permit_status")
            .gt("id", last_id)
            .order("id", desc=False)
            .limit(PAGE_SIZE)
        )
        if only_missing:
            # Missing spud OR missing completion is worth backfilling.
            query = query.is_("spud_date", None)
        try:
            result = query.execute()
        except Exception as exc:
            message = str(exc).lower()
            if "column" in message and only_missing:
                # Old schema — permit_status/spud_date/completion_date columns
                # aren't there yet. Apply Ticket 1.3 Phase 1A migration first.
                print("permits table is missing spud_date / completion_date columns. "
                      "Apply migration 20260716240000_ticket_1_3_development_tracking.sql first.",
                      file=sys.stderr)
                return []
            if "does not exist" in message:
                return []
            raise
        page = result.data or []
        if not page:
            break
        rows.extend(page)
        last_id = page[-1]["id"]
        if len(page) < PAGE_SIZE:
            break
    return rows


def chunked(rows: list[dict[str, Any]], size: int):
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


def main() -> None:
    args = parse_args()
    county = args.county.strip().lower()
    supabase_url = require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
    supabase_key = require_env("SUPABASE_KEY", ("SUPABASE_SERVICE_ROLE_KEY",))
    client = create_client(supabase_url, supabase_key)

    ewa_path = resolve_ewa_path(args, client)
    print(f"EWA source: {ewa_path}", flush=True)
    if args.print_columns:
        print_columns(ewa_path)
        return

    county_upper = county.upper()
    lookup = build_ewa_index(ewa_path, county_upper,
                             args.api_col, args.county_col,
                             args.spud_col, args.completion_col)

    table = f"{county}_permits"
    permits = paginate_permits(client, table, args.only_missing)
    print(f"{table}: {len(permits):,} rows to consider", flush=True)

    today = dt.date.today()
    updates: list[dict[str, Any]] = []
    for permit in permits:
        api = normalize_api(permit.get("api_number"))
        if not api or api not in lookup:
            continue
        ewa = lookup[api]
        spud = ewa["spud_date"] or permit.get("spud_date")
        completion = ewa["completion_date"] or permit.get("completion_date")
        approved = permit.get("approved_date")
        permit_status = derive_permit_status(str(approved) if approved else None,
                                             spud, completion, today)
        updates.append({
            "id": permit["id"],
            "spud_date": spud,
            "completion_date": completion,
            "permit_status": permit_status,
        })

    print(f"  updates prepared: {len(updates):,}")
    if args.dry_run or not updates:
        for u in updates[:5]:
            print("  ", u)
        return

    n_updated = 0
    for batch in chunked(updates, BATCH_UPDATE):
        for entry in batch:
            row_id = entry.pop("id")
            client.table(table).update(entry).eq("id", row_id).execute()
            n_updated += 1
        print(f"  updated {n_updated}/{len(updates)}", flush=True)
    print(f"done. wrote {n_updated} spud/completion/permit_status updates into {table}.")


if __name__ == "__main__":
    main()
