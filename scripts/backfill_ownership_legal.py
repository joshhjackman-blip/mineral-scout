#!/usr/bin/env python3
"""Reparse ``<county>_mineral_ownership`` legal fields from raw_record.survey.

The 2026 Reeves/Pecos rolls stored abstract='B' because ``AB 2210`` was
parsed as the letter B. Map rematch already ignores one-letter ghosts
and re-reads the survey text; CRM and ``/api/tract-owners`` still query
the ownership table by ``abstract``, so those rows stay unlinked until
the columns themselves are patched.

Only ghost abstracts (1-2 letters) and missing abstract/block/section
are overwritten. Rows that already have a real abstract keep it.

Usage::

    python scripts/backfill_ownership_legal.py --county reeves,pecos
    python scripts/backfill_ownership_legal.py --county reeves --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from abstract_match import parse_legal_description  # noqa: E402
from supabase_rest import (  # noqa: E402
    paginate_rows,
    patch_ids,
    rest_base,
    rest_headers,
)

DEFAULT_COUNTIES = ("reeves", "pecos", "glasscock", "crane")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--county",
        default=",".join(DEFAULT_COUNTIES),
        help="Comma-separated county ids (default: reeves,pecos,glasscock).",
    )
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


def is_ghost_abstract(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(text) and len(text) <= 2 and text.isalpha()


def survey_text(row: dict[str, Any]) -> str:
    raw = row.get("raw_record")
    if isinstance(raw, dict):
        survey = raw.get("survey")
        if survey:
            return str(survey)
    return str(row.get("survey") or "")


def backfill_county(
    client: httpx.Client,
    base: str,
    headers: dict[str, str],
    county: str,
    *,
    dry_run: bool,
) -> None:
    table = f"{county}_mineral_ownership"
    print(f"\n=== {county} → {table} ===", flush=True)
    try:
        rows = paginate_rows(
            client,
            base,
            table,
            headers,
            select="id,abstract,block,section,survey,raw_record",
        )
    except Exception as exc:
        print(f"  skip: {exc}", flush=True)
        return

    print(f"  loaded {len(rows):,} rows", flush=True)
    groups: dict[tuple[str | None, str | None, str | None], list[int]] = defaultdict(list)
    scanned_ghost = 0
    unchanged = 0
    for row in rows:
        current_abs = str(row.get("abstract") or "").strip() or None
        current_blk = str(row.get("block") or "").strip() or None
        current_sec = str(row.get("section") or "").strip() or None
        ghost = is_ghost_abstract(current_abs)
        if ghost:
            scanned_ghost += 1
            current_abs = None
        if current_abs and current_blk and current_sec:
            unchanged += 1
            continue
        parsed = parse_legal_description(survey_text(row))
        new_abs = current_abs or parsed.get("abstract")
        new_blk = current_blk or parsed.get("block")
        new_sec = current_sec or parsed.get("section")
        if (new_abs, new_blk, new_sec) == (
            str(row.get("abstract") or "").strip() or None,
            current_blk,
            current_sec,
        ) and not ghost:
            unchanged += 1
            continue
        if new_abs == current_abs and new_blk == current_blk and new_sec == current_sec:
            unchanged += 1
            continue
        if not new_abs and not new_blk and not new_sec:
            unchanged += 1
            continue
        groups[(new_abs, new_blk, new_sec)].append(int(row["id"]))

    patch_n = sum(len(ids) for ids in groups.values())
    print(
        f"  ghost abstracts: {scanned_ghost:,}   "
        f"to patch: {patch_n:,}   unchanged: {unchanged:,}   "
        f"payload groups: {len(groups):,}",
        flush=True,
    )
    if dry_run:
        shown = 0
        for key, ids in groups.items():
            print(f"  would set abstract/block/section={key} on {len(ids)} rows")
            shown += 1
            if shown >= 8:
                break
        return

    written = 0
    for index, ((abstract, block, section), ids) in enumerate(groups.items(), start=1):
        written += patch_ids(
            client,
            base,
            table,
            headers,
            ids,
            {"abstract": abstract, "block": block, "section": section},
        )
        if index == 1 or index % 25 == 0 or index == len(groups):
            print(
                f"  patched {written:,}/{patch_n:,} rows "
                f"({index}/{len(groups)} groups)",
                flush=True,
            )
    print(f"  done {county}: patched {written:,}", flush=True)


def main() -> None:
    args = parse_args()
    counties = [c.strip().lower() for c in args.county.split(",") if c.strip()]
    if not counties:
        print("No counties provided.")
        sys.exit(1)
    base = rest_base(require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",)))
    headers = rest_headers(require_env("SUPABASE_SERVICE_ROLE_KEY", ("SUPABASE_KEY",)))
    with httpx.Client(timeout=180.0) as client:
        for county in counties:
            backfill_county(client, base, headers, county, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
