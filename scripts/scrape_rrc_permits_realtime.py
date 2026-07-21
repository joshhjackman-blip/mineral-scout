#!/usr/bin/env python3
"""Real-time drilling-permit scrape via the RRC EWA public web query.

This is the "fresh permits" data path, complementary to
scrape_rrc_permits.py (which pulls historical bulk data from the
monthly EWA CSV snapshot + wells-zip). The EWA HTML endpoint is
the ONLY public source that surfaces permits filed in the last
0-30 days — the bulk CSV lags by 4-12 weeks, and the /DP/
endpoint that the old scraper used sits behind /security since
mid-2025.

Endpoint
--------
Public struts-based query at:
    https://webapps2.rrc.texas.gov/EWA/drillingPermitsQueryAction.do

POST with pager.pageSize=-1 to get every result in one shot; each
result row is 14 columns: API, links dropdown, district code, lease
name (with permit-detail link), wellbore designator, operator
name (with P-5 code), county, submitted/approved dates block,
permit number, permit type, purpose, horizontal flag, total depth,
amend indicator, status.

Runtime
-------
    # One county, last 30 days
    python3 scripts/scrape_rrc_permits_realtime.py --county howard

    # All counties in the daily cron
    python3 scripts/scrape_rrc_permits_realtime.py \
        --county gonzales,howard,martin,midland,glasscock,upton,reagan,\
crane,pecos,ward,winkler,loving,reeves --days 30

    # Dry-run (print what would upsert, skip Supabase)
    python3 scripts/scrape_rrc_permits_realtime.py --county howard --dry-run

Merge strategy
--------------
Upsert on api_number. Rows already in <county>_permits (from the
wells-zip + EWA bulk path) keep their lat/lon and historical
fields; the EWA HTML scrape refreshes operator / lease /
permit_number / approved_date / filed_date / permit_type / status.
Net effect over time: historical rows keep their spud/completion
dates, brand-new rows land with fresh metadata but null lat/lon
until the wells-zip picks them up on the next monthly run.
"""

from __future__ import annotations

import argparse
import datetime as dt
import math
import os
import re
import sys
import time
from typing import Any

import requests
from bs4 import BeautifulSoup
from supabase import Client, create_client

BASE = "https://webapps2.rrc.texas.gov"
SEARCH_PATH = "/EWA/drillingPermitsQueryAction.do"
BATCH_SIZE = 500
POLITE_SLEEP_S = 1.0

# Optional proxy hook. When SCRAPINGBEE_API_KEY is set in the
# environment (usually via a GitHub Actions secret) every request in
# this scraper is routed through ScrapingBee's residential IP pool
# instead of hitting webapps2.rrc.texas.gov directly. GitHub Actions
# runner IPs are silently blocked by the RRC EWA endpoint — five
# consecutive daily-cron failures with "Connection refused" is what
# motivated this hook (see the 2026-07-16 → 07-20 workflow logs).
#
# When the key is absent, requests fall through to a direct
# connection so local development / self-hosted runners on
# non-blocked IPs keep working with zero configuration.
#
# Implementation history: the first attempt (2026-07-21 evening) hand-
# rolled URL wrapping via `?api_key=&url=&method=POST` on the raw
# ScrapingBee REST endpoint. That worked for GETs but every POST came
# back HTTP 500 — turns out `method=POST` + `premium_proxy=true` +
# session-cookied J2EE URLs (RRC bakes JSESSIONID into the URL path
# via `;jsessionid=...`) doesn't play nicely with the raw endpoint.
# Switched to the official `scrapingbee` Python SDK which handles
# POST + cookie forwarding + IP-sticky sessions in the same call
# and both request types now succeed.
SCRAPINGBEE_API_KEY = os.environ.get("SCRAPINGBEE_API_KEY", "").strip()


class HttpSession:
    """Thin wrapper that hides whether we're going through ScrapingBee
    or hitting RRC directly. Exposes just the two verbs the scraper
    needs: `get(url)` and `post(url, data)`. Both return objects with
    `.status_code` / `.text` / `.raise_for_status()` — same shape as
    `requests.Response` so downstream parsing code doesn't care.

    - Direct mode (no API key): a plain `requests.Session` with an
      RRC-friendly UA + Accept header.
    - Proxy mode (key present): a `ScrapingBeeClient` with a stable
      `session_id` so ScrapingBee holds the same exit IP and the
      RRC JSESSIONID cookie across the GET-form / POST-search
      sequence. `premium_proxy=True` selects residential IPs which
      is what RRC's filter is actually looking for; standard
      datacenter proxies get the same block as GitHub Actions.
    """

    def __init__(self):
        if SCRAPINGBEE_API_KEY:
            # Deferred import so `pip install scrapingbee` can be
            # skipped entirely on machines that don't proxy.
            from scrapingbee import ScrapingBeeClient
            self._sb = ScrapingBeeClient(api_key=SCRAPINGBEE_API_KEY)
            # Sticky session so a single ScrapingBee residential IP
            # + cookie jar handles the whole run. RRC JSESSIONID
            # cookies are only valid for the exit IP that received
            # them; without a sticky session, ScrapingBee would
            # rotate exit IPs between requests and every POST would
            # 500 with "invalid session".
            #
            # session_id must be a POSITIVE INTEGER (ScrapingBee
            # 400s on string session ids; verified 2026-07-21).
            # Truncate the epoch to fit under their int32 cap and
            # to keep the id short. Value is opaque — the only
            # requirement is that it stays stable for the run.
            self._session_id = int(time.time()) % 2_000_000_000
            self._sess = None
            # ScrapingBee's Python SDK expects Python-native booleans
            # for its boolean flags; passing "true"/"false" strings
            # got 400 Bad Request from their validator.
            self._proxy_params: dict[str, Any] = {
                "premium_proxy": True,
                "render_js": False,
                "session_id": self._session_id,
            }
        else:
            self._sb = None
            self._sess = requests.Session()
            self._sess.headers.update({
                "User-Agent": (
                    "Mozilla/5.0 (compatible; mineral-scout/1.0 permits-scraper; "
                    "+github.com/joshhjackman-blip/mineral-scout)"
                ),
                "Accept": "text/html,application/xhtml+xml",
            })
            self._proxy_params = {}

    @property
    def via_proxy(self) -> bool:
        return self._sb is not None

    def get(self, url: str, timeout: int = 60):
        if self._sb:
            return self._sb.get(url, params=self._proxy_params, timeout=timeout)
        assert self._sess is not None
        return self._sess.get(url, timeout=timeout)

    def post(self, url: str, data: dict[str, str] | None = None, timeout: int = 180):
        if self._sb:
            # ScrapingBee POST saga:
            #   R3 (raw premium)             -> SSLError
            #   R4 (render_js + premium)     -> same SSLError
            #   R5 (render_js + datacenter)  -> same SSLError,
            #                                   BUT ScrapingBee's
            #                                   error hint now
            #                                   suggested
            #                                   stealth_proxy=True
            #                                   as an option we
            #                                   hadn't tried.
            #
            # Round 6: stealth_proxy=True. ScrapingBee's advanced
            # anti-bot tier — different residential IP pool than
            # premium_proxy, Chrome browser fingerprint applied
            # consistently, distinct TLS config on the exit side.
            # Explicitly recommended by ScrapingBee's own error
            # response as the escalation from premium.
            #
            # Cost: 75 credits/request (same as premium+render_js
            # was). At 12 counties x 1 run/day x 30 days = ~27k
            # credits/mo, well within the $49 tier.
            #
            # If this STILL 500s, the response-body diagnostic will
            # spell out the specific reason and the only remaining
            # play from ScrapingBee's side is js_scenario. If
            # ScrapingBee never works with RRC period, we pivot to
            # RRC's alternative bulk-data downloads (MFT server)
            # entirely.
            post_params: dict[str, Any] = {
                "session_id": self._session_id,
                "stealth_proxy": True,
                # render_js implicitly on for stealth_proxy per
                # their docs, but keeping the flag explicit so
                # future readers of this code don't have to look
                # it up.
                "render_js": True,
                "forward_headers": True,
                "wait": 5000,
            }
            return self._sb.post(
                url,
                params=post_params,
                data=data or {},
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
                timeout=timeout,
            )
        assert self._sess is not None
        return self._sess.post(url, data=data, timeout=timeout)

# RRC uses last-3-digits-of-Texas-FIPS as its county code.
COUNTY_FIPS = {
    "gonzales":  "177",
    "howard":    "227",
    "martin":    "317",
    "midland":   "329",
    "glasscock": "173",
    "upton":     "461",
    "reagan":    "383",
    "crane":     "103",
    "pecos":     "371",
    "ward":      "475",
    "winkler":   "495",
    "loving":    "301",
    "reeves":    "389",
}

# Static form fields required to satisfy the struts action even when
# left blank. Missing any of these causes RRC's form validator to
# quietly redisplay the search form instead of returning results.
BLANK_FORM_FIELDS = (
    "searchArgs.permitStatusNoHndlr.inputValue",
    "searchArgs.apiNoHndlr.inputValue",
    "searchArgs.districtCodeHndlr.selectedCodes",
    "searchArgs.npzFlagHndlr.inputValue",
    "searchArgs.offLeaseSurfLocFlagHndlr.inputValue",
    "searchArgs.offLeasePntrnPtFlagHndlr.inputValue",
    "searchArgs.operatorNameWildcardHndlr.inputValue",
    "searchArgs.operatorNameHndlr.inputValue",
    "searchArgs.operatorNoHndlr.inputValue",
    "searchArgs.leaseNameWildcardHndlr.inputValue",
    "searchArgs.leaseNameHndlr.inputValue",
    "searchArgs.leaseNoHndlr.inputValue",
    "searchArgs.wellNoHndlr.inputValue",
    "searchArgs.fieldNameWildcardHndlr.inputValue",
    "searchArgs.fieldNameHndlr.inputValue",
    "searchArgs.fieldNoHndlr.inputValue",
    "searchArgs.surveyNameWildcardHndlr.inputValue",
    "searchArgs.surveyNameHndlr.inputValue",
    "searchArgs.approvedDtFromHndlr.inputValue",
    "searchArgs.approvedDtToHndlr.inputValue",
    "searchArgs.stackedLateralFlagHndlr.inputValue",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--county", required=True,
                        help="County id or comma-separated list.")
    parser.add_argument("--days", type=int, default=30,
                        help="Lookback window in days (RRC caps at ~90).")
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


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def normalize_api(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    digits = "".join(c for c in str(value) if c.isdigit())
    return (digits.lstrip("0") or "0") if digits else None


def parse_us_date(raw: str) -> str | None:
    """MM/DD/YYYY -> ISO YYYY-MM-DD, or None if unparseable."""
    text = clean_text(raw) or ""
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", text)
    if not m:
        return None
    mm, dd, yyyy = m.groups()
    try:
        dt.date(int(yyyy), int(mm), int(dd))
    except ValueError:
        return None
    return f"{yyyy}-{mm}-{dd}"


def open_search_session() -> tuple[HttpSession, str]:
    """GET the query form to grab a JSESSIONID (either in URL path or
    as a cookie), then return the CLEAN action URL for the follow-up
    POST. Works over both the direct-connection path and the
    ScrapingBee proxy path (session cookie is preserved via
    ScrapingBee's `session_id` parameter in the latter case).

    JSESSIONID stripping (2026-07-21): RRC's J2EE app rewrites the
    form action to include the session as a matrix parameter
    (`/EWA/drillingPermitsQueryAction.do;jsessionid=<id>`) for
    cookieless clients. ScrapingBee's premium proxy 500s when
    forwarding POST requests to URLs with matrix parameters —
    their parser doesn't handle `;key=value` syntax reliably. Since
    ScrapingBee is already tracking the JSESSIONID cookie for us
    (via the `session_id` parameter, which pins the exit IP and
    cookie jar for the run), we can safely strip the matrix
    parameter and rely on the cookie. The direct-connection path
    (no proxy) preserves cookies via requests.Session, so it works
    the same way.
    """
    sess = HttpSession()
    r = sess.get(f"{BASE}{SEARCH_PATH}")
    r.raise_for_status()
    m = re.search(r'<form[^>]+action="([^"]+)"', r.text)
    if not m:
        raise RuntimeError("RRC EWA form not found; endpoint layout may have changed")
    action = m.group(1)
    # Strip ";jsessionid=<id>" from the action path. Everything from
    # the semicolon up to the next `?` (or end of URL) is the matrix
    # parameter.
    action_clean = re.sub(r";jsessionid=[^?]*", "", action, flags=re.IGNORECASE)
    return sess, f"{BASE}{action_clean}"


def query_county(sess: HttpSession, action: str, county_fips: str,
                 days: int) -> str:
    """POST a single-county date-window query and return the results
    HTML body. HttpSession handles proxy routing + session cookies
    transparently."""
    today = dt.date.today()
    since = today - dt.timedelta(days=days)
    form = {
        "methodToCall": "search",
        "searchArgs.countyCodeHndlr.selectedCodes": county_fips,
        "searchArgs.submittedDtFromHndlr.inputValue": since.strftime("%m/%d/%Y"),
        "searchArgs.submittedDtToHndlr.inputValue": today.strftime("%m/%d/%Y"),
        "pager.pageSize": "-1",  # View All
    }
    for k in BLANK_FORM_FIELDS:
        form.setdefault(k, "")
    r = sess.post(action, data=form)
    r.raise_for_status()
    return r.text


# --- Result parsing --------------------------------------------------

def parse_permit_rows(html: str, county_fips: str) -> list[dict[str, Any]]:
    """Return a list of permit dicts ready to upsert.

    RRC's results page nests inner <table> elements inside the API
    and Lease cells (for the P-5 code link, the "Links" dropdown,
    etc.). A raw regex on <td>...</td> counts the nested cells, so
    we use BeautifulSoup and only walk DIRECT children of each row.

    Verified against a live Howard response (2026-07-17): every
    permit row is a <tr> with exactly 14 direct-child <td>s, in
    this order:

       [0] API + Links dropdown -> api_number (parse the 8-digit
                                   number at the start of the cell)
       [1] District code
       [2] Lease name           -> lease_name (with an inner <a>
                                   whose href carries the
                                   universalDocNo permit reference)
       [3] Well # / wellbore
       [4] Operator (P-5 code)  -> operator_name (strip trailing
                                   "(NNNNNN)" P-5 org code)
       [5] County name (redundant with FIPS, skipped)
       [6] Submitted/Approved   -> filed_date / approved_date
       [7] Permit number        -> permit_number
       [8] Wellbore profile     -> permit_type
       [9] Purpose              -> appended to permit_type
       [10] Amend flag
       [11] Total depth
       [12] (unused)
       [13] Current status      -> status
    """
    soup = BeautifulSoup(html, "lxml")
    grid = soup.find("table", class_="DataGrid")
    if not grid:
        return []

    # Result rows are the ones with exactly 14 top-level <td>s.
    # Pager banner and header rows have different counts, so the
    # 14-cell filter cleanly discards them.
    rows: list[dict[str, Any]] = []
    for tr in grid.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) != 14:
            continue

        def txt(cell) -> str:
            return re.sub(r"\s+", " ", cell.get_text(" ")).strip()

        # [0] API cell — take the first 7-8 digit sequence at the
        # start (the Links dropdown text ("Links Images GIS Viewer
        # Completion") follows it, which we drop).
        api_text = txt(tds[0])
        api_match = re.match(r"(\d{7,8})", api_text)
        api = normalize_api(api_match.group(1)) if api_match else None
        if not api:
            continue

        lease_name = txt(tds[2]) or None
        operator_raw = txt(tds[4])
        operator_name = re.sub(r"\s*\(\d{4,7}\)\s*$", "", operator_raw) or None

        # Dates cell like "Submitted: 05/20/2026 Approved: 07/01/2026"
        sa_text = txt(tds[6])
        submitted = None
        approved = None
        m_sub = re.search(r"Submitted:\s*(\d{2}/\d{2}/\d{4})", sa_text)
        m_app = re.search(r"Approved:\s*(\d{2}/\d{2}/\d{4})", sa_text)
        if m_sub:
            submitted = parse_us_date(m_sub.group(1))
        if m_app:
            approved = parse_us_date(m_app.group(1))

        permit_number = txt(tds[7]) or None

        permit_type_parts = [txt(tds[8]), txt(tds[9])]
        permit_type = " · ".join(p for p in permit_type_parts if p) or None

        status_text = txt(tds[13])
        status = status_text.upper() if status_text else None
        if status and len(status) > 32:
            status = status[:32]

        rows.append({
            "api_number":    api,
            "permit_number": permit_number,
            "operator_name": operator_name,
            "lease_name":    lease_name,
            "county_code":   county_fips,
            "permit_type":   permit_type,
            "status":        status,
            "filed_date":    submitted,
            "approved_date": approved,
            "source":        "ewa_html",
        })
    return rows


# --- Supabase writes -------------------------------------------------

def existing_by_api(client: Client, table: str) -> dict[str, int]:
    existing: dict[str, int] = {}
    last_id = 0
    while True:
        try:
            r = (
                client.table(table)
                .select("id, api_number")
                .gt("id", last_id)
                .order("id", desc=False)
                .limit(1000)
                .execute()
            )
        except Exception as exc:
            msg = str(exc).lower()
            if "not find" in msg or "does not exist" in msg:
                return {}
            raise
        page = r.data or []
        if not page:
            break
        for row in page:
            api = normalize_api(row.get("api_number"))
            if api:
                existing.setdefault(api, row["id"])
        last_id = page[-1]["id"]
        if len(page) < 1000:
            break
    return existing


def upsert_permits(client: Client, table: str, rows: list[dict[str, Any]]) -> tuple[int, int]:
    """Return (inserted, updated). Uses api_number as the merge key;
    fields absent from the payload leave the existing DB value alone."""
    existing = existing_by_api(client, table)

    # Drop the source-tag column when writing so we don't require a
    # migration to add a `source` column to every existing county's
    # permits table. Keep track of it in memory for debugging.
    def strip_source(payload: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in payload.items() if k != "source"}

    to_insert: list[dict[str, Any]] = []
    to_update: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        api = row.get("api_number")
        if api and api in existing:
            to_update.append((existing[api], strip_source(row)))
        else:
            to_insert.append(strip_source(row))

    inserted = 0
    if to_insert:
        for i in range(0, len(to_insert), BATCH_SIZE):
            batch = to_insert[i:i + BATCH_SIZE]
            try:
                client.table(table).insert(batch).execute()
                inserted += len(batch)
            except Exception as exc:
                msg = str(exc).lower()
                if "not find" in msg or "does not exist" in msg:
                    print(f"  {table} does not exist yet — skip.")
                    return (0, 0)
                raise

    updated = 0
    for row_id, payload in to_update:
        try:
            client.table(table).update(payload).eq("id", row_id).execute()
            updated += 1
        except Exception as exc:
            msg = str(exc).lower()
            if "column" in msg and ("does not exist" in msg or "not find" in msg):
                # Fall back to a minimum column set for older schemas.
                minimal = {k: v for k, v in payload.items()
                           if k in {"api_number", "permit_number", "operator_name",
                                    "lease_name", "county_code", "permit_type",
                                    "status", "filed_date", "approved_date"}}
                client.table(table).update(minimal).eq("id", row_id).execute()
                updated += 1
            else:
                raise
    return (inserted, updated)


# --- Per-county process ---------------------------------------------

def process_county(client: Client, sess: HttpSession, action: str,
                   county: str, args: argparse.Namespace) -> None:
    fips = COUNTY_FIPS.get(county)
    if not fips:
        raise ValueError(f"Unknown county '{county}'; add its FIPS to COUNTY_FIPS.")
    table = f"{county}_permits"

    print(f"\n=== {county} (FIPS {fips}) → {table} ===")
    try:
        html = query_county(sess, action, fips, args.days)
    except requests.RequestException as exc:
        print(f"  RRC EWA fetch failed: {exc}", file=sys.stderr)
        # Response body diagnostic — ScrapingBee returns JSON with an
        # error message when it 500s, but requests's raise_for_status
        # drops the body. Retrieve it from the exception's .response
        # attribute so we can see what actually broke.
        resp = getattr(exc, "response", None)
        if resp is not None:
            try:
                body = resp.text[:500]
                print(f"  response body: {body}", file=sys.stderr)
            except Exception:
                pass
        return

    rows = parse_permit_rows(html, fips)
    print(f"  parsed {len(rows)} permits from last {args.days} days")

    if args.dry_run:
        for r in rows[:5]:
            preview = {k: v for k, v in r.items() if v}
            print(f"  {preview}")
        print(f"  (dry-run) would upsert {len(rows)} rows")
        return

    if not rows:
        return

    ins, upd = upsert_permits(client, table, rows)
    print(f"  inserted {ins}, updated {upd}")


def main() -> None:
    args = parse_args()
    supabase_url = require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
    supabase_key = require_env("SUPABASE_SERVICE_ROLE_KEY", ("SUPABASE_KEY",))
    client = create_client(supabase_url, supabase_key)

    counties = [c.strip() for c in args.county.split(",") if c.strip()]
    if not counties:
        print("No counties provided.")
        sys.exit(1)

    sess, action = open_search_session()
    print(f"RRC EWA session opened at {action[:120]}")

    for county in counties:
        try:
            process_county(client, sess, action, county, args)
        except Exception as exc:
            print(f"!! {county} failed: {exc}", file=sys.stderr)
        time.sleep(POLITE_SLEEP_S)


if __name__ == "__main__":
    main()
