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

# Ticket 1.3 §6: model comes from ANTHROPIC_MODEL env var so we never
# hardcode a Claude model string in application code. Default aligns
# with the spec's "keep spend minimal" directive — Haiku is roughly
# 5-10x cheaper than Sonnet for the messy-text-parse workload the
# operator agent runs.
DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")

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
    parser.add_argument(
        "--model", default=DEFAULT_MODEL,
        help="Claude model. Defaults to $ANTHROPIC_MODEL (falls back to "
             "'claude-haiku-4-5' per Ticket 1.3 §6). Never pass a hardcoded "
             "model in cron; leave the env var authoritative.",
    )
    parser.add_argument(
        "--use-batch-api", action="store_true", default=True,
        help="Submit the operator research via Anthropic's Batch API for "
             "the 50%% discount (Ticket 1.3 §6 — the quarterly cron must "
             "not use real-time completions). Turn off only for local "
             "iteration where you want streaming output.",
    )
    parser.add_argument(
        "--realtime", dest="use_batch_api", action="store_false",
        help="Bypass the Batch API and stream real-time completions. "
             "Development / debugging only — cron should never call this.",
    )
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


def run_agent(county: str, model: str, use_batch_api: bool) -> list[dict[str, Any]]:
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

    Batch API path (Ticket 1.3 §6):
      * When use_batch_api is True (default in cron), submit each
        county+operator prompt as a batch request via
        client.messages.batches.create(...). Poll status until the
        batch settles, then read results and upsert.
      * Batch results land at ~50% the cost of real-time completions.
      * For local iteration, --realtime falls back to the streaming
        API so you can watch the tool-use loop live.

    Both paths must read the model name from `model` (which itself
    comes from ANTHROPIC_MODEL). Never hardcode a model string in the
    request payload.

    The stub below returns [] so --dry-run and DB plumbing are testable
    end-to-end without an Anthropic key. Ship the real tool set as
    the next follow-up.
    """
    del county, model, use_batch_api
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
            mode = "batch" if args.use_batch_api else "realtime"
            print(f"agent :: {county} :: model={args.model} :: mode={mode}")
            programs.extend(run_agent(county, args.model, args.use_batch_api))
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
