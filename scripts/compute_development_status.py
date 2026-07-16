#!/usr/bin/env python3
"""Compute development_status + pud_score for every abstract in a county
and upsert into public.tract_development_status.

Implements Phases 1 + 2 + 3 of ticket 1.3 (PUD / Development-Status
Tracking). Runs after the daily RRC permits scrape so status transitions
propagate within 24h. See legal/ticket-1.3-pud-tracking-spec.md for the
full spec.

Signals in play
---------------
* Producing wells        (from <county>_wells)                  -> PDP
* Drilled-uncompleted    (well row w/o completion_date          -> PUD_DUC
                          or permit w/ spud_date but no
                          completion_date)
* Approved permit        (permit approved_date set,              -> PUD_PERMITTED
                          spud_date null, < 24 months old)
* Adjacent permit        (approved permit on a tract             -> +2 score
                          bordering this abstract)
* Infill spacing gap     (PHASE 2: gap > INFILL_GAP_MIN_FT       -> +2 score
                          between adjacent parallel laterals     -> PUD_INFILL
                          on this tract's producing unit)          if no stronger signal
* Recent lease memo      (PHASE 3: fresh county-recorder lease   -> +1 score
                          on this abstract, < 24 months old)     -> LEASING_ACTIVE
                                                                     if no stronger signal
* Operator dev program   (PHASE 3: operator with an active       -> +1 score
                          development program tagged by the
                          quarterly Claude operator agent)

Data sources:
* data/<county>/Abstracts.shp   — polygon per abstract, needed for
                                  point-in-polygon fallback + adjacency
* <county>_permits (Supabase)   — daily RRC scrape output
* <county>_wells   (Supabase)   — surface-well shapefile ingest

Usage
-----
::

    # Single county
    python3 scripts/compute_development_status.py --county howard

    # Multiple counties in one run (used by the GH Actions cron)
    python3 scripts/compute_development_status.py \
        --county gonzales,howard,martin

    # Dry-run: print the summary but skip the upsert
    python3 scripts/compute_development_status.py --county howard --dry-run
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import math
import os
import sys
import tempfile
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from supabase import Client, create_client

BUCKET_NAME = "Raw-Data"
PAGE_SIZE = 1000
BATCH_UPSERT_SIZE = 200

# Counties whose Abstracts.shp we know how to locate. Others get
# skipped with a NOTICE so cron runs stay green even when a Permian
# county's abstract shapefile hasn't landed yet.
COUNTY_FIPS = {
    "gonzales": "177",
    "howard":   "227",
    "martin":   "317",
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


def _resolve_fips(county: str) -> str | None:
    return COUNTY_FIPS.get(county)


def _resolve_wells_zip(county: str, fips: str | None, data_dir: Path,
                       client: Client) -> Path | None:
    if not fips:
        return None
    cached = data_dir / f"well{fips}.zip"
    if cached.exists():
        return cached
    key = f"well{fips}.zip"
    try:
        blob = client.storage.from_(BUCKET_NAME).download(key)
    except Exception as exc:
        print(f"  wells zip fetch failed ({key}): {exc}")
        return None
    data_dir.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(blob)
    return cached


COUNTY_ABSTRACTS_LOCAL = {
    "gonzales": "data/gonzales/Abstracts.shp",
    "howard":   "data/howard/Abstracts.shp",
    "martin":   "data/martin/Abstracts.shp",
}

# Counties whose Abstracts.shp lives inside a top-level bucket zip
# (Howard.zip, Martin.zip). Adjust when new counties' abstract files
# get added to Raw-Data.
COUNTY_ABSTRACTS_BUCKET = {
    "howard":   ("Howard.zip",   "Abstracts.shp"),
    "martin":   ("Martin.zip",   "Abstracts.shp"),
    "gonzales": ("Gonzales.zip", "Abstracts.shp"),
}

STATUS_PRIORITY = [
    "PDP",
    "PUD_DUC",
    "PUD_PERMITTED",
    "PUD_INFILL",       # populated in Phase 2
    "LEASING_ACTIVE",   # populated in Phase 3
    "FRONTIER",
]

# 24 months — permits older than this that never spud'd are considered
# expired (spec §PHASE 1A).
PERMIT_EXPIRY_MONTHS = 24

# Lease memoranda older than this contribute nothing (spec §PHASE 3).
LEASE_MEMO_AGE_MONTHS = 24

# PHASE 2 spacing thresholds.
#   INFILL_AZIMUTH_TOLERANCE_DEG — group laterals with parallel-ish
#   headings into the same field cluster before measuring spacing.
#   ±15° per spec §PHASE 2.
#   INFILL_GAP_MIN_FT — spec calls out Eagle Ford spacing of
#   330–660 ft between laterals; any adjacent same-cluster pair
#   more than 1,200 ft apart is flagged as an infill candidate.
INFILL_AZIMUTH_TOLERANCE_DEG = 15.0
INFILL_GAP_MIN_FT = 1200.0
INFILL_GAP_MAX_FT = 3600.0
FEET_PER_DEGREE_LAT = 364_000.0  # rough Texas-latitude conversion


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--county", required=True,
                        help="County id (e.g. howard) or comma-separated list.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--data-dir", default="data")
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


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    if not text or text.lower() in {"none", "null", "nan"}:
        return ""
    return text


def normalize_abstract(raw: Any) -> str:
    text = clean_text(raw)
    if not text:
        return ""
    # Accept "A-543", "a-543", "543", "  A-543  " etc.
    stripped = text.upper()
    if stripped.startswith("A-"):
        stripped = stripped[2:]
    return stripped.strip()


def parse_date(raw: Any) -> dt.date | None:
    text = clean_text(raw)
    if not text or text in {"0", "00000000"}:
        return None
    # Try ISO first
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%m/%d/%y",
                "%Y%m%d", "%d-%b-%Y", "%d-%b-%y"):
        try:
            return dt.datetime.strptime(text[:10] if fmt == "%Y-%m-%d" else text, fmt).date()
        except ValueError:
            continue
    # Numeric-only YYYYMMDD (RRC often)
    if text.isdigit() and len(text) == 8:
        try:
            return dt.date(int(text[:4]), int(text[4:6]), int(text[6:8]))
        except ValueError:
            return None
    return None


def month_diff(a: dt.date, b: dt.date) -> int:
    return (a.year - b.year) * 12 + (a.month - b.month)


def load_abstract_polygons(county: str, data_dir: Path,
                           client: Client) -> list[dict[str, Any]]:
    """Return [{'abstract': '543', 'geom': shapely}], loading from local
    data/ if present, otherwise from the Raw-Data bucket.
    """
    import geopandas as gpd

    local_path = Path(COUNTY_ABSTRACTS_LOCAL.get(county, f"data/{county}/Abstracts.shp"))
    if not local_path.exists() and county in COUNTY_ABSTRACTS_BUCKET:
        key, shp_name = COUNTY_ABSTRACTS_BUCKET[county]
        print(f"  downloading {BUCKET_NAME}/{key} to unpack {shp_name}...", flush=True)
        try:
            blob = client.storage.from_(BUCKET_NAME).download(key)
            with tempfile.TemporaryDirectory() as tmp:
                with zipfile.ZipFile(io.BytesIO(blob)) as z:
                    z.extractall(tmp)
                candidate = None
                for path in Path(tmp).rglob("*.shp"):
                    if path.name.lower() == shp_name.lower():
                        candidate = path
                        break
                if candidate is None:
                    print(f"  no {shp_name} inside {key}; abstracts unavailable")
                    return []
                gdf = gpd.read_file(candidate)
                return _abstracts_from_gdf(gdf)
        except Exception as exc:
            print(f"  bucket fetch failed for {key}: {exc}")
            return []

    if not local_path.exists():
        print(f"  no local Abstracts.shp at {local_path}; abstracts unavailable")
        return []

    gdf = gpd.read_file(local_path)
    return _abstracts_from_gdf(gdf)


def _abstracts_from_gdf(gdf) -> list[dict[str, Any]]:
    import geopandas as gpd  # noqa: F401 — ensures crs helper below imports
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")
    label_col = None
    for candidate in ("CODE", "ABSTRACT_N", "ABSTRACT_L", "abstract"):
        if candidate in gdf.columns:
            label_col = candidate
            break
    if label_col is None:
        print(f"  no abstract column found in shapefile (cols: {list(gdf.columns)[:10]}...)")
        return []
    rows: list[dict[str, Any]] = []
    for _, r in gdf.iterrows():
        abstract = normalize_abstract(r.get(label_col))
        if not abstract:
            continue
        geom = r.get("geometry")
        if geom is None or geom.is_empty:
            continue
        rows.append({"abstract": abstract, "geom": geom})
    return rows


def paginate_permits(client: Client, table: str) -> list[dict[str, Any]]:
    """Fetch every permit row for a county. Handles two schema variants:
    the post-Ticket-1.3 shape (with spud_date / completion_date /
    abstract_number / permit_status) and the pre-migration shape.
    Returns [] if the table itself doesn't exist yet.
    """
    full_columns = (
        "id, permit_number, api_number, operator_name, lease_name, "
        "latitude, longitude, permit_type, status, filed_date, approved_date, "
        "spud_date, completion_date, abstract_number, permit_status"
    )
    minimal_columns = (
        "id, permit_number, api_number, operator_name, lease_name, "
        "latitude, longitude, permit_type, status, filed_date, approved_date"
    )
    columns = full_columns
    rows: list[dict[str, Any]] = []
    last_id = 0
    while True:
        try:
            result = (
                client.table(table)
                .select(columns)
                .gt("id", last_id)
                .order("id", desc=False)
                .limit(PAGE_SIZE)
                .execute()
            )
        except Exception as exc:
            message = str(exc).lower()
            # A missing column error means the migration hasn't been
            # applied yet — fall back to the pre-migration column set
            # and retry from the same last_id.
            if "column" in message and columns == full_columns:
                columns = minimal_columns
                continue
            # A missing table error means we don't ingest this county
            # yet. Bail out with what we already have.
            if "relation" in message and "does not exist" in message:
                return rows
            if "not find" in message and "table" in message:
                return rows
            raise
        page = result.data or []
        if not page:
            break
        rows.extend(page)
        last_id = page[-1]["id"]
        if len(page) < PAGE_SIZE:
            break
    return rows


def paginate_lease_memoranda(client: Client, county: str) -> list[dict[str, Any]]:
    """Fetch fresh lease-memo rows from public.lease_memoranda for one
    county. Fails soft if the table isn't there yet (Phase 3 migration
    not applied) — returns []."""
    rows: list[dict[str, Any]] = []
    last_id = 0
    while True:
        try:
            result = (
                client.table("lease_memoranda")
                .select("id, abstract_number, lessee, lessor, memo_date, filed_date, source_url")
                .eq("county_id", county)
                .gt("id", last_id)
                .order("id", desc=False)
                .limit(PAGE_SIZE)
                .execute()
            )
        except Exception as exc:
            message = str(exc).lower()
            if "not find" in message or "does not exist" in message:
                return []
            raise
        page = result.data or []
        if not page:
            break
        rows.extend(page)
        last_id = page[-1]["id"]
        if len(page) < PAGE_SIZE:
            break
    return rows


def fetch_operator_dev_programs(client: Client, county: str) -> set[str]:
    """Return the set of operator_name values with an active development
    program in this county per public.operator_dev_programs. Fails soft
    when the table doesn't exist."""
    try:
        result = (
            client.table("operator_dev_programs")
            .select("operator_name")
            .eq("county_id", county)
            .eq("active", True)
            .limit(1000)
            .execute()
        )
    except Exception as exc:
        message = str(exc).lower()
        if "not find" in message or "does not exist" in message:
            return set()
        raise
    return {
        clean_text(row.get("operator_name")).upper()
        for row in (result.data or [])
        if clean_text(row.get("operator_name"))
    }


def paginate_wells(client: Client, table: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    last_api = ""
    while True:
        try:
            query = (
                client.table(table)
                .select("api_number, latitude, longitude, well_status, well_type, "
                        "abstract, completion_date, operator_name, lease_name")
                .not_.is_("latitude", "null")
                .not_.is_("longitude", "null")
                .order("api_number", desc=False)
                .limit(PAGE_SIZE)
            )
            if last_api:
                query = query.gt("api_number", last_api)
            result = query.execute()
        except Exception as exc:
            message = str(exc).lower()
            if "not find" in message or "does not exist" in message:
                return []
            raise
        page = result.data or []
        if not page:
            break
        rows.extend(page)
        last_api = page[-1].get("api_number") or last_api
        if len(page) < PAGE_SIZE:
            break
    return rows


def classify_permit(permit: dict[str, Any], today: dt.date) -> str:
    """Return one of 'approved' | 'spud' | 'completed' | 'expired' | 'unknown'.

    Uses date columns first, falls back to permit_type/status heuristics
    from the scraper's SYMNUM extraction (permit_type=='Drilling' means
    the RRC well shapefile currently sees a rig on location -> spud).
    """
    approved = parse_date(permit.get("approved_date"))
    spud = parse_date(permit.get("spud_date"))
    completion = parse_date(permit.get("completion_date"))
    permit_type = (clean_text(permit.get("permit_type")) or "").upper()
    status_raw = (clean_text(permit.get("status")) or "").upper()

    if completion:
        return "completed"
    if spud:
        return "spud"
    if "DRILL" in permit_type or "DRILL" in status_raw or "RIG" in permit_type:
        return "spud"
    if approved:
        age_months = month_diff(today, approved)
        if age_months >= PERMIT_EXPIRY_MONTHS:
            return "expired"
        return "approved"
    if "PEND" in status_raw or "FILED" in status_raw:
        return "approved"
    if status_raw in {"APPROVED", "ACTIVE", ""}:
        return "approved"
    return "unknown"


def build_adjacency(abstracts: list[dict[str, Any]]) -> dict[str, set[str]]:
    """Return abstract -> set(neighbor abstracts) using shapely touches.

    O(n^2) but n <= ~1,100 per county — fine.
    """
    n = len(abstracts)
    adj: dict[str, set[str]] = defaultdict(set)
    for i in range(n):
        a = abstracts[i]
        for j in range(i + 1, n):
            b = abstracts[j]
            try:
                if a["geom"].touches(b["geom"]) or a["geom"].intersects(b["geom"]):
                    # touches() is the strict shared-boundary predicate.
                    # intersects() catches slivered polygons that touch()
                    # misses due to floating-point boundary rounding.
                    adj[a["abstract"]].add(b["abstract"])
                    adj[b["abstract"]].add(a["abstract"])
            except Exception:
                continue
    return adj


def assign_permits_to_abstracts(
    abstracts: list[dict[str, Any]],
    permits: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Return abstract_number -> [permit rows] using declared abstract_number
    when present, spatial point-in-polygon otherwise."""
    from shapely.geometry import Point
    from shapely.strtree import STRtree

    geoms = [a["geom"] for a in abstracts]
    labels = [a["abstract"] for a in abstracts]
    tree = STRtree(geoms) if geoms else None
    label_to_idx = {a["abstract"]: i for i, a in enumerate(abstracts)}

    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for permit in permits:
        declared = normalize_abstract(permit.get("abstract_number"))
        if declared and declared in label_to_idx:
            out[declared].append(permit)
            continue
        if tree is None:
            continue
        try:
            lon = float(permit.get("longitude"))
            lat = float(permit.get("latitude"))
        except (TypeError, ValueError):
            continue
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
            continue
        point = Point(lon, lat)
        for idx in tree.query(point):
            if geoms[idx].contains(point):
                out[labels[idx]].append(permit)
                break
    return out


def _load_lateral_lines(zip_path: Path):
    """Read the RRC lateral shapefile (wellNNNl.shp) out of a well
    bundle zip and return a list of dicts:
      [{'geom': <shapely LineString>, 'operator': str, 'api': str}]

    Returns [] if the zip is missing, unreadable, or has no lateral
    layer. Uses geopandas because the operator name lives in the DBF
    and we want the geometry as shapely for spacing math.
    """
    import geopandas as gpd
    if not zip_path.exists():
        return []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(zip_path) as archive:
                archive.extractall(tmp)
            lateral_path = None
            for candidate in Path(tmp).rglob("*.shp"):
                if candidate.stem.lower().endswith("l"):
                    lateral_path = candidate
                    break
            if lateral_path is None:
                return []
            gdf = gpd.read_file(lateral_path)
            if gdf.crs is None:
                gdf = gdf.set_crs("EPSG:4326")
            else:
                gdf = gdf.to_crs("EPSG:4326")
            operator_col = next(
                (c for c in gdf.columns if c.upper() in {"OPERATOR", "OPERATOR_N", "OPNAME"}),
                None,
            )
            api_col = next(
                (c for c in gdf.columns if c.upper() in {"API", "API10", "APINUM"}),
                None,
            )
            out: list[dict[str, Any]] = []
            for _, row in gdf.iterrows():
                geom = row.get("geometry")
                if geom is None or geom.is_empty:
                    continue
                out.append({
                    "geom": geom,
                    "operator": clean_text(row.get(operator_col)) if operator_col else "",
                    "api": clean_text(row.get(api_col)) if api_col else "",
                })
            return out
    except Exception as exc:
        print(f"  lateral shapefile read failed ({zip_path.name}): {exc}")
        return []


def _lateral_azimuth_deg(line) -> float:
    """Return the 0–180° heading of a shapely LineString using its
    endpoints. Direction-agnostic (a line running N and its S-going
    twin both hash to the same bucket)."""
    coords = list(line.coords)
    if len(coords) < 2:
        return 0.0
    x0, y0 = coords[0][:2]
    x1, y1 = coords[-1][:2]
    dx = x1 - x0
    dy = y1 - y0
    if dx == 0 and dy == 0:
        return 0.0
    theta = math.degrees(math.atan2(dy, dx))
    if theta < 0:
        theta += 180.0
    if theta >= 180.0:
        theta -= 180.0
    return theta


def _midpoint(line) -> tuple[float, float]:
    coords = list(line.coords)
    if not coords:
        return (0.0, 0.0)
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def compute_infill_gaps(
    abstracts: list[dict[str, Any]],
    laterals: list[dict[str, Any]],
) -> dict[str, int]:
    """PHASE 2 spacing analysis.

    Groups laterals by (operator, azimuth cluster ±15°). Within each
    cluster, sorts by perpendicular offset to a cluster reference line
    and measures adjacent-pair spacing. Adjacent gaps > INFILL_GAP_MIN_FT
    and < INFILL_GAP_MAX_FT are treated as infill candidates and the
    corridor is intersected with abstracts to produce per-abstract
    hit counts.

    Returns: abstract -> count of infill-gap corridors touching that
    abstract. Callers convert count>0 into a PUD_INFILL status + +2 score.
    """
    if not abstracts or not laterals:
        return {}
    from shapely.geometry import LineString, MultiLineString, Point
    from shapely.strtree import STRtree

    # Bucket laterals by operator + coarse azimuth bin. The bin is
    # (int(theta / 15) * 15) so 0..14 -> bin 0, 15..29 -> bin 15, etc.
    # Adjacent bins are considered together so 14° and 16° still cluster.
    buckets: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for lat in laterals:
        geom = lat["geom"]
        if not hasattr(geom, "geom_type"):
            continue
        if geom.geom_type == "MultiLineString":
            # Explode multilinestrings into their component lines so
            # each gets its own azimuth bucket.
            for line in list(geom.geoms):
                theta = _lateral_azimuth_deg(line)
                key = (lat["operator"].upper(), int(theta // INFILL_AZIMUTH_TOLERANCE_DEG))
                buckets[key].append({**lat, "geom": line})
            continue
        theta = _lateral_azimuth_deg(geom)
        key = (lat["operator"].upper(), int(theta // INFILL_AZIMUTH_TOLERANCE_DEG))
        buckets[key].append({**lat, "geom": geom})

    # For each bucket, project each lateral's midpoint onto a normal
    # axis (perpendicular to the cluster's mean azimuth). Sort by
    # projection, then check gaps between neighbors.
    infill_corridors: list[LineString] = []
    for (_operator, _bin), rows in buckets.items():
        if len(rows) < 2:
            continue
        thetas = [_lateral_azimuth_deg(r["geom"]) for r in rows]
        mean_theta = sum(thetas) / len(thetas)
        # Unit vector perpendicular to the mean azimuth
        perp_theta_rad = math.radians(mean_theta + 90.0)
        nx = math.cos(perp_theta_rad)
        ny = math.sin(perp_theta_rad)
        with_proj: list[tuple[float, dict[str, Any]]] = []
        for r in rows:
            mx, my = _midpoint(r["geom"])
            # Project the midpoint onto the perpendicular axis in
            # degrees, then convert to feet via the lat conversion
            # (close enough for a spacing gap flag).
            proj_deg = mx * nx + my * ny
            proj_ft = proj_deg * FEET_PER_DEGREE_LAT
            with_proj.append((proj_ft, r))
        with_proj.sort(key=lambda t: t[0])
        for i in range(len(with_proj) - 1):
            a_proj, a_row = with_proj[i]
            b_proj, b_row = with_proj[i + 1]
            gap_ft = abs(b_proj - a_proj)
            if INFILL_GAP_MIN_FT < gap_ft < INFILL_GAP_MAX_FT:
                # Build a "corridor" line running along the mean
                # azimuth between the two midpoints. Intersecting this
                # line with abstracts picks up the tracts that would
                # accept an infill well between the two existing laterals.
                (ax, ay) = _midpoint(a_row["geom"])
                (bx, by) = _midpoint(b_row["geom"])
                corridor = LineString([(ax, ay), (bx, by)])
                if corridor.is_empty or corridor.length == 0:
                    continue
                infill_corridors.append(corridor)

    if not infill_corridors:
        return {}

    geoms = [a["geom"] for a in abstracts]
    labels = [a["abstract"] for a in abstracts]
    tree = STRtree(geoms)
    hits: Counter[str] = Counter()
    for corridor in infill_corridors:
        for idx in tree.query(corridor):
            if geoms[idx].intersects(corridor):
                hits[labels[idx]] += 1
    return dict(hits)


def assign_wells_to_abstracts(
    abstracts: list[dict[str, Any]],
    wells: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    from shapely.geometry import Point
    from shapely.strtree import STRtree

    geoms = [a["geom"] for a in abstracts]
    labels = [a["abstract"] for a in abstracts]
    tree = STRtree(geoms) if geoms else None

    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for well in wells:
        declared = normalize_abstract(well.get("abstract"))
        if declared and any(label == declared for label in labels):
            out[declared].append(well)
            continue
        if tree is None:
            continue
        try:
            lon = float(well.get("longitude"))
            lat = float(well.get("latitude"))
        except (TypeError, ValueError):
            continue
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
            continue
        point = Point(lon, lat)
        for idx in tree.query(point):
            if geoms[idx].contains(point):
                out[labels[idx]].append(well)
                break
    return out


def summarize_abstract(
    abstract: str,
    permits: list[dict[str, Any]],
    wells: list[dict[str, Any]],
    adjacency: dict[str, set[str]],
    permit_by_abstract: dict[str, list[dict[str, Any]]],
    lease_memos: list[dict[str, Any]],
    infill_hit_count: int,
    operator_program_hit: bool,
    today: dt.date,
) -> dict[str, Any]:
    """Compute development_status, pud_score, and signal_detail for a
    single abstract. Returns a dict ready to upsert."""
    permit_statuses = Counter()
    permit_records: list[dict[str, Any]] = []
    duc_records: list[dict[str, Any]] = []
    for permit in permits:
        classified = classify_permit(permit, today)
        permit_statuses[classified] += 1
        record = {
            "permit_number": clean_text(permit.get("permit_number")) or None,
            "api": clean_text(permit.get("api_number")) or None,
            "operator": clean_text(permit.get("operator_name")) or None,
            "lease": clean_text(permit.get("lease_name")) or None,
            "status": classified,
            "approved_date": clean_text(permit.get("approved_date")) or None,
            "spud_date": clean_text(permit.get("spud_date")) or None,
        }
        permit_records.append(record)
        if classified == "spud":
            duc_records.append({
                "api": record["api"],
                "operator": record["operator"],
                "lease": record["lease"],
                "spud_date": record["spud_date"],
                "source": "permit_scrape",
            })

    has_producing_well = False
    ducs_from_wells: list[dict[str, Any]] = []
    for well in wells:
        completion = parse_date(well.get("completion_date"))
        status = (clean_text(well.get("well_status")) or "").upper()
        if completion or status in {"PRODUCING", "ACTIVE"}:
            has_producing_well = True
        elif status in {"NO PRODUCTION", "SHUT IN", "TEMP ABANDONED", "OBSERVATION"}:
            # Drilled but not producing today; treat as DUC signal
            ducs_from_wells.append({
                "api": clean_text(well.get("api_number")) or None,
                "operator": clean_text(well.get("operator_name")) or None,
                "lease": clean_text(well.get("lease_name")) or None,
                "spud_date": None,
                "status": status,
                "source": "well_row",
            })

    all_ducs = duc_records + ducs_from_wells

    adjacent_permit_count = 0
    adjacent_permit_operators: Counter[str] = Counter()
    for neighbor in adjacency.get(abstract, set()):
        for permit in permit_by_abstract.get(neighbor, []):
            if classify_permit(permit, today) in {"approved", "spud"}:
                adjacent_permit_count += 1
                op = clean_text(permit.get("operator_name"))
                if op:
                    adjacent_permit_operators[op] += 1
                break  # count each neighbor once

    approved_on_tract = permit_statuses.get("approved", 0)
    duc_on_tract = len(all_ducs) + permit_statuses.get("spud", 0)

    fresh_lease_memos = []
    for memo in lease_memos:
        memo_date = parse_date(memo.get("memo_date") or memo.get("filed_date"))
        if memo_date and month_diff(today, memo_date) <= LEASE_MEMO_AGE_MONTHS:
            fresh_lease_memos.append({
                "lessee": clean_text(memo.get("lessee")) or None,
                "lessor": clean_text(memo.get("lessor")) or None,
                "memo_date": clean_text(memo.get("memo_date")) or None,
                "filed_date": clean_text(memo.get("filed_date")) or None,
                "source_url": clean_text(memo.get("source_url")) or None,
            })

    # Status priority (highest wins) per spec:
    #   PDP > PUD_DUC > PUD_PERMITTED > PUD_INFILL > LEASING_ACTIVE > FRONTIER
    if has_producing_well:
        status = "PDP"
    elif duc_on_tract > 0:
        status = "PUD_DUC"
    elif approved_on_tract > 0:
        status = "PUD_PERMITTED"
    elif infill_hit_count > 0:
        status = "PUD_INFILL"
    elif fresh_lease_memos:
        status = "LEASING_ACTIVE"
    else:
        status = "FRONTIER"

    score = 0
    if duc_on_tract > 0:
        score += 4
    if approved_on_tract > 0:
        score += 3
    if adjacent_permit_count > 0:
        score += 2
    if infill_hit_count > 0:
        score += 2
    if fresh_lease_memos:
        score += 1
    if operator_program_hit:
        score += 1
    score = min(score, 10)

    signal_detail = {
        "permits": permit_records,
        "ducs": all_ducs,
        "adjacent_permits": [
            {"operator": op, "count": n}
            for op, n in adjacent_permit_operators.most_common()
        ],
        "adjacent_permit_count": adjacent_permit_count,
        "infill_gaps": infill_hit_count,
        "leases": fresh_lease_memos,
        "operator_program_hit": operator_program_hit,
    }

    return {
        "development_status": status,
        "pud_score": score,
        "signal_detail": signal_detail,
    }


def chunked(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def process_county(client: Client, county: str, args: argparse.Namespace) -> None:
    print(f"\n=== {county} ===", flush=True)
    data_dir = Path(args.data_dir)

    abstracts = load_abstract_polygons(county, data_dir, client)
    print(f"  abstracts loaded: {len(abstracts):,}", flush=True)
    if not abstracts:
        print("  no abstracts available; skipping compute (need Abstracts.shp)")
        return

    permits_table = f"{county}_permits"
    permits = paginate_permits(client, permits_table)
    print(f"  {permits_table}: {len(permits):,} rows", flush=True)

    wells_table = f"{county}_wells"
    wells = paginate_wells(client, wells_table)
    print(f"  {wells_table}: {len(wells):,} rows", flush=True)

    lease_memos = paginate_lease_memoranda(client, county)
    if lease_memos:
        print(f"  lease_memoranda:   {len(lease_memos):,} rows", flush=True)

    operator_programs = fetch_operator_dev_programs(client, county)
    if operator_programs:
        print(f"  operator_dev_programs: {len(operator_programs):,} active operator(s)", flush=True)

    adjacency = build_adjacency(abstracts)
    print(f"  computed adjacency for {len(adjacency):,} abstracts", flush=True)

    permit_by_abstract = assign_permits_to_abstracts(abstracts, permits)
    well_by_abstract = assign_wells_to_abstracts(abstracts, wells)
    print(f"  abstracts with permits: {len(permit_by_abstract):,}", flush=True)
    print(f"  abstracts with wells:   {len(well_by_abstract):,}", flush=True)

    # Phase 2 spacing analysis — load the county's lateral shapefile
    # from data/wellNNN.zip (already cached locally by the daily scraper
    # / add_production_status.py). If the wells zip isn't around,
    # infill_by_abstract stays empty and the compute degrades gracefully
    # to Phase 1 signals.
    fips = COUNTY_FIPS.get(county) if False else _resolve_fips(county)
    lateral_zip = _resolve_wells_zip(county, fips, data_dir, client)
    laterals = _load_lateral_lines(lateral_zip) if lateral_zip else []
    if laterals:
        print(f"  laterals loaded: {len(laterals):,}", flush=True)
    infill_by_abstract = compute_infill_gaps(abstracts, laterals) if laterals else {}
    if infill_by_abstract:
        print(f"  abstracts with infill gap: {len(infill_by_abstract):,}", flush=True)

    lease_by_abstract: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for memo in lease_memos:
        abstract = normalize_abstract(memo.get("abstract_number"))
        if abstract:
            lease_by_abstract[abstract].append(memo)

    today = dt.date.today()
    payloads: list[dict[str, Any]] = []
    status_totals: Counter[str] = Counter()
    score_hist: Counter[int] = Counter()
    for a in abstracts:
        permits_here = permit_by_abstract.get(a["abstract"], [])
        # Operator hit: any permit / adjacent permit whose operator is
        # tagged as active-development in the operator_dev_programs table.
        operator_hit = False
        for permit in permits_here:
            op = clean_text(permit.get("operator_name")).upper()
            if op and op in operator_programs:
                operator_hit = True
                break
        result = summarize_abstract(
            a["abstract"],
            permits_here,
            well_by_abstract.get(a["abstract"], []),
            adjacency,
            permit_by_abstract,
            lease_by_abstract.get(a["abstract"], []),
            infill_by_abstract.get(a["abstract"], 0),
            operator_hit,
            today,
        )
        status_totals[result["development_status"]] += 1
        score_hist[result["pud_score"]] += 1
        payloads.append({
            "county_id": county,
            "abstract_number": a["abstract"],
            "development_status": result["development_status"],
            "pud_score": result["pud_score"],
            "signal_detail": result["signal_detail"],
            "last_computed": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        })

    print("  status totals:")
    for s in STATUS_PRIORITY:
        n = status_totals.get(s, 0)
        if n:
            print(f"    {s:<16s} {n:>5d}")
    print("  pud_score histogram:")
    for s in sorted(score_hist.keys(), reverse=True):
        print(f"    {s:>2d}  {score_hist[s]:>5d}")

    if args.dry_run:
        print("  dry-run: skipping upsert.")
        return

    total_upserts = 0
    for batch in chunked(payloads, BATCH_UPSERT_SIZE):
        try:
            client.table("tract_development_status").upsert(
                batch, on_conflict="county_id,abstract_number"
            ).execute()
        except Exception as exc:
            message = str(exc).lower()
            if "not find" in message or "does not exist" in message:
                print("  tract_development_status table does not exist yet — "
                      "apply the migration first.")
                return
            raise
        total_upserts += len(batch)
    print(f"  upserted {total_upserts:,} rows into tract_development_status.")


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


if __name__ == "__main__":
    main()
