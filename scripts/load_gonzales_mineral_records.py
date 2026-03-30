#!/usr/bin/env python3
"""Load Gonzales County mineral ownership CSV records into Supabase."""

from __future__ import annotations

import argparse
import csv
import os
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

TABLE_NAME = "gonzales_mineral_ownership"

REQUIRED_COLUMNS: dict[str, str] = {
    "County Lease ID": "county_lease_id",
    "County Lease Name": "county_lease_name",
    "Field Name": "field_name",
    "Operator Name": "operator_name",
    "Tax Year": "tax_year",
    "CAD Account Number": "cad_account_number",
    "CAD Property Type": "cad_property_type",
    "SPTB Code": "sptb_code",
    "Exemptions": "exemptions",
    "Acreage": "acreage",
    "County District ID": "county_district_id",
    "RRC Oil and Gas Code": "rrc_oil_and_gas_code",
    "RRC Lease ID": "rrc_lease_id",
    "First Date": "first_date",
    "Last Date": "last_date",
    "Prod Cumulative Sum Gas": "prod_cumulative_sum_gas",
    "Prod Cumulative Sum Oil": "prod_cumulative_sum_oil",
    "First 6 Month Gas": "first_6_month_gas",
    "First 6 Month Oil": "first_6_month_oil",
    "First 12 Month Gas": "first_12_month_gas",
    "First 12 Month Oil": "first_12_month_oil",
    "First 24 Month Gas": "first_24_month_gas",
    "First 24 Month Oil": "first_24_month_oil",
    "First 60 Month Gas": "first_60_month_gas",
    "First 60 Month Oil": "first_60_month_oil",
}

DEFAULT_OWNER_NAME_CANDIDATES = [
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
    "Appraised Value",
    "Total Appraised Value",
    "Net Appraised Value",
    "Assessed Value",
    "Market Value",
]


def normalize_header(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def clean_str(value: Any) -> str | None:
    if value is None:
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


def build_row_payload(
    row: dict[str, Any],
    source_file: str,
    owner_name_col: str | None,
    mailing_address_col: str | None,
    mailing_city_col: str | None,
    mailing_state_col: str | None,
    mailing_zip_col: str | None,
    appraised_value_col: str | None,
) -> dict[str, Any]:
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
        "first_date": parse_date(row.get("First Date")).isoformat()
        if parse_date(row.get("First Date"))
        else None,
        "last_date": parse_date(row.get("Last Date")).isoformat()
        if parse_date(row.get("Last Date"))
        else None,
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
        "owner_name": clean_str(row.get(owner_name_col)) if owner_name_col else None,
        "mailing_address": clean_str(row.get(mailing_address_col))
        if mailing_address_col
        else None,
        "mailing_city": clean_str(row.get(mailing_city_col)) if mailing_city_col else None,
        "mailing_state": clean_str(row.get(mailing_state_col))
        if mailing_state_col
        else None,
        "mailing_zip": clean_str(row.get(mailing_zip_col)) if mailing_zip_col else None,
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

    return payload


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

    rows_to_upsert: list[dict[str, Any]] = []
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("CSV has no header row.")
        headers = [h for h in reader.fieldnames if h is not None]

        missing = [
            required for required in REQUIRED_COLUMNS if required not in set(headers)
        ]
        if missing:
            raise ValueError(
                "Missing required columns in CSV: " + ", ".join(sorted(missing))
            )

        owner_name_col = pick_column(
            headers, args.owner_name_column, DEFAULT_OWNER_NAME_CANDIDATES
        )
        mailing_address_col = pick_column(
            headers, args.mailing_address_column, DEFAULT_MAILING_ADDRESS_CANDIDATES
        )
        mailing_city_col = pick_column(
            headers, args.mailing_city_column, DEFAULT_MAILING_CITY_CANDIDATES
        )
        mailing_state_col = pick_column(
            headers, args.mailing_state_column, DEFAULT_MAILING_STATE_CANDIDATES
        )
        mailing_zip_col = pick_column(
            headers, args.mailing_zip_column, DEFAULT_MAILING_ZIP_CANDIDATES
        )
        appraised_value_col = pick_column(
            headers, args.appraised_value_column, DEFAULT_APPRAISED_VALUE_CANDIDATES
        )

        print(f"Detected owner-name column: {owner_name_col}")
        print(f"Detected mailing-address column: {mailing_address_col}")
        print(f"Detected mailing-city column: {mailing_city_col}")
        print(f"Detected mailing-state column: {mailing_state_col}")
        print(f"Detected mailing-zip column: {mailing_zip_col}")
        print(f"Detected appraised-value column: {appraised_value_col}")

        for index, row in enumerate(reader, start=2):
            try:
                rows_to_upsert.append(
                    build_row_payload(
                        row=row,
                        source_file=csv_path.name,
                        owner_name_col=owner_name_col,
                        mailing_address_col=mailing_address_col,
                        mailing_city_col=mailing_city_col,
                        mailing_state_col=mailing_state_col,
                        mailing_zip_col=mailing_zip_col,
                        appraised_value_col=appraised_value_col,
                    )
                )
            except ValueError as exc:
                raise ValueError(f"Invalid row at CSV line {index}: {exc}") from exc

    if args.dry_run:
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
