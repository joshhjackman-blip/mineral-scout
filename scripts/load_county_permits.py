#!/usr/bin/env python3
"""Load a county's drilling permits / recent completions into
``<county>_permits`` from a CSV or XLSX dropped in the ``Raw-Data``
Supabase bucket (or a local path).

Where to get the source file
----------------------------
The RRC publishes drilling-permit data through multiple channels; any of
these can produce a CSV this loader accepts:

* **RRC Public Drilling Permits Query** —
  https://webapps.rrc.texas.gov/DP/publicSearchAction.do
  Filter by county code (Howard=227, Martin=317) and export to CSV.
  Gives you: permit number, API, operator, lease, filed date, approved
  date, purpose, wellbore profile, permit status.

* **Texas Open Data Portal** —
  https://data.texas.gov  (search "drilling permit")
  Bulk CSV of every filed permit, county-taggable.

* **Enverus / DrillingInfo / RigData API** — same fields, richer status.

* **The RRC wells surface shapefile you already have in the bucket**
  (``well{FIPS}.zip``) — no ``filed_date`` or ``permit_number`` but does
  carry SYMNUM (well status code); pass ``--from-wells-zip`` and the
  loader will synthesize permit rows for recently permitted wells.

Column mapping
--------------
The loader accepts many upstream column-name variants; the key columns
are (case-insensitive, spaces and underscores are equivalent):

* API / API_NUMBER / API14 / API_NO           -> api_number
* PERMIT / PERMIT_NUMBER / PERMIT_NO          -> permit_number
* OPERATOR / OPERATOR_NAME                    -> operator_name
* LEASE / LEASE_NAME / WELL_NAME              -> lease_name
* COUNTY / COUNTY_CODE / FIPS                 -> county_code
* LATITUDE / LAT / LAT83 / SURFACE_LATITUDE   -> latitude
* LONGITUDE / LON / LONG / LONG83 / SURFACE_LONGITUDE -> longitude
* PERMIT_TYPE / PURPOSE / RECORD_TYPE         -> permit_type
* STATUS / PERMIT_STATUS / WELL_STATUS        -> status
* FILED_DATE / FILE_DATE / DATE_FILED         -> filed_date
* APPROVED_DATE / APPROVAL_DATE / ISSUED_DATE -> approved_date

Any column outside that set is ignored.

Usage
-----
::

    # From the Raw-Data bucket (default: <county>_permits_<yyyy-mm>.csv)
    python3 scripts/load_county_permits.py --county howard

    # Specific bucket key
    python3 scripts/load_county_permits.py --county howard \\
        --bucket-key howard_permits_2026-07-15.csv

    # Local CSV
    python3 scripts/load_county_permits.py --county martin \\
        --input data/martin_permits.csv

    # From the RRC wells surface shapefile you already have in the bucket
    # (produces rows for "location-only" wells — SYMNUM 1, 11, 21, 87)
    python3 scripts/load_county_permits.py --county howard \\
        --from-wells-zip

The loader dedups on ``api_number``: rows whose ``api_number`` already
exists in the target table are UPDATEd rather than duplicated. Rows
without an ``api_number`` are always inserted.
"""

from __future__ import annotations

import argparse
import io
import math
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
from supabase import Client, create_client

BUCKET_NAME = "Raw-Data"
BATCH_SIZE = 500

COUNTY_FIPS = {
    "gonzales": "177",
    "howard":   "227",
    "martin":   "317",
}

# RRC SYMNUM codes we treat as "permit / not producing" when materializing
# permits directly from the well surface shapefile. The full RRC symbol
# table is longer, but these are the codes that map cleanly to the
# new_permit / pending_permit buckets used elsewhere in the app.
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
    parser.add_argument("--county", required=True, help="County id, e.g. howard")
    parser.add_argument("--fips", help="County FIPS code (defaults per county).")
    parser.add_argument(
        "--bucket-key",
        help=f"Object key inside the {BUCKET_NAME} bucket. "
             "Defaults to <county>_permits.csv, then .xlsx.",
    )
    parser.add_argument(
        "--input",
        help="Local path to the permit file (bypasses the bucket).",
    )
    parser.add_argument(
        "--from-wells-zip",
        action="store_true",
        help="Synthesize permits from the RRC well surface shapefile you "
             "already have in the bucket at well{FIPS}.zip. Uses SYMNUM to "
             "identify permitted / drilling / non-producing wells.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--truncate", action="store_true",
        help="DELETE existing rows before inserting.",
    )
    parser.add_argument("--data-dir", default="data")
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


def normalize_col(name: str) -> str:
    return "".join(ch.lower() for ch in str(name) if ch.isalnum())


COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "api_number":     ("api", "apinumber", "api14", "apino"),
    "permit_number":  ("permit", "permitnumber", "permitno"),
    "operator_name":  ("operator", "operatorname"),
    "lease_name":     ("lease", "leasename", "wellname", "well"),
    "county_code":    ("county", "countycode", "fips"),
    "latitude":       ("latitude", "lat", "lat83", "surfacelatitude"),
    "longitude":      ("longitude", "lon", "long", "long83", "surfacelongitude"),
    "permit_type":    ("permittype", "purpose", "recordtype"),
    "status":         ("status", "permitstatus", "wellstatus"),
    "filed_date":     ("fileddate", "filedate", "datefiled"),
    "approved_date":  ("approveddate", "approvaldate", "issueddate"),
}


def to_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip()
    return text or None


def to_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result


def normalize_api(value: Any) -> str | None:
    text = to_text(value)
    if not text:
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    return (digits.lstrip("0") or "0") if digits else None


def build_row(record: dict[str, Any], county_fips: str) -> dict[str, Any]:
    row: dict[str, Any] = {
        "api_number":    None,
        "permit_number": None,
        "operator_name": None,
        "lease_name":    None,
        "county_code":   county_fips,
        "latitude":      None,
        "longitude":     None,
        "permit_type":   None,
        "status":        None,
        "filed_date":    None,
        "approved_date": None,
    }
    for target, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in record and record[alias] not in (None, ""):
                if target in ("latitude", "longitude"):
                    row[target] = to_number(record[alias])
                elif target == "api_number":
                    row[target] = normalize_api(record[alias])
                else:
                    row[target] = to_text(record[alias])
                break
    return row


def read_permit_file(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(path, dtype=object)
    else:
        df = pd.read_csv(path, dtype=object, low_memory=False, index_col=False)
    df.columns = [normalize_col(c) for c in df.columns]
    return df


def resolve_source(args: argparse.Namespace, county: str, fips: str,
                   client: Client, data_dir: Path) -> Path:
    if args.input:
        p = Path(args.input)
        if not p.exists():
            raise FileNotFoundError(p)
        return p

    if args.from_wells_zip:
        # Bucket key wellNNN.zip — same file scripts/add_production_status.py
        # uses. If already cached locally, reuse it.
        cached = data_dir / f"well{fips}.zip"
        if cached.exists():
            return cached
        key = f"well{fips}.zip"
        print(f"downloading {BUCKET_NAME}/{key}...")
        blob = client.storage.from_(BUCKET_NAME).download(key)
        data_dir.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(blob)
        return cached

    keys_to_try = [args.bucket_key] if args.bucket_key else [
        f"{county}_permits.csv",
        f"{county}_permits.xlsx",
        f"{county.title()}_permits.csv",
        f"{county.title()}_permits.xlsx",
    ]
    for key in keys_to_try:
        if not key:
            continue
        try:
            print(f"trying {BUCKET_NAME}/{key}...")
            blob = client.storage.from_(BUCKET_NAME).download(key)
        except Exception as exc:
            print(f"  {exc}")
            continue
        data_dir.mkdir(parents=True, exist_ok=True)
        # Preserve extension so read_permit_file picks the right parser.
        out = data_dir / Path(key).name
        out.write_bytes(blob)
        return out
    raise FileNotFoundError(
        f"No permit source found in bucket for {county}. Tried keys: {keys_to_try}. "
        f"Drop a file at {BUCKET_NAME}/{county}_permits.csv or pass --input / --bucket-key."
    )


def rows_from_wells_zip(zip_path: Path, county_fips: str) -> Iterable[dict[str, Any]]:
    import shapefile  # pyshp
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(tmp)
        surface = next(
            (p for p in Path(tmp).rglob("*.shp") if p.stem.lower().endswith("s")),
            None,
        )
        if surface is None:
            raise FileNotFoundError(f"No surface shapefile inside {zip_path}")
        reader = shapefile.Reader(str(surface.with_suffix("")))
        field_names = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
        idx_api = field_names.index("API") if "API" in field_names else None
        idx_symnum = field_names.index("SYMNUM") if "SYMNUM" in field_names else None
        idx_lat = field_names.index("LAT83") if "LAT83" in field_names else None
        idx_long = field_names.index("LONG83") if "LONG83" in field_names else None
        for record in reader.iterRecords():
            symnum = int(record[idx_symnum]) if idx_symnum is not None else None
            if symnum not in WELLS_SYMNUM_PERMIT:
                continue
            status, permit_type = WELLS_SYMNUM_PERMIT[symnum]
            yield {
                "api_number":    normalize_api(record[idx_api]) if idx_api is not None else None,
                "permit_number": None,
                "operator_name": None,
                "lease_name":    None,
                "county_code":   county_fips,
                "latitude":      to_number(record[idx_lat]) if idx_lat is not None else None,
                "longitude":     to_number(record[idx_long]) if idx_long is not None else None,
                "permit_type":   permit_type,
                "status":        status,
                "filed_date":    None,
                "approved_date": None,
            }


def existing_api_map(client: Client, table: str) -> dict[str, int]:
    existing: dict[str, int] = {}
    last_id = 0
    while True:
        result = (
            client.table(table)
            .select("id, api_number")
            .gt("id", last_id)
            .order("id", desc=False)
            .limit(1000)
            .execute()
        )
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


def main() -> None:
    args = parse_args()
    county = args.county.strip().lower()
    fips = args.fips or COUNTY_FIPS.get(county)
    if not fips:
        raise ValueError(f"Unknown county '{county}'; pass --fips.")
    table = f"{county}_permits"

    supabase_url = require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
    supabase_key = require_env("SUPABASE_KEY", ("SUPABASE_SERVICE_ROLE_KEY",))
    client = create_client(supabase_url, supabase_key)

    data_dir = Path(args.data_dir)
    source = resolve_source(args, county, fips, client, data_dir)
    print(f"source: {source}")

    if args.from_wells_zip:
        rows = list(rows_from_wells_zip(source, fips))
    else:
        df = read_permit_file(source)
        print(f"columns after normalization: {sorted(df.columns.tolist())}")
        rows = [build_row(rec, fips) for rec in df.to_dict(orient="records")]

    # Drop rows where every meaningful field is empty.
    rows = [r for r in rows if any(v for k, v in r.items() if k != "county_code")]
    print(f"prepared {len(rows):,} permit rows")

    if args.dry_run:
        print("dry-run — first 3 rows:")
        for r in rows[:3]:
            print(" ", r)
        return

    if args.truncate:
        print(f"truncating {table}...")
        client.table(table).delete().gt("id", 0).execute()

    existing = existing_api_map(client, table)
    print(f"existing rows in {table}: {len(existing):,}")

    to_insert: list[dict[str, Any]] = []
    to_update: list[dict[str, Any]] = []
    for row in rows:
        api = row.get("api_number")
        if api and api in existing:
            to_update.append({**row, "id": existing[api]})
        else:
            to_insert.append(row)

    print(f"insert: {len(to_insert):,}   update: {len(to_update):,}")

    inserted = 0
    for batch in chunked(to_insert, BATCH_SIZE):
        client.table(table).insert(batch).execute()
        inserted += len(batch)
        print(f"  inserted {inserted:,}/{len(to_insert):,}")

    updated = 0
    for entry in to_update:
        row_id = entry.pop("id")
        client.table(table).update(entry).eq("id", row_id).execute()
        updated += 1
        if updated % 200 == 0 or updated == len(to_update):
            print(f"  updated {updated:,}/{len(to_update):,}")

    print(f"done — {inserted:,} inserted, {updated:,} updated into {table}.")


if __name__ == "__main__":
    main()
