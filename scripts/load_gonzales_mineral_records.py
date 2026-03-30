#!/usr/bin/env python3
"""Load Gonzales County mineral ownership CSV records into Supabase."""

from __future__ import annotations

import argparse
import math
import os
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pandas as pd

TABLE_NAME = "gonzales_mineral_ownership"

MINERAL_SKIPROWS = 2
MINERAL_HEADER_ROW = 1

REQUIRED_COLUMNS = [
    "County Lease ID",
    "County Lease Name",
    "Field Name",
    "Operator Name",
    "Tax Year",
    "CAD Account Number",
    "CAD Property Type",
    "SPTB Code",
    "Exemptions",
    "Acreage",
    "County District ID",
    "RRC Oil and Gas Code",
    "RRC Lease ID",
    "First Date",
    "Last Date",
    "Prod Cumulative Sum Gas",
    "Prod Cumulative Sum Oil",
    "First 6 Month Gas",
    "First 6 Month Oil",
    "First 12 Month Gas",
    "First 12 Month Oil",
    "First 24 Month Gas",
    "First 24 Month Oil",
    "First 60 Month Gas",
    "First 60 Month Oil",
]

NAMES_REQUIRED_COLUMNS = [
    "Owner Name",
    "Address 1",
    "Address 2",
    "City",
    "State",
    "Zip",
    "Country",
]

DEFAULT_OWNER_NAME_CANDIDATES = [
    "Owner 1 Type.1",
    "Owner Name",
    "Mineral Owner Name",
    "Property Owner",
    "Owner",
]
DEFAULT_MAILING_ADDRESS_CANDIDATES = [
    "Mailing Address",
    "Owner Mailing Address",
    "Address",
]
DEFAULT_MAILING_CITY_CANDIDATES = [
    "Mailing City",
    "Owner Mailing City",
    "City",
]
DEFAULT_MAILING_STATE_CANDIDATES = [
    "Mailing State",
    "Owner Mailing State",
    "State",
]
DEFAULT_MAILING_ZIP_CANDIDATES = [
    "Mailing Zip",
    "Mailing ZIP",
    "Owner Mailing Zip",
    "Zip",
    "ZIP",
]
DEFAULT_APPRAISED_VALUE_CANDIDATES = [
    "Value Appraised",
    "Appraised Value",
    "Total Appraised Value",
    "Net Appraised Value",
    "Assessed Value",
    "Market Value",
]


def normalize_header(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def normalize_owner_name(value: str | None) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", value.strip()).upper()


def is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return bool(pd.isna(value))


def clean_str(value: Any) -> str | None:
    if is_missing(value):
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned if cleaned else None
    cleaned = str(value).strip()
    return cleaned if cleaned else None


def parse_int(value: Any) -> int | None:
    cleaned = clean_str(value)
    if cleaned is None:
        return None
    cleaned = cleaned.replace(",", "")
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def parse_decimal(value: Any) -> float | None:
    cleaned = clean_str(value)
    if cleaned is None:
        return None
    normalized = cleaned.replace(",", "").replace("$", "")
    if normalized.startswith("(") and normalized.endswith(")"):
        normalized = f"-{normalized[1:-1]}"
    try:
        return float(Decimal(normalized))
    except (InvalidOperation, ValueError):
        return None


def parse_date(value: Any) -> date | None:
    cleaned = clean_str(value)
    if cleaned is None:
        return None

    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue

    for fmt in ("%Y-%m",):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue

    return None


def pick_column(
    headers: list[str],
    explicit_name: str | None,
    candidates: list[str],
) -> str | None:
    by_normalized = {normalize_header(h): h for h in headers}
    if explicit_name:
        return by_normalized.get(normalize_header(explicit_name))
    for candidate in candidates:
        match = by_normalized.get(normalize_header(candidate))
        if match:
            return match
    return None


def require_env_or_arg(value: str | None, env_name: str) -> str:
    resolved = value or os.getenv(env_name)
    if not resolved:
        raise ValueError(f"Missing value. Pass argument or set {env_name}.")
    return resolved


def read_mineral_roll(csv_path: Path) -> tuple[list[str], list[dict[str, Any]]]:
    header_df = pd.read_csv(csv_path, skiprows=MINERAL_HEADER_ROW, nrows=0)
    headers = [str(col).strip() for col in header_df.columns]

    # The mineral roll has two lines before data; the second line contains the labels.
    df = pd.read_csv(
        csv_path,
        skiprows=MINERAL_SKIPROWS,
        header=None,
        names=headers,
        low_memory=False,
    )
    records = df.to_dict(orient="records")
    return headers, records


def load_names_lookup(names_path: Path) -> dict[str, dict[str, str]]:
    if not names_path.exists():
        raise FileNotFoundError(f"Names file not found: {names_path}")

    names_df = pd.read_csv(names_path, dtype=str, low_memory=False)
    missing = [col for col in NAMES_REQUIRED_COLUMNS if col not in names_df.columns]
    if missing:
        raise ValueError("Names file missing required columns: " + ", ".join(missing))

    names_lookup: dict[str, dict[str, str]] = {}
    for record in names_df.to_dict(orient="records"):
        owner_key = normalize_owner_name(clean_str(record.get("Owner Name")))
        if not owner_key:
            continue

        if owner_key in names_lookup:
            continue

        names_lookup[owner_key] = {
            "owner_name": clean_str(record.get("Owner Name")) or "",
            "address_1": clean_str(record.get("Address 1")) or "",
            "address_2": clean_str(record.get("Address 2")) or "",
            "city": clean_str(record.get("City")) or "",
            "state": clean_str(record.get("State")) or "",
            "zip": clean_str(record.get("Zip")) or "",
            "country": clean_str(record.get("Country")) or "",
        }

    return names_lookup


def build_row_payload(
    row: dict[str, Any],
    source_file: str,
    owner_name_col: str | None,
    mailing_address_col: str | None,
    mailing_city_col: str | None,
    mailing_state_col: str | None,
    mailing_zip_col: str | None,
    appraised_value_col: str | None,
    names_lookup: dict[str, dict[str, str]] | None,
) -> tuple[dict[str, Any], bool]:
    owner_name_value = clean_str(row.get(owner_name_col)) if owner_name_col else None
    names_match_used = False
    names_match: dict[str, str] | None = None
    if names_lookup and owner_name_value:
        names_match = names_lookup.get(normalize_owner_name(owner_name_value))
        names_match_used = names_match is not None

    if names_match:
        mailing_address_parts = [names_match["address_1"], names_match["address_2"]]
        mailing_address = ", ".join(part for part in mailing_address_parts if part) or None
        mailing_city = names_match["city"] or None
        mailing_state = names_match["state"] or None
        mailing_zip = names_match["zip"] or None
        owner_name = names_match["owner_name"] or owner_name_value
    else:
        mailing_address = (
            clean_str(row.get(mailing_address_col)) if mailing_address_col else None
        )
        mailing_city = clean_str(row.get(mailing_city_col)) if mailing_city_col else None
        mailing_state = (
            clean_str(row.get(mailing_state_col)) if mailing_state_col else None
        )
        mailing_zip = clean_str(row.get(mailing_zip_col)) if mailing_zip_col else None
        owner_name = owner_name_value

    first_date = parse_date(row.get("First Date"))
    last_date = parse_date(row.get("Last Date"))
    payload: dict[str, Any] = {
        "county": "Gonzales",
        "county_lease_id": clean_str(row.get("County Lease ID")),
        "county_lease_name": clean_str(row.get("County Lease Name")),
        "field_name": clean_str(row.get("Field Name")),
        "operator_name": clean_str(row.get("Operator Name")),
        "tax_year": parse_int(row.get("Tax Year")),
        "cad_account_number": clean_str(row.get("CAD Account Number")),
        "cad_property_type": clean_str(row.get("CAD Property Type")),
        "sptb_code": clean_str(row.get("SPTB Code")),
        "exemptions": clean_str(row.get("Exemptions")),
        "acreage": parse_decimal(row.get("Acreage")),
        "county_district_id": clean_str(row.get("County District ID")),
        "rrc_oil_and_gas_code": clean_str(row.get("RRC Oil and Gas Code")),
        "rrc_lease_id": clean_str(row.get("RRC Lease ID")),
        "first_date": first_date.isoformat() if first_date else None,
        "last_date": last_date.isoformat() if last_date else None,
        "prod_cumulative_sum_gas": parse_decimal(row.get("Prod Cumulative Sum Gas")),
        "prod_cumulative_sum_oil": parse_decimal(row.get("Prod Cumulative Sum Oil")),
        "first_6_month_gas": parse_decimal(row.get("First 6 Month Gas")),
        "first_6_month_oil": parse_decimal(row.get("First 6 Month Oil")),
        "first_12_month_gas": parse_decimal(row.get("First 12 Month Gas")),
        "first_12_month_oil": parse_decimal(row.get("First 12 Month Oil")),
        "first_24_month_gas": parse_decimal(row.get("First 24 Month Gas")),
        "first_24_month_oil": parse_decimal(row.get("First 24 Month Oil")),
        "first_60_month_gas": parse_decimal(row.get("First 60 Month Gas")),
        "first_60_month_oil": parse_decimal(row.get("First 60 Month Oil")),
        "owner_name": owner_name,
        "mailing_address": mailing_address,
        "mailing_city": mailing_city,
        "mailing_state": mailing_state,
        "mailing_zip": mailing_zip,
        "appraised_value": parse_decimal(row.get(appraised_value_col))
        if appraised_value_col
        else None,
        "source_file": source_file,
        "raw_record": row,
    }

    missing_required = [
        field
        for field in ("county_lease_id", "cad_account_number", "tax_year")
        if payload[field] in (None, "")
    ]
    if missing_required:
        joined = ", ".join(missing_required)
        raise ValueError(f"Record missing required unique-key fields: {joined}")

    return payload, names_match_used


def chunked(records: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [records[i : i + size] for i in range(0, len(records), size)]


def run() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Load Gonzales County mineral ownership CSV into Supabase with "
            "out_of_state and likely_motivated flags."
        )
    )
    parser.add_argument("--csv-path", required=True, help="Path to source CSV file.")
    parser.add_argument("--supabase-url", help="Supabase URL. Defaults to env var.")
    parser.add_argument("--supabase-key", help="Service role key. Defaults to env var.")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true", help="Parse only, do not write.")
    parser.add_argument(
        "--names-path",
        help=(
            "Optional path to names CSV for owner mailing join "
            "(Owner Name -> Address/City/State/Zip)."
        ),
    )

    parser.add_argument("--owner-name-column", help="Explicit owner-name column.")
    parser.add_argument("--mailing-address-column", help="Explicit mailing-address column.")
    parser.add_argument("--mailing-city-column", help="Explicit mailing-city column.")
    parser.add_argument("--mailing-state-column", help="Explicit mailing-state column.")
    parser.add_argument("--mailing-zip-column", help="Explicit mailing-zip column.")
    parser.add_argument("--appraised-value-column", help="Explicit appraised-value column.")

    args = parser.parse_args()

    csv_path = Path(args.csv_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    headers, mineral_rows = read_mineral_roll(csv_path)
    missing = [required for required in REQUIRED_COLUMNS if required not in set(headers)]
    if missing:
        raise ValueError("Missing required columns in CSV: " + ", ".join(sorted(missing)))

    owner_name_col = pick_column(headers, args.owner_name_column, DEFAULT_OWNER_NAME_CANDIDATES)
    mailing_address_col = pick_column(
        headers, args.mailing_address_column, DEFAULT_MAILING_ADDRESS_CANDIDATES
    )
    mailing_city_col = pick_column(headers, args.mailing_city_column, DEFAULT_MAILING_CITY_CANDIDATES)
    mailing_state_col = pick_column(
        headers, args.mailing_state_column, DEFAULT_MAILING_STATE_CANDIDATES
    )
    mailing_zip_col = pick_column(headers, args.mailing_zip_column, DEFAULT_MAILING_ZIP_CANDIDATES)
    appraised_value_col = pick_column(
        headers, args.appraised_value_column, DEFAULT_APPRAISED_VALUE_CANDIDATES
    )

    names_lookup: dict[str, dict[str, str]] | None = None
    if args.names_path:
        names_lookup = load_names_lookup(Path(args.names_path))
        print(f"Loaded names records for join: {len(names_lookup)}")

    print(f"Detected owner-name column: {owner_name_col}")
    print(f"Detected mailing-address column: {mailing_address_col}")
    print(f"Detected mailing-city column: {mailing_city_col}")
    print(f"Detected mailing-state column: {mailing_state_col}")
    print(f"Detected mailing-zip column: {mailing_zip_col}")
    print(f"Detected appraised-value column: {appraised_value_col}")

    rows_to_upsert: list[dict[str, Any]] = []
    names_matches = 0
    for row_offset, row in enumerate(mineral_rows, start=3):
        try:
            payload, did_match = build_row_payload(
                row=row,
                source_file=csv_path.name,
                owner_name_col=owner_name_col,
                mailing_address_col=mailing_address_col,
                mailing_city_col=mailing_city_col,
                mailing_state_col=mailing_state_col,
                mailing_zip_col=mailing_zip_col,
                appraised_value_col=appraised_value_col,
                names_lookup=names_lookup,
            )
            rows_to_upsert.append(payload)
            if did_match:
                names_matches += 1
        except ValueError as exc:
            raise ValueError(f"Invalid row at CSV line {row_offset}: {exc}") from exc

    if args.dry_run:
        if names_lookup is not None:
            print(f"Joined names rows: {names_matches} / {len(rows_to_upsert)}")
        print(f"Dry run complete. Parsed {len(rows_to_upsert)} rows.")
        return

    try:
        from supabase import create_client
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "Missing dependency 'supabase'. Install with: pip install supabase"
        ) from exc

    supabase_url = require_env_or_arg(args.supabase_url, "NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = require_env_or_arg(args.supabase_key, "SUPABASE_SERVICE_ROLE_KEY")
    client = create_client(supabase_url, supabase_key)

    for batch in chunked(rows_to_upsert, args.batch_size):
        client.table(TABLE_NAME).upsert(
            batch,
            on_conflict="county_lease_id,cad_account_number,tax_year",
        ).execute()

    print(f"Upsert complete. Processed {len(rows_to_upsert)} rows into {TABLE_NAME}.")


if __name__ == "__main__":
    run()
