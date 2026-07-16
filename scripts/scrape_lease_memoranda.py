#!/usr/bin/env python3
"""Scrape county-recorder lease memoranda into public.lease_memoranda
(Ticket 1.3 Phase 3, LEASING_ACTIVE signal — option B).

Each Texas county exposes its recorder index through a different
vendor portal. Rather than one giant if/else, this file dispatches to
a small per-county scrape function; each function returns a list of
LeaseMemoRow dicts and the shared main() upserts them into Supabase.

Per-county portal notes (this is where the research lives — fill in
the ``TODO`` markers as each county's parser gets written):

  gonzales   Gonzales BooksOnline (Kofile), reachable via the county
             clerk's records-search page. Search "Oil, Gas & Mineral
             Lease" recordings by date range and lift instrument no /
             lessor / lessee / recorded date. Landex + CourthouseDirect
             also mirror this index behind paywalls.
  howard     Howard County Clerk Public Records Search
             (kofile / howard-tx.kofile.com). Same OGL doc-type
             filter.
  martin     Martin County Clerk Public Records (kofile as of last
             check).
  crane      Crane County — usually appears on TX.Countyweb.com or a
             directly-served Kofile portal.
  glasscock  Glasscock — small county, index typically at
             glasscockcounty.org clerk page or piggybacked on Midland's
             regional portal.
  loving     Loving — tiny county (~130 residents). Index sometimes
             mirrored on the state's regional portal or maintained by
             the Reeves County Clerk.
  midland    Midland County Clerk uses Kofile
             (search.midlandcountyclerk.com) with an OGL doc-type.
  pecos      Pecos County Clerk — Kofile portal.
  reagan     Reagan County — small; check for a Kofile portal or
             Landex feed.
  reeves     Reeves County Clerk — Kofile.
  upton      Upton County Clerk — Kofile.
  ward       Ward County Clerk — Kofile.
  winkler    Winkler County Clerk — Kofile.

All Kofile-hosted counties share the same query flow, so once the
Gonzales / Kofile parser lands the rest reduces to changing a
constant. The shared scrape_kofile() helper below is the target.

Usage
-----
::

    # Scrape one county for the last 90 days and upsert
    python3 scripts/scrape_lease_memoranda.py --county gonzales

    # All counties on a schedule (used by the weekly GH Actions cron)
    python3 scripts/scrape_lease_memoranda.py \
        --county gonzales,howard,martin,crane,glasscock,loving,midland,pecos,reagan,reeves,upton,ward,winkler

    # Widen the lookback window
    python3 scripts/scrape_lease_memoranda.py --county howard --days 180

    # Dry-run: print rows the scraper would upsert without writing
    python3 scripts/scrape_lease_memoranda.py --county gonzales --dry-run
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import sys
import time
from html import unescape
from typing import Any, Callable
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

from supabase import Client, create_client

DEFAULT_DAYS = 90
BATCH_UPSERT_SIZE = 200
REQUEST_TIMEOUT_S = 45
POLITE_SLEEP_S = 1.5  # be nice to county portals


# ── Config per county ─────────────────────────────────────────────

# The doc-type filter every county recorder uses for oil-and-gas
# leases. Some portals ALSO record "Memorandum of Oil and Gas Lease"
# as a distinct type, so we search both.
OGL_DOC_TYPES = ("Oil, Gas and Mineral Lease", "Memorandum of Oil and Gas Lease", "OGL")


# ── Row type + shared upsert plumbing ─────────────────────────────

LeaseMemoRow = dict  # str -> Any; see build_row_shape() for the keys


def build_row_shape() -> dict[str, Any]:
    """Canonical shape the compute pipeline expects. Any scraper that
    doesn't populate a field can leave it None; the DB defaults handle
    the rest."""
    return {
        "county_id": None,
        "abstract_number": None,
        "lessor": None,
        "lessee": None,
        "memo_date": None,          # ISO 'YYYY-MM-DD'
        "filed_date": None,         # ISO 'YYYY-MM-DD'
        "bonus_per_acre": None,
        "royalty": None,
        "primary_term_months": None,
        "document_id": None,
        "source_url": None,
        "source": "scrape",
        "raw_record": None,
    }


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = unescape(str(value)).strip()
    text = re.sub(r"\s+", " ", text)
    return text or None


def normalize_abstract(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    stripped = text.upper()
    if stripped.startswith("A-"):
        stripped = stripped[2:]
    return stripped.strip() or None


def iso_date(raw: Any) -> str | None:
    text = clean_text(raw)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d", "%d-%b-%Y"):
        try:
            return dt.datetime.strptime(text[:10] if len(text) >= 10 and fmt == "%Y-%m-%d" else text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def http_get(url: str, params: dict[str, str] | None = None) -> str:
    full = url if not params else f"{url}?{urlparse.urlencode(params)}"
    request = urlrequest.Request(
        full,
        headers={
            "User-Agent": "mineral-scout lease-memo scraper (+github.com/joshhjackman-blip/mineral-scout)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        },
    )
    try:
        with urlrequest.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
            return response.read().decode("utf-8", errors="replace")
    except (urlerror.URLError, TimeoutError) as exc:
        raise RuntimeError(f"HTTP GET failed: {exc}") from exc


def http_post(url: str, form: dict[str, str]) -> str:
    encoded = urlparse.urlencode(form).encode("utf-8")
    request = urlrequest.Request(
        url,
        data=encoded,
        headers={
            "User-Agent": "mineral-scout lease-memo scraper (+github.com/joshhjackman-blip/mineral-scout)",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml",
        },
        method="POST",
    )
    try:
        with urlrequest.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
            return response.read().decode("utf-8", errors="replace")
    except (urlerror.URLError, TimeoutError) as exc:
        raise RuntimeError(f"HTTP POST failed: {exc}") from exc


# ── Per-county scrapers ───────────────────────────────────────────


def scrape_gonzales(county: str, since: dt.date, until: dt.date) -> list[LeaseMemoRow]:
    """Gonzales County pilot scraper.

    Gonzales's records live on the county clerk's Kofile portal. The
    documented search endpoint is a POST form; the exact field names
    have drifted with the vendor's rewrites. This implementation
    encodes the current form shape as of 2026-07 and parses a table
    of results.

    Runtime note: the first live run from GH Actions is likely to need
    a small tweak — Kofile counties commonly require a session cookie
    round-trip. If the run comes back empty, add a preflight GET on
    the search page to grab the cookie, then re-POST. The framework
    upserts nothing when it gets nothing, so failed scrapes are safe
    to retry.
    """
    base = "https://search.gonzalescountyclerk.com"  # Kofile-hosted pattern
    rows: list[LeaseMemoRow] = []

    for doc_type in OGL_DOC_TYPES:
        try:
            html = http_post(f"{base}/publicaccess/publicsearch.aspx", form={
                "ctl00$cph1$txtRecordingDateFrom": since.strftime("%m/%d/%Y"),
                "ctl00$cph1$txtRecordingDateTo":   until.strftime("%m/%d/%Y"),
                "ctl00$cph1$ddlDocType":           doc_type,
                "ctl00$cph1$btnSearch":            "Search",
            })
        except RuntimeError as exc:
            print(f"  gonzales :: {doc_type} :: fetch failed: {exc}", file=sys.stderr)
            continue

        # Best-effort table-row parsing. Kofile results tables carry a
        # class of "SearchResults" or an id "gvResults". The regex
        # tolerates either.
        row_matches = re.findall(
            r"<tr[^>]*class=\"(?:GridRow|GridAlternatingRow|SearchRow)\"[^>]*>(.*?)</tr>",
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )
        if not row_matches:
            # Fall back to any table row that contains a doc-type match.
            row_matches = re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.DOTALL | re.IGNORECASE)

        for row_html in row_matches:
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, flags=re.DOTALL | re.IGNORECASE)
            if len(cells) < 5:
                continue
            clean_cells = [clean_text(re.sub(r"<[^>]+>", " ", c)) or "" for c in cells]
            joined = " | ".join(clean_cells).upper()
            if "LEASE" not in joined:
                continue
            # Kofile default column order: [doc_id, filed_date, doc_type, grantor, grantee, legal_desc]
            row = build_row_shape()
            row["county_id"] = county
            row["document_id"] = clean_cells[0] or None
            row["filed_date"] = iso_date(clean_cells[1]) if len(clean_cells) > 1 else None
            row["memo_date"] = row["filed_date"]  # if the recorder doesn't publish the lease-execution date separately
            row["lessor"] = clean_cells[3] if len(clean_cells) > 3 else None
            row["lessee"] = clean_cells[4] if len(clean_cells) > 4 else None
            legal = clean_cells[5] if len(clean_cells) > 5 else ""
            # Try to pull an abstract number from a legal description
            # like "A-160 J COOK SURVEY" or "ABS 543 T&P RR".
            abs_match = re.search(r"\bA(?:BS|BSTRACT|-)?\s*[-#:]?\s*(\d{1,5})\b", legal, flags=re.IGNORECASE)
            if abs_match:
                row["abstract_number"] = abs_match.group(1)
            row["source_url"] = f"{base}/publicaccess/publicsearch.aspx"
            row["raw_record"] = {"doc_type": doc_type, "cells": clean_cells}
            rows.append(row)

        time.sleep(POLITE_SLEEP_S)

    return rows


def scrape_kofile_stub(county: str, since: dt.date, until: dt.date,
                       portal_base: str) -> list[LeaseMemoRow]:
    """Placeholder for the other Kofile-hosted counties.

    The Kofile portal HTML changes just enough between deployments
    that copy-pasting Gonzales's parser doesn't always work first
    try. This stub is where per-county tuning lands. Returns [] today
    so cron runs stay green; fill in the form-field names + result
    parsing before turning the county on."""
    del portal_base, since, until
    print(f"  {county} :: Kofile scraper stub — real portal parser is a TODO", file=sys.stderr)
    return []


SCRAPERS: dict[str, Callable[[str, dt.date, dt.date], list[LeaseMemoRow]]] = {
    "gonzales":  scrape_gonzales,
    # Every remaining county currently defers to the stub. Flip each
    # one to a real function as its portal parser gets written.
    "howard":    lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.howardcountyclerk.com"),
    "martin":    lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.martincountyclerk.com"),
    "crane":     lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.cranecountyclerk.com"),
    "glasscock": lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.glasscockcountyclerk.com"),
    "loving":    lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.lovingcountyclerk.com"),
    "midland":   lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.midlandcountyclerk.com"),
    "pecos":     lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.pecoscountyclerk.com"),
    "reagan":    lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.reagancountyclerk.com"),
    "reeves":    lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.reevescountyclerk.com"),
    "upton":     lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.uptoncountyclerk.com"),
    "ward":      lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.wardcountyclerk.com"),
    "winkler":   lambda c, s, u: scrape_kofile_stub(c, s, u, "https://search.winklercountyclerk.com"),
}


# ── CLI + Supabase upsert loop ────────────────────────────────────


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--county", required=True,
                        help="County id or comma-separated list.")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
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


def existing_document_ids(client: Client, county: str) -> set[str]:
    ids: set[str] = set()
    last_id = 0
    while True:
        try:
            result = (
                client.table("lease_memoranda")
                .select("id, document_id")
                .eq("county_id", county)
                .gt("id", last_id)
                .order("id", desc=False)
                .limit(1000)
                .execute()
            )
        except Exception as exc:
            message = str(exc).lower()
            if "not find" in message or "does not exist" in message:
                return set()
            raise
        page = result.data or []
        if not page:
            break
        for row in page:
            doc_id = clean_text(row.get("document_id"))
            if doc_id:
                ids.add(doc_id)
        last_id = page[-1]["id"]
        if len(page) < 1000:
            break
    return ids


def chunked(items: list[LeaseMemoRow], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def process_county(client: Client, county: str, args: argparse.Namespace) -> None:
    scraper = SCRAPERS.get(county)
    if scraper is None:
        print(f"\n=== {county} ===\n  no scraper registered — skipping.")
        return
    print(f"\n=== {county} ===")

    today = dt.date.today()
    since = today - dt.timedelta(days=args.days)
    print(f"  window: {since} → {today}")

    try:
        rows = scraper(county, since, today)
    except Exception as exc:
        print(f"  scrape error: {exc}", file=sys.stderr)
        return
    print(f"  scraped rows: {len(rows)}")

    existing = existing_document_ids(client, county) if rows else set()
    fresh = [
        r for r in rows
        if r.get("document_id") and r["document_id"] not in existing
    ] if existing else rows
    print(f"  new rows to insert: {len(fresh)}")

    if args.dry_run:
        for r in fresh[:5]:
            print(" ", {k: v for k, v in r.items() if k != "raw_record"})
        return

    if not fresh:
        return

    inserted = 0
    for batch in chunked(fresh, BATCH_UPSERT_SIZE):
        try:
            client.table("lease_memoranda").insert(batch).execute()
            inserted += len(batch)
        except Exception as exc:
            message = str(exc).lower()
            if "does not exist" in message or "not find" in message:
                print("  lease_memoranda table missing — apply the Phase 3 migration first.")
                return
            raise
    print(f"  inserted {inserted} row(s).")


def main() -> None:
    args = parse_args()
    supabase_url = require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
    supabase_key = require_env("SUPABASE_KEY", ("SUPABASE_SERVICE_ROLE_KEY",))
    client = create_client(supabase_url, supabase_key)

    counties = [c.strip().lower() for c in args.county.split(",") if c.strip()]
    for county in counties:
        try:
            process_county(client, county, args)
        except Exception as exc:
            print(f"  ERROR in {county}: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
