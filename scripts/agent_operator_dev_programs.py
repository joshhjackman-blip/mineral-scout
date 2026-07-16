#!/usr/bin/env python3
"""Quarterly agent that tags operators with active development programs
(Ticket 1.3 Phase 3, operator agent).

Same pattern as scripts/oklahoma-deed-researcher / project knowledge §20:
a Claude tool-use loop that reads operator quarterly investor decks +
RRC Rule 37/38 filings, decides which counties + fields each operator
is actively developing, and writes citations back to
public.operator_dev_programs.

Currently a scaffold: the agent LOOP is stubbed with a simple prompt
against Anthropic. Filling in the real tool set (web search, PDF
extraction, RRC rule-37 queries) is a focused follow-up; the DB
target + upsert plumbing here already work end-to-end so once the
tools ship, the results wire straight into the scoring pipeline via
scripts/compute_development_status.py (which reads active operators
from this table and adds +1 pud_score per matching permit).

Usage
-----
::

    # Run against every county on the platform
    python3 scripts/agent_operator_dev_programs.py

    # Restrict to a subset
    python3 scripts/agent_operator_dev_programs.py --county gonzales,howard

    # Dry run — print the operators the agent would tag but don't upsert
    python3 scripts/agent_operator_dev_programs.py --dry-run

Env
---
    ANTHROPIC_API_KEY           required unless --dry-run
    SUPABASE_URL / SUPABASE_KEY required for the DB upsert
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

from supabase import Client, create_client

DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_COUNTIES = [
    "gonzales", "howard", "martin",
    "crane", "glasscock", "loving", "midland", "pecos",
    "reagan", "reeves", "upton", "ward", "winkler",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--county", default=",".join(DEFAULT_COUNTIES),
                        help="Comma-separated county ids the agent should analyze.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--input",
                        help="Optional path to a hand-curated JSON list "
                             "of programs (bypasses the Anthropic call, "
                             "useful for seeding the table before the "
                             "agent tool set is complete).")
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


def load_hand_curated(path: str) -> list[dict[str, Any]]:
    with open(path) as f:
        payload = json.load(f)
    if not isinstance(payload, list):
        raise ValueError("--input JSON must be a list of program dicts.")
    return payload


def run_agent(county: str, model: str) -> list[dict[str, Any]]:
    """PLACEHOLDER Anthropic call.

    Real implementation should give Claude the following tool set:
      * web_search(query) -> summary + URLs
      * fetch_url(url) -> page text
      * fetch_pdf(url) -> extracted text
      * rrc_rule37_lookup(operator, county) -> spacing exceptions
      * write_program(operator, county, field, notes, sources) -> upsert

    And a system prompt like:
      "You are researching which oil-and-gas operators have active
       development programs in {county} County, Texas. For each
       operator you identify, cite their most recent investor deck /
       press release / rule-37 exception filing, then call
       write_program(...) with a JSON tool-call."

    The stub below returns [] so `--dry-run` and DB plumbing are
    testable end-to-end without an Anthropic key. Ship the real
    tool set as a follow-up.
    """
    del county, model
    return []


def upsert_programs(client: Client, programs: list[dict[str, Any]]) -> int:
    if not programs:
        return 0
    rows: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    for prog in programs:
        operator = str(prog.get("operator_name") or prog.get("operator") or "").strip()
        county = str(prog.get("county_id") or prog.get("county") or "").strip().lower()
        if not operator or not county:
            continue
        rows.append({
            "operator_name": operator,
            "county_id": county,
            "field_name": prog.get("field_name") or prog.get("field") or None,
            "program_start": prog.get("program_start") or None,
            "program_notes": prog.get("program_notes") or prog.get("notes") or None,
            "source_urls": prog.get("source_urls") or prog.get("citations") or [],
            "active": bool(prog.get("active", True)),
            "cited_at": now,
        })
    if not rows:
        return 0
    try:
        client.table("operator_dev_programs").upsert(
            rows, on_conflict="operator_name,county_id,field_name",
        ).execute()
    except Exception as exc:
        message = str(exc).lower()
        if "does not exist" in message or "not find" in message:
            print("operator_dev_programs table missing — apply the Phase 3 migration first.",
                  file=sys.stderr)
            return 0
        raise
    return len(rows)


def main() -> None:
    args = parse_args()

    supabase_url = require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
    supabase_key = require_env("SUPABASE_KEY", ("SUPABASE_SERVICE_ROLE_KEY",))
    client = create_client(supabase_url, supabase_key)

    counties = [c.strip().lower() for c in args.county.split(",") if c.strip()]

    programs: list[dict[str, Any]] = []
    if args.input:
        programs = load_hand_curated(args.input)
        # Filter down to requested counties.
        programs = [p for p in programs if str(p.get("county_id") or p.get("county") or "").lower() in counties]
        print(f"loaded {len(programs)} hand-curated programs from {args.input}")
    else:
        # Real path: Anthropic agent. Stubbed today; see run_agent docstring.
        try:
            require_env("ANTHROPIC_API_KEY")
        except ValueError:
            if not args.dry_run:
                print("ANTHROPIC_API_KEY missing — pass --dry-run or set the key.",
                      file=sys.stderr)
                sys.exit(1)
        for county in counties:
            print(f"agent :: {county} ...")
            programs.extend(run_agent(county, args.model))
        print(f"agent produced {len(programs)} program(s).")

    if args.dry_run:
        for p in programs[:10]:
            print(" ", p)
        print(f"(dry-run: skipping upsert of {len(programs)} program(s).)")
        return

    inserted = upsert_programs(client, programs)
    print(f"upserted {inserted} operator_dev_programs row(s).")


if __name__ == "__main__":
    main()
