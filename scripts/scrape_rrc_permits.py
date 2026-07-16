#!/usr/bin/env python3
"""Scrape the RRC public Drilling Permit Query for a given county and
upsert new / changed permits into ``<county>_permits``.

Designed to run daily on a cron so the Mapbox "New Permits" dropdown +
the parcels ``production_status`` classifier always reflect the last
few days of RRC filings.

Data source
-----------
The public query at
``https://webapps.rrc.texas.gov/DP/publicSearchAction.do`` accepts a
county code and returns an HTML table of permits filed within the last
N days. This scraper parses the table and normalizes each row into the
same schema ``scripts/load_county_permits.py`` writes:

    permit_number, api_number, operator_name, lease_name, county_code,
    latitude, longitude, permit_type, status, filed_date, approved_date

If the HTML endpoint is unreachable or its markup shifts (RRC has
historically rewritten the page every few years) the scraper falls
back to ``--from-wells-zip`` mode — same as ``load_county_permits.py``
— so daily runs never fail silently: SYMNUM-derived permit rows land
in the table even if the HTML feed is broken.

Latitude / longitude
--------------------
The RRC permit HTML doesn't publish lat/lon directly. When the row
carries an API number, we look the point up in the county's already-
downloaded well surface shapefile (Raw-Data/well{FIPS}.zip). Rows with
no API stay lat/lon-null; they still count towards ``<county>_permits``
so the county-level dropdown lists them, but they won't survive the
tract point-in-polygon filter.

Usage
-----
::

    # Scrape a single county and upsert to Supabase
    python3 scripts/scrape_rrc_permits.py --county howard

    # Multiple counties in one run (used by the daily GH Actions cron)
    python3 scripts/scrape_rrc_permits.py --county howard,martin,gonzales

    # Widen the lookback window (default: 30 days). The RRC search
    # endpoint caps at ~90 days.
    python3 scripts/scrape_rrc_permits.py --county howard --days 60

    # Dry-run: print what would be inserted / updated, but don't write.
    python3 scripts/scrape_rrc_permits.py --county howard --dry-run

    # Force the wells-zip fallback (skips the HTML fetch entirely).
    python3 scripts/scrape_rrc_permits.py --county howard --wells-only
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import io
import math
import os
import re
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any, Iterable

from supabase import Client, create_client

BUCKET_NAME = "Raw-Data"
BATCH_SIZE = 500

COUNTY_FIPS = {
    "gonzales": "177",
    "howard":   "227",
    "martin":   "317",
    # 10 new Permian counties from the earlier tasks; the migration in PR #25
    # only creates howard_permits / martin_permits so far, but plumbing the
    # scraper for the other counties now avoids another round-trip once
    # their <county>_permits tables land.
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

RRC_SEARCH_URL = "https://webapps.rrc.texas.gov/DP/publicSearchAction.do"

# Same SYMNUM -> (status, permit_type) mapping the loader uses so both
# ingestion paths produce consistent rows.
WELLS_SYMNUM_PERMIT = {
    1:   ("APPROVED", "Permit — location"),
    11:  ("APPROVED", "Permit — dry hole location"),
    21:  ("PENDING",  "Drilling"),
    87:  ("APPROVED", "Permit — horizontal"),
    116: ("APPROVED", "Permit — horizontal completed"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--county",
        required=True,
        help="County id (e.g. howard) or a comma-separated list "
             "(howard,martin,gonzales) — one Supabase upsert per county.",
    )
    parser.add_argument("--days", type=int, default=30,
                        help="Lookback window for the RRC HTML query.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--wells-only", action="store_true",
                        help="Skip the HTML fetch and go straight to the "
                             "wellNNN.zip SYMNUM fallback.")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--timeout", type=int, default=45)
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


def normalize_api(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return (digits.lstrip("0") or "0") if digits else None


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = html.unescape(str(value)).strip()
    text = re.sub(r"\s+", " ", text)
    return text or None


def to_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        result = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result


def _http_post(url: str, data: dict[str, str], timeout: int) -> str:
    """POST form data and return the response body as text.

    Deliberately stdlib-only: the daily cron shouldn't need pip installs
    beyond what the existing scripts already pull in (requests isn't a
    workspace dep). urllib is enough here.
    """
    import urllib.error
    import urllib.parse
    import urllib.request

    encoded = urllib.parse.urlencode(data).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=encoded,
        headers={
            "User-Agent": "mineral-scout permits scraper (+github.com/joshhjackman-blip/mineral-scout)",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"RRC fetch failed: {exc}") from exc


def scrape_rrc_html(fips: str, days: int, timeout: int) -> list[dict[str, Any]]:
    """POST the RRC public drilling-permit form and parse the resulting
    HTML table. Returns a list of raw permit dicts.

    RRC has changed field names and templates several times; the parser
    below tries several row layouts and returns an empty list on any
    unrecoverable shape change. When that happens the caller falls back
    to the wells-zip SYMNUM extractor so daily cron always produces
    something.
    """
    now = dt.date.today()
    start = now - dt.timedelta(days=days)
    form = {
        # RRC form fields observed from the public query page. The
        # exact names have drifted before — if RRC rewrites the page
        # again this helper returns [] and the caller degrades to the
        # wells-zip fallback rather than crashing the cron.
        "submit": "Submit",
        "methodSearch": "1",
        "searchType": "county",
        "countyValue": fips,
        "beginDate": start.strftime("%m/%d/%Y"),
        "endDate":   now.strftime("%m/%d/%Y"),
    }

    try:
        body = _http_post(RRC_SEARCH_URL, form, timeout=timeout)
    except RuntimeError as exc:
        print(f"  rrc html fetch error: {exc}", file=sys.stderr)
        return []

    # Extract every <tr> group and inspect the cell texts. RRC results
    # tables carry column headers that end with 'Status' / 'Filed' /
    # 'API'; we key on that rather than positional indexes so a shifted
    # column order doesn't silently misalign.
    rows_html = re.findall(r"<tr\b[^>]*>(.*?)</tr>", body, flags=re.IGNORECASE | re.DOTALL)
    if not rows_html:
        return []

    header: list[str] = []
    permits: list[dict[str, Any]] = []
    for row_html in rows_html:
        cells = re.findall(r"<t[hd]\b[^>]*>(.*?)</t[hd]>", row_html, flags=re.IGNORECASE | re.DOTALL)
        if not cells:
            continue
        cleaned = [clean_text(re.sub(r"<[^>]+>", " ", cell)) or "" for cell in cells]
        if not header:
            lowered = [c.lower() for c in cleaned]
            if any("permit" in c or "api" in c or "operator" in c for c in lowered):
                header = lowered
                continue
        if header and len(cleaned) == len(header):
            record = dict(zip(header, cleaned))
            permits.append(record)

    return permits


def normalize_rrc_row(raw: dict[str, Any], county_fips: str) -> dict[str, Any]:
    def pick(*needles: str) -> str | None:
        for key, value in raw.items():
            for needle in needles:
                if needle in key:
                    return clean_text(value)
        return None

    return {
        "permit_number": pick("permit no", "permit number", "permitnumber", "permit #"),
        "api_number":    normalize_api(pick("api no", "api")),
        "operator_name": pick("operator"),
        "lease_name":    pick("lease", "well name"),
        "county_code":   county_fips,
        "latitude":      None,
        "longitude":     None,
        "permit_type":   pick("purpose", "permit type", "record type"),
        "status":        pick("status"),
        "filed_date":    pick("filed", "filing date"),
        "approved_date": pick("approved", "approval date", "issued"),
    }


def api_coordinate_index(zip_path: Path) -> dict[str, tuple[float, float]]:
    """Return API -> (longitude, latitude) so HTML rows without lat/lon
    can borrow the coordinate from the RRC well surface shapefile."""
    import shapefile  # pyshp

    coords: dict[str, tuple[float, float]] = {}
    if not zip_path.exists():
        return coords
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(tmp)
        surface = next(
            (p for p in Path(tmp).rglob("*.shp") if p.stem.lower().endswith("s")),
            None,
        )
        if surface is None:
            return coords
        reader = shapefile.Reader(str(surface.with_suffix("")))
        field_names = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
        idx_api = field_names.index("API") if "API" in field_names else None
        idx_lat = field_names.index("LAT83") if "LAT83" in field_names else None
        idx_long = field_names.index("LONG83") if "LONG83" in field_names else None
        if idx_api is None or idx_lat is None or idx_long is None:
            return coords
        for record in reader.iterRecords():
            api = normalize_api(record[idx_api])
            if not api:
                continue
            lat = to_number(record[idx_lat])
            lon = to_number(record[idx_long])
            if lat is None or lon is None:
                continue
            coords.setdefault(api, (lon, lat))
    return coords


def rows_from_wells_zip(zip_path: Path, county_fips: str) -> Iterable[dict[str, Any]]:
    import shapefile  # pyshp
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(tmp)
        surface = next(
            (p for p in Path(tmp).rglob("*.shp") if p.stem.lower().endswith("s")),
            None,
        )
        if surface is None:
            return
        reader = shapefile.Reader(str(surface.with_suffix("")))
        field_names = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
        idx_api = field_names.index("API") if "API" in field_names else None
        idx_symnum = field_names.index("SYMNUM") if "SYMNUM" in field_names else None
        idx_lat = field_names.index("LAT83") if "LAT83" in field_names else None
        idx_long = field_names.index("LONG83") if "LONG83" in field_names else None
        for record in reader.iterRecords():
            symnum = int(record[idx_symnum]) if idx_symnum is not None else None
            if symnum not in WELLS_SYMNUM_PERMIT:
                continue
            status, permit_type = WELLS_SYMNUM_PERMIT[symnum]
            yield {
                "api_number":    normalize_api(record[idx_api]) if idx_api is not None else None,
                "permit_number": None,
                "operator_name": None,
                "lease_name":    None,
                "county_code":   county_fips,
                "latitude":      to_number(record[idx_lat]) if idx_lat is not None else None,
                "longitude":     to_number(record[idx_long]) if idx_long is not None else None,
                "permit_type":   permit_type,
                "status":        status,
                "filed_date":    None,
                "approved_date": None,
            }


def ensure_wells_zip(county: str, fips: str, client: Client, data_dir: Path) -> Path:
    cached = data_dir / f"well{fips}.zip"
    if cached.exists():
        return cached
    key = f"well{fips}.zip"
    print(f"  downloading {BUCKET_NAME}/{key}...")
    blob = client.storage.from_(BUCKET_NAME).download(key)
    data_dir.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(blob)
    return cached


def existing_api_map(client: Client, table: str) -> dict[str, int]:
    existing: dict[str, int] = {}
    last_id = 0
    while True:
        try:
            result = (
                client.table(table)
                .select("id, api_number")
                .gt("id", last_id)
                .order("id", desc=False)
                .limit(1000)
                .execute()
            )
        except Exception as exc:
            message = str(exc).lower()
            if "not find" in message or "does not exist" in message:
                return {}
            raise
        page = result.data or []
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


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def process_county(client: Client, county: str, args: argparse.Namespace) -> None:
    fips = COUNTY_FIPS.get(county)
    if not fips:
        raise ValueError(f"Unknown county '{county}'; add its FIPS to COUNTY_FIPS.")
    table = f"{county}_permits"
    data_dir = Path(args.data_dir)

    print(f"\n=== {county} (FIPS {fips}) → {table} ===")

    html_rows: list[dict[str, Any]] = []
    if not args.wells_only:
        raw_rows = scrape_rrc_html(fips, args.days, args.timeout)
        print(f"  RRC HTML rows: {len(raw_rows)}")
        html_rows = [normalize_rrc_row(r, fips) for r in raw_rows]

    if html_rows and any(row.get("api_number") for row in html_rows):
        # Backfill lat/lon by API from the county's well surface shapefile.
        # If it isn't already cached the first daily run downloads it once
        # and reuses the cached copy going forward.
        try:
            wells_zip = ensure_wells_zip(county, fips, client, data_dir)
            index = api_coordinate_index(wells_zip)
        except Exception as exc:
            print(f"  wells zip lookup failed ({exc}); skipping lat/lon backfill")
            index = {}
        matched = 0
        for row in html_rows:
            api = row.get("api_number")
            if api and api in index:
                lon, lat = index[api]
                row["longitude"] = lon
                row["latitude"] = lat
                matched += 1
        print(f"  matched lat/lon by API: {matched}")

    rows = html_rows
    if not rows:
        # Fallback: derive permit rows from RRC well SYMNUM.
        try:
            wells_zip = ensure_wells_zip(county, fips, client, data_dir)
            rows = list(rows_from_wells_zip(wells_zip, fips))
            print(f"  wells-zip fallback rows: {len(rows)}")
        except Exception as exc:
            print(f"  wells-zip fallback failed: {exc}")
            rows = []

    rows = [r for r in rows if any(v for k, v in r.items() if k != "county_code")]
    print(f"  prepared {len(rows)} permit rows")

    if args.dry_run:
        for r in rows[:5]:
            print("  ", r)
        return

    existing = existing_api_map(client, table)
    print(f"  existing rows in {table}: {len(existing)}")

    to_insert: list[dict[str, Any]] = []
    to_update: list[dict[str, Any]] = []
    for row in rows:
        api = row.get("api_number")
        if api and api in existing:
            to_update.append({**row, "id": existing[api]})
        else:
            to_insert.append(row)

    print(f"  insert: {len(to_insert)}   update: {len(to_update)}")

    inserted = 0
    for batch in chunked(to_insert, BATCH_SIZE):
        try:
            client.table(table).insert(batch).execute()
            inserted += len(batch)
        except Exception as exc:
            message = str(exc).lower()
            if "not find" in message or "does not exist" in message:
                print(f"  {table} does not exist yet — skip (apply migration first).")
                return
            raise
    if to_insert:
        print(f"  inserted {inserted}")

    updated = 0
    for entry in to_update:
        row_id = entry.pop("id")
        client.table(table).update(entry).eq("id", row_id).execute()
        updated += 1
    if to_update:
        print(f"  updated {updated}")


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
            # Never let one county tank the whole cron run.
            print(f"  ERROR processing {county}: {exc}", file=sys.stderr)
        time.sleep(1)


if __name__ == "__main__":
    main()
