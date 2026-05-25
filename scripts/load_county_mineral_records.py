#!/usr/bin/env python3
"""Load a county's mineral ownership roll (xlsx or csv) into Supabase.

Targets the same schema Howard uses (``howard_mineral_ownership``):

    county, owner_name, mailing_address, mailing_city, mailing_state,
    mailing_zip, rrc_lease_id, operator_name, field_name, acreage,
    ownership_pct, appraised_value, sptb_code, abstract, block, section,
    survey, lat, lon, tax_year, out_of_state, propensity_score,
    motivated, raw_record

Source file layout matches the data provider's wide owner format used for
Howard (``howard_mineral_roll.csv``) and Martin (``owners__2025_Martin.xlsx``):

    _key, owner_id, owner, address1..address4, city, state, zip, well,
    yearbegan, rrc_id, operator, field_name, zone, survey, abstract,
    block, section, extra, acres, type, interest, value, year, county,
    apprasal, searchid, searchndx, bidam, add_date, lease_state,
    matching, match2, lat, long, api, leaseunique, class_type, value_aop,
    wells_in_lease, bbd_acres, acres_per_well, lease_boe_reserves,
    net_boe_reserves, value_reserves

Howard fills the ``abstract``, ``block``, ``section``, ``survey`` columns
directly. Martin packs all of that into ``survey`` as a single string like
``"T&P RR T1S BLK 35 SEC 4 A-654"`` or ``"T1N BLK 35 SEC 36 A-1013"``;
:func:`parse_legal_description` extracts the abstract / block / section
out of that text so the join key the parcel enrichment script reads
(``abstract``) ends up populated identically across counties.

Usage::

    python3 scripts/load_martin_mineral_records.py
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

# Source columns we care about, normalized to lowercase.
SOURCE_COLUMNS = {
    "_key", "owner_id", "owner", "address1", "address2", "address3", "address4",
    "city", "state", "zip", "well", "rrc_id", "operator", "field_name",
    "survey", "abstract", "block", "section", "acres", "type", "interest",
    "value", "year", "county", "lat", "long",
}


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


_TOWNSHIP_RE = re.compile(r"\bT\d+[NS]\b", re.IGNORECASE)
_BLOCK_RE = re.compile(r"\bBLK\s*([A-Z0-9]+)", re.IGNORECASE)
_SECTION_RE = re.compile(r"\bSEC\s*([A-Z0-9]+)", re.IGNORECASE)
# Martin abstracts come through as "A-1013", "A-U34", etc. Howard owner
# rows just store the bare number. Accept both shapes here.
_ABSTRACT_RE = re.compile(r"\bA[-\s]?([A-Z0-9]+)\b", re.IGNORECASE)


def parse_legal_description(survey_text: str) -> dict[str, str | None]:
    """Pull abstract / block / section / surveyor out of a free-form survey string.

    Examples seen in production data:
        ``"T1N BLK 35 SEC 36 A-1013"``        -> abstract=1013, block=35 T1N, section=36
        ``"T&P RR T1S BLK 35 SEC 4 A-654"``   -> abstract=654, block=35 T1S, section=4, survey=T&P RR
        ``"T&P T1S BLK 27 SEC 10 A-645"``     -> abstract=645, block=27 T1S, section=10, survey=T&P
        ``""`` (empty)                         -> all None
    """
    text = clean_str(survey_text)
    if not text:
        return {"abstract": None, "block": None, "section": None, "survey": None}

    upper = text.upper()
    township_match = _TOWNSHIP_RE.search(upper)
    block_match = _BLOCK_RE.search(upper)
    section_match = _SECTION_RE.search(upper)
    abstract_match = _ABSTRACT_RE.search(upper)

    abstract = abstract_match.group(1) if abstract_match else None
    block_value: str | None
    if block_match:
        # Howard stores the block as "<num> <township>" (e.g. "35 T1S"), so
        # mirror that when both pieces are available.
        block_num = block_match.group(1)
        if township_match:
            block_value = f"{block_num} {township_match.group(0).upper()}"
        else:
            block_value = block_num
    else:
        block_value = None
    section_value = section_match.group(1) if section_match else None

    # Strip the parsed tokens to leave only the surveyor / system name.
    cleaned = _ABSTRACT_RE.sub("", upper)
    cleaned = _SECTION_RE.sub("", cleaned)
    cleaned = _BLOCK_RE.sub("", cleaned)
    cleaned = _TOWNSHIP_RE.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -·")
    survey_value = cleaned or None

    return {
        "abstract": abstract,
        "block": block_value,
        "section": section_value,
        "survey": survey_value,
    }


def build_payload(
    row: dict[str, Any],
    *,
    county_display: str,
    column_lookup: dict[str, str],
) -> dict[str, Any]:
    raw: dict[str, Any] = {k: sanitize_json_value(v) for k, v in row.items()}

    def src(name: str) -> Any:
        column = column_lookup.get(name)
        return row.get(column) if column else None

    address_parts = [clean_str(src("address1")), clean_str(src("address2"))]
    extra_address = [clean_str(src("address3")), clean_str(src("address4"))]
    address_parts.extend(extra_address)
    mailing_address = ", ".join(p for p in address_parts if p) or None

    abstract = clean_str(src("abstract"))
    block = clean_str(src("block"))
    section = clean_str(src("section"))
    survey_raw = clean_str(src("survey"))

    if not abstract or not block or not section:
        # Martin packs everything into the survey column. Howard fills the
        # individual columns. Fall back to parsing only when the explicit
        # column is missing so we don't clobber a known-good value.
        parsed = parse_legal_description(survey_raw or "")
        abstract = abstract or parsed["abstract"]
        block = block or parsed["block"]
        section = section or parsed["section"]
        # Replace the freeform survey with just the surveyor name (e.g.
        # "T&P RR") when we successfully extracted structured pieces;
        # otherwise leave the original text intact.
        if parsed["abstract"] or parsed["block"] or parsed["section"]:
            survey_raw = parsed["survey"]

    state = (clean_str(src("state")) or "").upper()
    out_of_state = bool(state) and state not in {"TX", "TEXAS"}

    payload: dict[str, Any] = {
        "county": county_display,
        "owner_name": clean_str(src("owner")),
        "mailing_address": mailing_address,
        "mailing_city": clean_str(src("city")),
        "mailing_state": state or None,
        "mailing_zip": clean_str(src("zip")),
        "rrc_lease_id": clean_str(src("rrc_id")),
        "operator_name": clean_str(src("operator")),
        "field_name": clean_str(src("field_name")),
        "acreage": parse_decimal(src("acres")),
        "ownership_pct": parse_decimal(src("interest")),
        "appraised_value": parse_decimal(src("value")),
        "sptb_code": clean_str(src("type")),
        "abstract": abstract,
        "block": block,
        "section": section,
        "survey": survey_raw,
        "lat": parse_decimal(src("lat")),
        "lon": parse_decimal(src("long")),
        "tax_year": parse_int(src("year")),
        "out_of_state": out_of_state,
        "raw_record": raw,
    }

    # Drop lat/lon when source value is the literal placeholder "0" — Martin
    # mostly carries 0 in those columns and storing them as 0,0 would
    # silently anchor every owner over the equator.
    if payload["lat"] == 0:
        payload["lat"] = None
    if payload["lon"] == 0:
        payload["lon"] = None

    score = compute_propensity_score(payload, out_of_state)
    payload["propensity_score"] = score
    payload["motivated"] = score >= 5
    return payload


def compute_propensity_score(payload: dict[str, Any], out_of_state: bool) -> int:
    """Mirror the Gonzales propensity score (see migration 20260330110000).

    +3 out-of-state mailing
    +2 estate / trust owner name
    +1 LLC / LP / corporate owner name
    +1 acreage in (0, 50)
    +1 any ownership_pct reported
    """
    score = 0
    name = (payload.get("owner_name") or "").upper()
    if out_of_state:
        score += 3
    if "ESTATE" in name or "TRUST" in name:
        score += 2
    if any(token in name for token in (" LLC", " LP", " CORP", " INC")):
        score += 1
    acreage = payload.get("acreage")
    if isinstance(acreage, (int, float)) and 0 < acreage < 50:
        score += 1
    interest = payload.get("ownership_pct") or 0
    if isinstance(interest, (int, float)) and interest > 0:
        score += 1
    return score


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def read_input(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() in {".xlsx", ".xls"}:
        df = pd.read_excel(path, dtype=object)
    else:
        # ``index_col=False`` stops pandas from silently promoting a leading
        # column (e.g. ``_key``) into the row index when the header has fewer
        # fields than data rows.
        df = pd.read_csv(path, dtype=object, low_memory=False, index_col=False)
    df.columns = [str(c).strip() for c in df.columns]
    return df.to_dict(orient="records")


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
        help="Display value for the 'county' column. Defaults to capitalized county id.",
    )
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Process only N rows (0 = all).")
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="DELETE all rows from the target table before inserting (use for full reloads).",
    )
    parser.add_argument("--supabase-url", help="Supabase URL.")
    parser.add_argument("--supabase-key", help="Supabase service-role key.")
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

    print(f"Loading owners for county '{county_id}' from {input_path}", flush=True)
    rows = read_input(input_path)
    if args.limit:
        rows = rows[: args.limit]
    if not rows:
        print("No rows found in input file.")
        return

    column_lookup = {normalize_header(c): c for c in rows[0].keys()}
    matched = SOURCE_COLUMNS.intersection(column_lookup.keys())
    missing = sorted(SOURCE_COLUMNS - matched)
    print(f"Mapped {len(matched)}/{len(SOURCE_COLUMNS)} known source columns. Missing: {missing or '(none)'}.")

    payloads: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        payload = build_payload(row, county_display=county_display, column_lookup=column_lookup)
        payloads.append(payload)
        if index % 25000 == 0:
            print(f"  parsed {index}/{len(rows)} rows", flush=True)

    motivated = sum(1 for entry in payloads if entry.get("motivated"))
    out_of_state = sum(1 for entry in payloads if entry.get("out_of_state"))
    matched_abstract = sum(1 for entry in payloads if entry.get("abstract"))
    avg_score = (
        sum(entry.get("propensity_score") or 0 for entry in payloads) / max(len(payloads), 1)
    )
    print(
        f"Prepared {len(payloads):,} rows. WithAbstract={matched_abstract:,}, "
        f"Motivated={motivated:,}, OutOfState={out_of_state:,}, "
        f"avgScore={avg_score:.2f}.",
        flush=True,
    )

    if args.dry_run:
        sample = {k: v for k, v in payloads[0].items() if k != "raw_record"}
        print("Dry run — first row preview:")
        for k, v in sample.items():
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

    if args.truncate:
        # PostgREST DELETE without a filter is rejected; use a guaranteed-true
        # filter (id is non-null on every row) so the entire table clears.
        print(f"Truncating {table_name} (DELETE … WHERE id IS NOT NULL)…", flush=True)
        client.table(table_name).delete().not_.is_("id", "null").execute()

    total_batches = max(1, math.ceil(len(payloads) / args.batch_size))
    written = 0
    for batch_index, batch in enumerate(chunked(payloads, args.batch_size), start=1):
        client.table(table_name).insert(batch).execute()
        written += len(batch)
        pct = (written / len(payloads)) * 100 if payloads else 100.0
        if batch_index == 1 or batch_index % 25 == 0 or batch_index == total_batches:
            print(f"  [{batch_index}/{total_batches}] inserted {written:,}/{len(payloads):,} ({pct:.1f}%)", flush=True)

    print(f"Done. Wrote {written:,} rows into {table_name}.")


if __name__ == "__main__":
    main()
