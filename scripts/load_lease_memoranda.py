#!/usr/bin/env python3
"""Load lease memoranda into public.lease_memoranda from a CSV / XLSX
file (Ticket 1.3 Phase 3).

The Mineral Map "LEASING_ACTIVE" signal (+1 pud_score, and the
LEASING_ACTIVE tract status when nothing stronger applies) is driven
by rows in the lease_memoranda table. This loader is the ingest side
of that pipeline. Each county's actual scrape is county-specific:

    * Gonzales:   https://www.co.gonzales.tx.us/upload/page/... clerk portal
                  or a purchased Landex/CourthouseDirect index
    * Howard:     Howard County Clerk online records
    * Martin:     Martin County Clerk online records
    * (etc.)

Because the recorder-scrape decision is still open (spec §PHASE 3
"gated on the county index decision"), this loader accepts a
pre-fetched CSV / XLSX rather than driving the scrape itself. Any
per-county scraper you build later can dump into the same CSV shape
and this loader picks it up unchanged.

Expected columns (case-insensitive, spaces / underscores equivalent):
    county            (or county_id)
    abstract          (or abstract_number)
    lessor
    lessee
    memo_date         YYYY-MM-DD
    filed_date        YYYY-MM-DD
    bonus_per_acre    numeric
    royalty           numeric (0.20 for 20%)
    primary_term_months
    document_id       clerk instrument / doc number
    source_url        link back to recorder image if available

Usage
-----
::

    # Local CSV
    python3 scripts/load_lease_memoranda.py --county gonzales \
        --input data/gonzales_lease_memos_2026-07.csv

    # From the Raw-Data bucket
    python3 scripts/load_lease_memoranda.py --county gonzales \
        --bucket-key gonzales_lease_memos.csv

    # Dry run
    python3 scripts/load_lease_memoranda.py --county gonzales \
        --input data/gonzales_lease_memos.csv --dry-run
"""

from __future__ import annotations

import argparse
import math
import os
from pathlib import Path
from typing import Any

import pandas as pd
from supabase import Client, create_client

BUCKET_NAME = "Raw-Data"
BATCH_SIZE = 500


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--county", required=True)
    parser.add_argument("--input", help="Local CSV/XLSX path.")
    parser.add_argument("--bucket-key",
                        help=f"Object key inside the {BUCKET_NAME} bucket.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--truncate", action="store_true",
                        help="DELETE existing rows for this county first.")
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


COL_ALIASES: dict[str, tuple[str, ...]] = {
    "county_id":     ("countyid", "county"),
    "abstract_number": ("abstract", "abstractnumber", "abstractno", "abs"),
    "lessor":        ("lessor",),
    "lessee":        ("lessee", "operator"),
    "memo_date":     ("memodate", "leasedate", "date"),
    "filed_date":    ("fileddate", "filingdate", "recordeddate"),
    "bonus_per_acre":("bonusperacre", "bonus", "bpa"),
    "royalty":       ("royalty", "royaltyfraction"),
    "primary_term_months": ("primarytermmonths", "primaryterm", "term"),
    "document_id":   ("documentid", "instrumentno", "instrument", "docno"),
    "source_url":    ("sourceurl", "url", "image"),
}


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip()
    return text or None


def clean_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        n = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if math.isnan(n) or math.isinf(n):
        return None
    return n


def normalize_abstract(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    stripped = text.upper()
    if stripped.startswith("A-"):
        stripped = stripped[2:]
    return stripped.strip() or None


def build_row(record: dict[str, Any], county: str) -> dict[str, Any] | None:
    row: dict[str, Any] = {"county_id": county, "source": "manual"}
    for target, aliases in COL_ALIASES.items():
        for alias in aliases:
            if alias in record and record[alias] not in (None, ""):
                if target == "abstract_number":
                    row[target] = normalize_abstract(record[alias])
                elif target in ("bonus_per_acre", "royalty"):
                    row[target] = clean_number(record[alias])
                elif target == "primary_term_months":
                    n = clean_number(record[alias])
                    row[target] = int(n) if n is not None else None
                else:
                    row[target] = clean_text(record[alias])
                break
    if not row.get("abstract_number"):
        return None
    if county in row.get("abstract_number", ""):
        return None
    row["raw_record"] = record
    return row


def resolve_source(args: argparse.Namespace, county: str, client: Client,
                   data_dir: Path) -> Path:
    if args.input:
        p = Path(args.input)
        if not p.exists():
            raise FileNotFoundError(p)
        return p
    key = args.bucket_key or f"{county}_lease_memoranda.csv"
    print(f"downloading {BUCKET_NAME}/{key}...")
    try:
        blob = client.storage.from_(BUCKET_NAME).download(key)
    except Exception as exc:
        raise FileNotFoundError(f"{key} not in {BUCKET_NAME}: {exc}") from exc
    data_dir.mkdir(parents=True, exist_ok=True)
    out = data_dir / Path(key).name
    out.write_bytes(blob)
    return out


def read_file(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(path, dtype=object)
    else:
        df = pd.read_csv(path, dtype=object, low_memory=False)
    df.columns = [normalize_col(c) for c in df.columns]
    return df


def chunked(rows: list[dict[str, Any]], size: int):
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


def main() -> None:
    args = parse_args()
    county = args.county.strip().lower()

    supabase_url = require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
    supabase_key = require_env("SUPABASE_KEY", ("SUPABASE_SERVICE_ROLE_KEY",))
    client = create_client(supabase_url, supabase_key)

    data_dir = Path(args.data_dir)
    source = resolve_source(args, county, client, data_dir)
    print(f"source: {source}")

    df = read_file(source)
    print(f"columns: {sorted(df.columns.tolist())}")
    rows = [build_row(rec, county) for rec in df.to_dict(orient="records")]
    rows = [r for r in rows if r]
    print(f"prepared {len(rows):,} lease-memo rows")

    if args.dry_run:
        for r in rows[:3]:
            print(" ", r)
        return

    if args.truncate:
        print("truncating existing rows for this county...")
        client.table("lease_memoranda").delete().eq("county_id", county).execute()

    inserted = 0
    for batch in chunked(rows, BATCH_SIZE):
        try:
            client.table("lease_memoranda").insert(batch).execute()
            inserted += len(batch)
        except Exception as exc:
            message = str(exc).lower()
            if "does not exist" in message or "not find" in message:
                print("lease_memoranda table missing — apply the Phase 3 migration first.")
                return
            raise
    print(f"inserted {inserted:,} lease-memo rows into lease_memoranda.")


if __name__ == "__main__":
    main()
