#!/usr/bin/env python3
"""Load a county's mineral ownership roll (xlsx or csv) into Supabase.

Handles the wide owner-format file the data provider ships for the Permian
basin counties (Howard's ``howard_mineral_roll.csv``, Martin's
``owners__2025_Martin.xlsx``, etc.). One CSV/XLSX row per owner × well ×
lease, with columns like ``owner``, ``rrc_id``, ``operator``, ``abstract``,
``acres``, ``interest``.

The loader:
1. Reads the file (CSV or XLSX, auto-detected by suffix).
2. Maps source columns to the ``<county>_mineral_ownership`` schema.
3. Computes ``out_of_state``, ``motivated``, and a ``propensity_score``
   that mirrors the existing Gonzales scoring formula.
4. Upserts in batches keyed on (owner_id, abstract, well, tax_year).

Usage::

    python3 scripts/load_martin_mineral_records.py \\
        --input data/owners__2025_Martin.xlsx
    python3 scripts/load_county_mineral_records.py \\
        --county martin --input data/owners__2025_Martin.xlsx --dry-run
"""

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

DEFAULT_COUNTY_ID = "martin"

# Source column → table column. Source names are matched case-insensitively
# and after collapsing whitespace, so files with mixed case / extra spaces
# still resolve.
COLUMN_MAP: dict[str, str] = {
    "_key": "source_key",
    "owner_id": "owner_id",
    "owner": "owner_name",
    "address1": "address_1",
    "address2": "address_2",
    "address3": "address_3",
    "address4": "address_4",
    "city": "mailing_city",
    "state": "mailing_state",
    "zip": "mailing_zip",
    "well": "well",
    "yearbegan": "year_began",
    "rrc_id": "rrc_lease_id",
    "operator": "operator_name",
    "field_name": "field_name",
    "zone": "zone",
    "survey": "survey",
    "abstract": "abstract",
    "block": "block",
    "section": "section",
    "extra": "extra",
    "acres": "acreage",
    "type": "cad_property_type",
    "interest": "ownership_pct",
    "value": "appraised_value",
    "year": "tax_year",
    "county": "county",
    "apprasal": "appraisal_code",
    "appraisal": "appraisal_code",
    "searchid": "search_id",
    "searchndx": "search_index",
    "bidam": "bid_amount",
    "add_date": "add_date",
    "lease_state": "lease_state",
    "matching": "matching_flag",
    "match2": "matching_flag_2",
    "lat": "latitude",
    "long": "longitude",
    "api": "api",
    "leaseunique": "lease_unique",
    "class_type": "class_type",
    "value_aop": "value_aop",
    "wells_in_lease": "wells_in_lease",
    "bbd_acres": "bbd_acres",
    "acres_per_well": "acres_per_well",
    "lease_boe_reserves": "lease_boe_reserves",
    "net_boe_reserves": "net_boe_reserves",
    "value_reserves": "value_reserves",
}

NUMERIC_FIELDS = {
    "acreage",
    "ownership_pct",
    "appraised_value",
    "bid_amount",
    "latitude",
    "longitude",
    "value_aop",
    "bbd_acres",
    "acres_per_well",
    "lease_boe_reserves",
    "net_boe_reserves",
    "value_reserves",
}
INTEGER_FIELDS = {"year_began", "tax_year", "wells_in_lease"}


def normalize_header(value: str) -> str:
    return re.sub(r"\s+", " ", str(value).strip().lower())


def is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return bool(pd.isna(value))


def clean_str(value: Any) -> str | None:
    if is_missing(value):
        return None
    text = str(value).strip()
    return text or None


def parse_int(value: Any) -> int | None:
    text = clean_str(value)
    if text is None:
        return None
    text = text.replace(",", "")
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


def parse_decimal(value: Any) -> float | None:
    text = clean_str(value)
    if text is None:
        return None
    normalized = text.replace(",", "").replace("$", "")
    if normalized.startswith("(") and normalized.endswith(")"):
        normalized = f"-{normalized[1:-1]}"
    try:
        return float(Decimal(normalized))
    except (InvalidOperation, ValueError):
        try:
            return float(normalized)
        except ValueError:
            return None


def parse_date(value: Any) -> date | None:
    text = clean_str(value)
    if text is None:
        return None
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def sanitize_json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: sanitize_json_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_json_value(v) for v in value]
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if pd.isna(value):  # type: ignore[arg-type]
        return None
    return value


def read_input(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() in {".xlsx", ".xls"}:
        df = pd.read_excel(path, dtype=object)
    else:
        df = pd.read_csv(path, dtype=object, low_memory=False, index_col=False)
    df.columns = [str(c).strip() for c in df.columns]
    return df.to_dict(orient="records")


def build_payload(
    row: dict[str, Any],
    *,
    county_display: str,
    source_file: str,
    column_lookup: dict[str, str],
) -> dict[str, Any]:
    raw: dict[str, Any] = {k: sanitize_json_value(v) for k, v in row.items()}

    payload: dict[str, Any] = {
        "county": county_display,
        "raw_record": raw,
        "source_file": source_file,
    }

    for source_lower, target in COLUMN_MAP.items():
        column = column_lookup.get(source_lower)
        if not column:
            continue
        value = row.get(column)
        if target in NUMERIC_FIELDS:
            payload[target] = parse_decimal(value)
        elif target in INTEGER_FIELDS:
            payload[target] = parse_int(value)
        else:
            payload[target] = clean_str(value)

    address_parts = [
        payload.get("address_1"),
        payload.get("address_2"),
        payload.get("address_3"),
        payload.get("address_4"),
    ]
    payload["mailing_address"] = ", ".join(p for p in address_parts if p) or None

    add_date = parse_date(payload.get("add_date"))
    if add_date is not None:
        payload["add_date"] = add_date.isoformat()

    state = (payload.get("mailing_state") or "").strip().upper()
    out_of_state = bool(state) and state not in {"TX", "TEXAS"}
    payload["out_of_state"] = out_of_state

    score = compute_propensity_score(payload, out_of_state)
    payload["propensity_score"] = score
    payload["motivated"] = score >= 5

    return payload


def compute_propensity_score(payload: dict[str, Any], out_of_state: bool) -> int:
    """Mirror the Gonzales propensity score (see migration 20260330110000).

    Fields used:
      +3  out-of-state mailing
      +2  estate / trust owner name
      +1  LLC / LP / corporate owner name
      +1  small interest (< 50 acres of net acreage proxy, here ``acreage``)
      +1  any cumulative oil production reported
    """
    score = 0
    name = (payload.get("owner_name") or "").upper()
    if out_of_state:
        score += 3
    if "ESTATE" in name or "TRUST" in name:
        score += 2
    if any(token in name for token in (" LLC", " LP", " CORP", " INC")):
        score += 1
    acreage = payload.get("acreage") or 0
    if isinstance(acreage, (int, float)) and 0 < acreage < 50:
        score += 1
    interest = payload.get("ownership_pct") or 0
    if isinstance(interest, (int, float)) and interest > 0:
        score += 1
    return score


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--county",
        default=os.getenv("COUNTY_ID", DEFAULT_COUNTY_ID),
        help="County id (matches lib/counties.ts entry, e.g. 'martin').",
    )
    parser.add_argument(
        "--input",
        dest="input_path",
        default=os.getenv("COUNTY_INPUT_OWNERS"),
        help="Path to the owners CSV/XLSX. Defaults from COUNTY_INPUT_OWNERS env.",
    )
    parser.add_argument(
        "--county-display",
        help="Display value to write into the 'county' column. Defaults to the capitalized county id.",
    )
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Process only N rows (0 = all). Useful for smoke tests.")
    parser.add_argument("--supabase-url", help="Supabase URL.")
    parser.add_argument("--supabase-key", help="Supabase service-role key.")
    parser.add_argument(
        "--on-conflict",
        default="source_key",
        help="Unique-key columns used for upsert. Adjust if your table uses a different unique constraint.",
    )
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


def main() -> None:
    args = parse_args()
    county_id = args.county.strip().lower()
    table_name = f"{county_id}_mineral_ownership"
    county_display = args.county_display or county_id.capitalize()

    if not args.input_path:
        raise ValueError("Provide --input pointing at the owners CSV/XLSX.")
    input_path = Path(args.input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Owners file not found: {input_path}")

    print(f"Loading owners for county '{county_id}' from {input_path}")
    rows = read_input(input_path)
    if args.limit:
        rows = rows[: args.limit]
    if not rows:
        print("No rows found in input file.")
        return

    column_lookup = {normalize_header(c): c for c in rows[0].keys()}
    matched = {src for src in COLUMN_MAP if src in column_lookup}
    missing = sorted(set(COLUMN_MAP) - matched)
    print(f"Mapped {len(matched)}/{len(COLUMN_MAP)} known columns.")
    if missing:
        print(f"  Unmapped columns from defaults: {', '.join(missing[:10])}")

    payloads: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        payload = build_payload(
            row,
            county_display=county_display,
            source_file=input_path.name,
            column_lookup=column_lookup,
        )
        payloads.append(payload)
        if index % 10000 == 0:
            print(f"  parsed {index}/{len(rows)} rows", flush=True)

    motivated = sum(1 for entry in payloads if entry.get("motivated"))
    out_of_state = sum(1 for entry in payloads if entry.get("out_of_state"))
    avg_score = (
        sum(entry.get("propensity_score") or 0 for entry in payloads) / max(len(payloads), 1)
    )
    print(f"Prepared {len(payloads)} rows. Motivated={motivated}, OutOfState={out_of_state}, avgScore={avg_score:.2f}.")

    if args.dry_run:
        print("Dry run — first row preview:")
        first = {k: v for k, v in payloads[0].items() if k != "raw_record"}
        for k, v in first.items():
            print(f"  {k!s:25s} -> {v}")
        return

    try:
        from supabase import create_client
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "Missing dependency 'supabase'. Install with: pip install supabase"
        ) from exc

    supabase_url = require_env_or_arg(args.supabase_url, "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL")
    supabase_key = require_env_or_arg(args.supabase_key, "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY")
    client = create_client(supabase_url, supabase_key)

    total_batches = max(1, math.ceil(len(payloads) / args.batch_size))
    written = 0
    for batch_index, batch in enumerate(chunked(payloads, args.batch_size), start=1):
        client.table(table_name).upsert(batch, on_conflict=args.on_conflict).execute()
        written += len(batch)
        pct = (written / len(payloads)) * 100 if payloads else 100.0
        print(f"[{batch_index}/{total_batches}] Upserted {written}/{len(payloads)} ({pct:.1f}%)", flush=True)

    print(f"Done. Wrote {written} rows into {table_name}.")


if __name__ == "__main__":
    main()
