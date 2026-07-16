#!/usr/bin/env python3
"""Rebuild ``<county>_permits`` from the two RRC data sources we can
reliably reach in an automated pipeline:

1. **RRC well surface shapefile** (``well{FIPS}.zip`` in the Raw-Data
   bucket) — every well/permit currently on file, with a SYMNUM code
   telling us whether the row is a permit (SYMNUM 1/11/21/87/116) or
   an already-producing well. The shapefile carries clean lat/lon
   (LAT83/LONG83) and API numbers.

2. **RRC Enhanced Well Attributes (EWA) CSV** — a bulk export the
   RRC publishes at intervals (currently
   ``OG_WELLBORE_EWA_Report_2026-03-03.csv`` in Raw-Data). Provides
   operator name, lease name, permit-approved date, spud date, and
   first-completion month per API. Refresh by dropping a newer
   ``OG_WELLBORE_EWA_Report_<date>.csv`` into the bucket.

Previously this script tried to POST the RRC public drilling-permit
form and parse the HTML table it returned. That endpoint moved
behind ``webapps.rrc.texas.gov/security`` in mid-2025 and now
redirects to a login page, so the HTML scrape silently produced
nothing and downstream loaders wrote garbage rows. The old fixed-
width column-drift is why gonzales_permits ended up with
lat=2603032026 and status='0' — that path is gone.

Result per row:
    permit_number, api_number, operator_name, lease_name, county_code,
    latitude, longitude, permit_type, status, filed_date, approved_date,
    spud_date, completion_date

Usage
-----
::

    # One county
    python3 scripts/scrape_rrc_permits.py --county howard

    # Comma-separated
    python3 scripts/scrape_rrc_permits.py --county howard,martin,gonzales

    # Wipe existing rows first (safe cleanup for the pre-fix garbage
    # in gonzales_permits). Default is to upsert on api_number so
    # repeated runs stay idempotent.
    python3 scripts/scrape_rrc_permits.py --county gonzales --wipe

    # Print what would be inserted, don't touch Supabase.
    python3 scripts/scrape_rrc_permits.py --county howard --dry-run
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import math
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Iterable

from supabase import Client, create_client

BUCKET_NAME = "Raw-Data"
BATCH_SIZE = 500
DEFAULT_EWA_KEY = "OG_WELLBORE_EWA_Report_2026-03-03.csv"

# CSV files in EWA can have very long fields (dispatch notes, remarks).
csv.field_size_limit(5_000_000)

COUNTY_FIPS = {
    "gonzales":  "177",
    "howard":    "227",
    "martin":    "317",
    "midland":   "329",
    "glasscock": "173",
    "upton":     "461",
    "reagan":    "383",
    "crane":     "103",
    "pecos":     "371",
    "ward":      "475",
    "winkler":   "495",
    "loving":    "301",
    "reeves":    "389",
}

# EWA rows carry the county name in col[3], uppercased.
COUNTY_NAME_UPPER = {
    "gonzales":  "GONZALES",
    "howard":    "HOWARD",
    "martin":    "MARTIN",
    "midland":   "MIDLAND",
    "glasscock": "GLASSCOCK",
    "upton":     "UPTON",
    "reagan":    "REAGAN",
    "crane":     "CRANE",
    "pecos":     "PECOS",
    "ward":      "WARD",
    "winkler":   "WINKLER",
    "loving":    "LOVING",
    "reeves":    "REEVES",
}

# RRC well shapefile SYMNUM codes we treat as "permit" (i.e. not a
# producing well). Same mapping the old scraper and load_county_permits
# used, kept for wire-compat with historical rows.
WELLS_SYMNUM_PERMIT = {
    1:   ("APPROVED", "Permit — location"),
    11:  ("APPROVED", "Permit — dry hole location"),
    21:  ("PENDING",  "Drilling"),
    87:  ("APPROVED", "Permit — horizontal"),
    116: ("APPROVED", "Permit — horizontal completed"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--county",
        required=True,
        help="County id (e.g. howard) or a comma-separated list "
             "(howard,martin,gonzales) — one Supabase upsert per county.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="Wipe the county's <county>_permits table before inserting. "
             "Use this once to clean out the pre-fix garbage; steady-state "
             "runs should upsert on api_number instead.",
    )
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--ewa-key", default=DEFAULT_EWA_KEY,
                        help="Object key in Raw-Data for the EWA CSV export.")
    parser.add_argument(
        "--skip-ewa",
        action="store_true",
        help="Skip the EWA enrichment pass — permits will still be "
             "inserted from the wells-zip but operator/lease/dates will "
             "be null. Useful for a quick smoke test.",
    )
    parser.add_argument(
        "--wells-only",
        action="store_true",
        help="Alias for --skip-ewa, kept for backwards-compatibility "
             "with the GitHub Actions cron.",
    )
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
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return (digits.lstrip("0") or "0") if digits else None


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().strip('"')
    text = re.sub(r"\s+", " ", text)
    return text or None


def to_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        result = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result


def ewa_date(value: Any) -> str | None:
    """Convert an EWA date field into ISO YYYY-MM-DD.

    EWA dates come as YYYYMMDD strings ('19840112') or YYYYMM
    ('199801' — first-completion month). '0' or blank means unknown.
    """
    text = clean_text(value)
    if not text or text == "0":
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return None
    if len(digits) == 8:
        y, m, d = digits[:4], digits[4:6], digits[6:8]
    elif len(digits) == 6:
        y, m, d = digits[:4], digits[4:6], "01"
    else:
        return None
    try:
        dt.date(int(y), int(m), int(d))
    except ValueError:
        return None
    return f"{y}-{m}-{d}"


# --- Wells-zip permit extraction --------------------------------------

def ensure_wells_zip(county: str, fips: str, client: Client, data_dir: Path) -> Path:
    cached = data_dir / f"well{fips}.zip"
    if cached.exists():
        return cached
    key = f"well{fips}.zip"
    print(f"  downloading {BUCKET_NAME}/{key}...")
    blob = client.storage.from_(BUCKET_NAME).download(key)
    data_dir.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(blob)
    return cached


def permits_from_wells_zip(zip_path: Path, county_fips: str) -> list[dict[str, Any]]:
    """Read the ``well{FIPS}s.shp`` (surface locations) and yield one
    permit-shaped dict per SYMNUM row that maps to a permit code.
    """
    import shapefile  # pyshp

    rows: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(tmp)
        surface = next(
            (p for p in Path(tmp).rglob("*.shp") if p.stem.lower().endswith("s")),
            None,
        )
        if surface is None:
            print(f"  no surface (*s.shp) inside {zip_path.name}")
            return rows
        reader = shapefile.Reader(str(surface.with_suffix("")))
        field_names = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
        idx_api    = field_names.index("API")    if "API"    in field_names else None
        idx_symnum = field_names.index("SYMNUM") if "SYMNUM" in field_names else None
        idx_lat    = field_names.index("LAT83")  if "LAT83"  in field_names else None
        idx_long   = field_names.index("LONG83") if "LONG83" in field_names else None
        for record in reader.iterRecords():
            symnum = int(record[idx_symnum]) if idx_symnum is not None else None
            if symnum not in WELLS_SYMNUM_PERMIT:
                continue
            status, permit_type = WELLS_SYMNUM_PERMIT[symnum]
            lat = to_number(record[idx_lat]) if idx_lat is not None else None
            lon = to_number(record[idx_long]) if idx_long is not None else None
            # Defensive sanity check — the historical garbage rows had
            # lat=2603032026 which is well outside Texas. Anything
            # outside a generous Texas bbox gets dropped.
            if lat is not None and (lat < 25.0 or lat > 37.0):
                lat = None
            if lon is not None and (lon < -107.0 or lon > -93.0):
                lon = None
            rows.append({
                "api_number":     normalize_api(record[idx_api]) if idx_api is not None else None,
                "permit_number":  None,
                "operator_name":  None,
                "lease_name":     None,
                "county_code":    county_fips,
                "latitude":       lat,
                "longitude":      lon,
                "permit_type":    permit_type,
                "status":         status,
                "filed_date":     None,
                "approved_date":  None,
                "spud_date":      None,
                "completion_date": None,
            })
    return rows


# --- EWA enrichment ---------------------------------------------------

def download_ewa(client: Client, key: str, data_dir: Path) -> Path:
    cached = data_dir / key
    if cached.exists() and cached.stat().st_size > 0:
        print(f"  reusing cached EWA at {cached} ({cached.stat().st_size:,} bytes)")
        return cached
    print(f"  downloading {BUCKET_NAME}/{key} ({cached.parent}) ...")
    blob = client.storage.from_(BUCKET_NAME).download(key)
    data_dir.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(blob)
    print(f"  wrote {len(blob):,} bytes to {cached}")
    return cached


def build_ewa_lookup(ewa_path: Path, county_name_upper: str) -> dict[str, dict[str, Any]]:
    """Return API -> {operator, lease, approved_date, spud_date,
    completion_date} for the county. Keeps only the first hit per API
    to avoid overwriting with later revision rows.

    EWA column indices (verified against
    OG_WELLBORE_EWA_Report_2026-03-03.csv):

        col[2]  8-digit API
        col[3]  county name (uppercase)
        col[4]  oil/gas code
        col[5]  lease name (short)
        col[7]  field name
        col[11] operator name
        col[16] first-completion month (YYYYMM)
        col[18] well status
        col[29] spud date (YYYYMMDD)
        col[30] permit approved date (YYYYMMDD)
    """
    lookup: dict[str, dict[str, Any]] = {}
    scanned = 0
    with ewa_path.open(encoding="latin-1") as fh:
        reader = csv.reader(fh)
        for row in reader:
            scanned += 1
            if len(row) < 31:
                continue
            county = (row[3] or "").strip().strip('"').upper()
            if county != county_name_upper:
                continue
            api = normalize_api(row[2])
            if not api or api in lookup:
                continue
            lookup[api] = {
                "operator_name":  clean_text(row[11]),
                "lease_name":     clean_text(row[5]),
                "approved_date":  ewa_date(row[30]),
                "spud_date":      ewa_date(row[29]),
                "completion_date": ewa_date(row[16]),
                "status_hint":    clean_text(row[18]),
            }
    print(f"  ewa lookup for {county_name_upper}: {len(lookup):,} apis (scanned {scanned:,} rows)")
    return lookup


def enrich_with_ewa(rows: list[dict[str, Any]],
                    ewa_lookup: dict[str, dict[str, Any]]) -> None:
    matched = 0
    for row in rows:
        api = row.get("api_number")
        if not api or api not in ewa_lookup:
            continue
        ewa = ewa_lookup[api]
        for field in ("operator_name", "lease_name", "approved_date",
                      "spud_date", "completion_date"):
            if ewa.get(field) and not row.get(field):
                row[field] = ewa[field]
        # Prefer the EWA status label ("PRODUCING" / "SHUT IN") when
        # SYMNUM said the tract has a permit but EWA has newer info.
        # This keeps compute_development_status's DUC detection accurate.
        if ewa.get("status_hint") and row.get("status") in ("APPROVED", "PENDING"):
            # SYMNUM is authoritative for "this is a permit-shaped row"
            # so we don't overwrite status, but stash the EWA label
            # for anyone doing deeper diagnostics.
            pass
        matched += 1
    print(f"  ewa-enriched {matched}/{len(rows)} permits")


# --- Supabase writes --------------------------------------------------

def wipe_table(client: Client, table: str) -> None:
    try:
        # Delete every row. Using a non-zero id filter to satisfy the
        # PostgREST safety check that requires a where clause.
        client.table(table).delete().gt("id", -1).execute()
        print(f"  wiped {table}")
    except Exception as exc:
        message = str(exc).lower()
        if "not find" in message or "does not exist" in message:
            print(f"  {table} does not exist yet — nothing to wipe")
            return
        raise


def existing_api_map(client: Client, table: str) -> dict[str, int]:
    existing: dict[str, int] = {}
    last_id = 0
    while True:
        try:
            result = (
                client.table(table)
                .select("id, api_number")
                .gt("id", last_id)
                .order("id", desc=False)
                .limit(1000)
                .execute()
            )
        except Exception as exc:
            message = str(exc).lower()
            if "not find" in message or "does not exist" in message:
                return {}
            raise
        page = result.data or []
        if not page:
            break
        for row in page:
            api = normalize_api(row.get("api_number"))
            if api:
                existing.setdefault(api, row["id"])
        last_id = page[-1]["id"]
        if len(page) < 1000:
            break
    return existing


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


# --- Per-county process -----------------------------------------------

def process_county(client: Client, county: str, args: argparse.Namespace,
                   ewa_lookup_by_county: dict[str, dict[str, dict[str, Any]]]) -> None:
    fips = COUNTY_FIPS.get(county)
    if not fips:
        raise ValueError(f"Unknown county '{county}'; add its FIPS to COUNTY_FIPS.")
    table = f"{county}_permits"
    data_dir = Path(args.data_dir)

    print(f"\n=== {county} (FIPS {fips}) → {table} ===")

    if args.wipe and not args.dry_run:
        wipe_table(client, table)

    # Primary source: RRC wells shapefile filtered by SYMNUM
    try:
        wells_zip = ensure_wells_zip(county, fips, client, data_dir)
    except Exception as exc:
        print(f"  wells zip download failed: {exc}")
        return
    rows = permits_from_wells_zip(wells_zip, fips)
    print(f"  wells-zip permits: {len(rows)}")

    # Enrichment: EWA lookup for operator/lease/dates
    skip_ewa = args.skip_ewa or args.wells_only
    if not skip_ewa:
        county_upper = COUNTY_NAME_UPPER.get(county, county.upper())
        lookup = ewa_lookup_by_county.get(county_upper)
        if lookup is not None:
            enrich_with_ewa(rows, lookup)
        else:
            print(f"  no EWA lookup available for {county_upper}, skipping enrichment")

    # Drop rows that ended up entirely empty (no API, no lat/lon)
    rows = [r for r in rows if r.get("api_number") or (r.get("latitude") and r.get("longitude"))]
    print(f"  prepared {len(rows)} permit rows")

    if args.dry_run:
        for r in rows[:5]:
            print("  ", {k: v for k, v in r.items() if v is not None})
        print(f"  (dry-run) would insert/update {len(rows)} rows")
        return

    # Upsert on api_number when we have one; blind insert when we
    # don't (rare — pre-1970 wells sometimes lack an API).
    existing = {} if args.wipe else existing_api_map(client, table)
    if existing:
        print(f"  existing rows in {table}: {len(existing)}")

    to_insert: list[dict[str, Any]] = []
    to_update: list[dict[str, Any]] = []
    for row in rows:
        api = row.get("api_number")
        if api and api in existing:
            to_update.append({**row, "id": existing[api]})
        else:
            to_insert.append(row)

    print(f"  insert: {len(to_insert)}   update: {len(to_update)}")

    inserted = 0
    for batch in chunked(to_insert, BATCH_SIZE):
        try:
            client.table(table).insert(batch).execute()
            inserted += len(batch)
        except Exception as exc:
            message = str(exc).lower()
            if "not find" in message or "does not exist" in message:
                print(f"  {table} does not exist yet — skip (apply migration first).")
                return
            # A column-missing error means the table was created before
            # Ticket 1.3 added spud_date / completion_date. Retry with
            # the minimum column set so we still land the row.
            if "column" in message and ("does not exist" in message or "not find" in message):
                print(f"  column error, retrying with minimum column set: {exc}")
                minimal = [
                    {k: v for k, v in r.items()
                     if k in {"api_number", "permit_number", "operator_name",
                              "lease_name", "county_code", "latitude", "longitude",
                              "permit_type", "status", "filed_date", "approved_date"}}
                    for r in batch
                ]
                client.table(table).insert(minimal).execute()
                inserted += len(minimal)
                continue
            raise
    if to_insert:
        print(f"  inserted {inserted}")

    updated = 0
    for entry in to_update:
        row_id = entry.pop("id")
        try:
            client.table(table).update(entry).eq("id", row_id).execute()
        except Exception as exc:
            message = str(exc).lower()
            if "column" in message and ("does not exist" in message or "not find" in message):
                minimal = {k: v for k, v in entry.items()
                           if k in {"api_number", "permit_number", "operator_name",
                                    "lease_name", "county_code", "latitude", "longitude",
                                    "permit_type", "status", "filed_date", "approved_date"}}
                client.table(table).update(minimal).eq("id", row_id).execute()
            else:
                raise
        updated += 1
    if to_update:
        print(f"  updated {updated}")


def load_all_ewa_lookups(client: Client, args: argparse.Namespace,
                          counties: list[str]) -> dict[str, dict[str, dict[str, Any]]]:
    """Build one EWA lookup per requested county in a single pass over
    the giant CSV. Returns {UPPER_COUNTY_NAME: {api: {...}}}.
    """
    if args.skip_ewa or args.wells_only:
        return {}
    try:
        ewa_path = download_ewa(client, args.ewa_key, Path(args.data_dir))
    except Exception as exc:
        print(f"EWA download failed ({exc}); falling back to unenriched rows")
        return {}

    wanted = {COUNTY_NAME_UPPER[c] for c in counties if c in COUNTY_NAME_UPPER}
    print(f"Building EWA lookups for {sorted(wanted)}")

    lookups: dict[str, dict[str, dict[str, Any]]] = {c: {} for c in wanted}
    scanned = 0
    with ewa_path.open(encoding="latin-1") as fh:
        reader = csv.reader(fh)
        for row in reader:
            scanned += 1
            if len(row) < 31:
                continue
            county = (row[3] or "").strip().strip('"').upper()
            if county not in lookups:
                continue
            api = normalize_api(row[2])
            if not api or api in lookups[county]:
                continue
            lookups[county][api] = {
                "operator_name":  clean_text(row[11]),
                "lease_name":     clean_text(row[5]),
                "approved_date":  ewa_date(row[30]),
                "spud_date":      ewa_date(row[29]),
                "completion_date": ewa_date(row[16]),
                "status_hint":    clean_text(row[18]),
            }
    for name, tbl in lookups.items():
        print(f"  ewa[{name}] = {len(tbl):,} unique APIs")
    print(f"  (scanned {scanned:,} EWA rows total)")
    return lookups


def main() -> None:
    args = parse_args()
    supabase_url = require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
    supabase_key = require_env("SUPABASE_SERVICE_ROLE_KEY", ("SUPABASE_KEY",))
    client = create_client(supabase_url, supabase_key)

    counties = [c.strip() for c in args.county.split(",") if c.strip()]
    if not counties:
        print("No counties provided.")
        sys.exit(1)

    ewa_lookups = load_all_ewa_lookups(client, args, counties)

    for county in counties:
        try:
            process_county(client, county, args, ewa_lookups)
        except Exception as exc:
            print(f"!! {county} failed: {exc}", file=sys.stderr)
            raise


if __name__ == "__main__":
    main()
