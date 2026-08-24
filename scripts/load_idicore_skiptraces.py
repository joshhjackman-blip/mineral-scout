#!/usr/bin/env python3
"""Load pre-run idiCORE skip-trace results into the shared ``skip_trace_cache``.

The app's /api/skiptrace route checks ``skip_trace_cache`` first (keyed on
``UPPER(TRIM(owner_name))``). A hit returns ``cached: true, billable: false,
unit_price_usd: 0`` with no usage increment and no Stripe meter event — so
seeding this table makes these owners resolve instantly and for free, with
nothing surfaced to the end user about them being pre-paid.

Input is the idiCORE batch CSV export whose columns look like:
  INPUT: Extra 2                     -> the mineral-roll owner name (the key)
  INPUT: Address 1 / City / State / Zip Code
  PH: Phone1 .. PH: Phone5           -> phone numbers
  EMAIL: Email1 .. EMAIL: Email5     -> emails

Usage:
  python3 scripts/load_idicore_skiptraces.py --file <export.csv> --dry-run
  python3 scripts/load_idicore_skiptraces.py --file <export.csv>
"""
from __future__ import annotations

import argparse
import csv
import os
import re
from typing import Any
from urllib.parse import urlparse

import httpx

OWNER_COL = "INPUT: Extra 2"
ADDR_COL = "INPUT: Address 1"
CITY_COL = "INPUT: City"
STATE_COL = "INPUT: State"
ZIP_COL = "INPUT: Zip Code"
PHONE_COLS = [f"PH: Phone{i}" for i in range(1, 6)]
EMAIL_COLS = [f"EMAIL: Email{i}" for i in range(1, 6)]

_PLACEHOLDER = re.compile(r"UNKNOWN|N/?A|OPERATOR", re.I)


def owner_key(name: str) -> str:
    """Match the app's skipTraceOwnerKey: trim + uppercase."""
    return str(name or "").strip().upper()


def clean_phone(v: str) -> str | None:
    digits = re.sub(r"\D", "", str(v or ""))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def clean_email(v: str) -> str | None:
    e = str(v or "").strip().lower()
    return e if "@" in e and "." in e.split("@")[-1] else None


def mailing_address(row: dict[str, str]) -> str:
    addr = str(row.get(ADDR_COL) or "").strip()
    if not addr or _PLACEHOLDER.search(addr):
        return ""
    parts = [addr]
    city = str(row.get(CITY_COL) or "").strip()
    state = str(row.get(STATE_COL) or "").strip()
    zc = str(row.get(ZIP_COL) or "").strip()
    tail = " ".join(p for p in [city, state, zc] if p)
    if tail:
        parts.append(tail)
    return ", ".join(parts)


def parse_rows(path: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            name = owner_key(row.get(OWNER_COL, ""))
            if not name:
                continue
            phones: list[str] = []
            for col in PHONE_COLS:
                p = clean_phone(row.get(col, ""))
                if p and p not in phones:
                    phones.append(p)
            emails: list[str] = []
            for col in EMAIL_COLS:
                e = clean_email(row.get(col, ""))
                if e and e not in emails:
                    emails.append(e)
            out.append({
                "owner_name": name,
                "mailing_address": mailing_address(row),
                "phones": phones,
                "emails": emails,
            })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="idiCORE batch CSV export")
    ap.add_argument("--source", default="idicore")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--include-empty", action="store_true",
                    help="also cache owners with no phones/emails (blocks a "
                         "future live re-trace). Default: skip misses.")
    args = ap.parse_args()

    rows = parse_rows(args.file)
    hits = [r for r in rows if r["phones"] or r["emails"]]
    misses = [r for r in rows if not (r["phones"] or r["emails"])]
    to_load = rows if args.include_empty else hits
    print(f"Parsed {len(rows)} rows: {len(hits)} with contacts, {len(misses)} misses.")
    print(f"Loading {len(to_load)} into skip_trace_cache (source={args.source}).")

    if args.dry_run:
        for r in to_load[:12]:
            print(f"  {r['owner_name']:<34} phones={len(r['phones'])} emails={len(r['emails'])} "
                  f"| {r['phones'][:2]} {r['emails'][:1]}")
        print("  (dry-run — nothing written)")
        return

    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    payload = [{
        "owner_name": r["owner_name"],
        "mailing_address": r["mailing_address"],
        "phones": r["phones"],
        "emails": r["emails"],
        "source": args.source,
        "updated_at": now,
    } for r in to_load]

    def esc(v: str) -> str:
        # Quote for a PostgREST in.(...) list; owner names contain commas/&.
        return '"' + v.replace('"', '""') + '"'

    loaded = 0
    with httpx.Client(timeout=60) as client:
        for i in range(0, len(payload), 100):
            batch = payload[i:i + 100]
            names = ",".join(esc(b["owner_name"]) for b in batch)
            # Delete-then-insert so this is idempotent even without a unique
            # constraint on owner_name (the read path keys on owner_name, so a
            # single row per owner is all that matters).
            d = client.delete(f"{base}/rest/v1/skip_trace_cache",
                              params={"owner_name": f"in.({names})"},
                              headers=headers)
            if d.status_code >= 300:
                raise SystemExit(f"delete failed ({d.status_code}): {d.text[:300]}")
            r = client.post(f"{base}/rest/v1/skip_trace_cache", headers=headers, json=batch)
            if r.status_code >= 300:
                raise SystemExit(f"insert failed ({r.status_code}): {r.text[:300]}")
            loaded += len(batch)
            print(f"  loaded {loaded}/{len(payload)}")
    print(f"Done: {loaded} owners cached.")


if __name__ == "__main__":
    main()
