#!/usr/bin/env python3
"""Detect infill drilling opportunities per abstract for Ticket 1.3 Phase 2.

Loads lateral horizontal-wellbore lines from two sources and stacks them:

  1. RRC well shapefile ``well{FIPS}l.shp`` inside
     ``Raw-Data/well{FIPS}.zip``. Ground truth for wells RRC has fully
     processed.
  2. OG_WELLBORE_EWA_Report_2026-03-03.csv surface + bottom-hole
     coordinates. Synthesized as line strings from surface -> bottom
     hole; this is the ``fill-the-gap`` path for newer horizontal
     wells (SERPENTINE, MOONSTONE-era) that haven't landed in the
     shapefile release yet — spec §4 explicitly calls this out.

Runs the shared azimuth-cluster + perpendicular-spacing analysis (spec
§PHASE 2) and either:
  * writes hit counts back to public.tract_development_status.signal_detail
    (mode: --write), or
  * prints per-abstract counts to stdout (mode: --dry-run / default).

Callable directly, and imported by scripts/compute_development_status.py
so the full nightly compute doesn't have to re-implement the geometry
math.

Usage
-----
::

    # Diagnostic run for one county (default: dry-run print)
    python3 scripts/detect_infill_gaps.py --county gonzales

    # Widen the parallel-cluster tolerance to ±20°
    python3 scripts/detect_infill_gaps.py --county gonzales --azimuth-tol 20

    # Write hit counts back to signal_detail.infill_gaps for each abstract
    python3 scripts/detect_infill_gaps.py --county gonzales --write

The synthesized-lateral path relies on the wellbore CSV publishing
surface + bottom-hole lat/lon. Rows missing either endpoint are
skipped without a warning to keep the log readable.
"""

from __future__ import annotations

import argparse
import csv
import io
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
DEFAULT_EWA_PATH = Path("data/ewa/OG_WELLBORE_EWA_Report_2026-03-03.csv")
DEFAULT_EWA_BUCKET_KEY = "OG_WELLBORE_EWA_Report_2026-03-03.csv"

INFILL_AZIMUTH_TOLERANCE_DEG = 15.0
INFILL_GAP_MIN_FT = 1200.0
INFILL_GAP_MAX_FT = 3600.0
FEET_PER_DEGREE_LAT = 364_000.0

csv.field_size_limit(5_000_000)

COUNTY_FIPS = {
    "gonzales": "177", "howard": "227", "martin": "317",
    "midland": "329", "glasscock": "173", "upton": "461", "reagan": "383",
    "crane": "103", "pecos": "371", "ward": "475", "winkler": "495",
    "loving": "301", "reeves": "389",
}

# EWA columns for the 2026-03-03 export. Fed into synthesize_laterals()
# as sensible defaults; override at the CLI when a newer export shifts them.
DEFAULT_EWA_API_COL = 3
DEFAULT_EWA_COUNTY_COL = 4
DEFAULT_EWA_SURFACE_LAT_COL = 46
DEFAULT_EWA_SURFACE_LON_COL = 47
DEFAULT_EWA_BOTTOM_LAT_COL = 48
DEFAULT_EWA_BOTTOM_LON_COL = 49
DEFAULT_EWA_OPERATOR_COL = 12


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--county", required=True)
    parser.add_argument("--azimuth-tol", type=float, default=INFILL_AZIMUTH_TOLERANCE_DEG,
                        help=f"Azimuth cluster tolerance in degrees (default {INFILL_AZIMUTH_TOLERANCE_DEG}).")
    parser.add_argument("--gap-min-ft", type=float, default=INFILL_GAP_MIN_FT)
    parser.add_argument("--gap-max-ft", type=float, default=INFILL_GAP_MAX_FT)
    parser.add_argument("--ewa-path", default=str(DEFAULT_EWA_PATH))
    parser.add_argument("--skip-ewa", action="store_true",
                        help="Only use the RRC shapefile; skip the "
                             "EWA surface->bottom-hole synthesis.")
    parser.add_argument("--write", action="store_true",
                        help="Update signal_detail.infill_gaps for each hit "
                             "abstract in public.tract_development_status.")
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
    text = str(value or "").strip().strip('"')
    if text.lower() in {"null", "none", "nan"}:
        return ""
    return text


def normalize_abstract(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return ""
    stripped = text.upper()
    if stripped.startswith("A-"):
        stripped = stripped[2:]
    return stripped.strip()


def load_shapefile_laterals(county: str, fips: str, data_dir: Path,
                            client: Client) -> list[dict[str, Any]]:
    import geopandas as gpd
    cached = data_dir / f"well{fips}.zip"
    if not cached.exists():
        key = f"well{fips}.zip"
        try:
            blob = client.storage.from_(BUCKET_NAME).download(key)
        except Exception as exc:
            print(f"  no wells zip in bucket: {exc}")
            return []
        data_dir.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(blob)

    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(cached) as archive:
            archive.extractall(tmp)
        lateral = None
        for candidate in Path(tmp).rglob("*.shp"):
            if candidate.stem.lower().endswith("l"):
                lateral = candidate
                break
        if lateral is None:
            return []
        gdf = gpd.read_file(lateral)
        if gdf.crs is None:
            gdf = gdf.set_crs("EPSG:4326")
        else:
            gdf = gdf.to_crs("EPSG:4326")
        operator_col = next((c for c in gdf.columns
                             if c.upper() in {"OPERATOR", "OPERATOR_N", "OPNAME"}), None)
        api_col = next((c for c in gdf.columns
                        if c.upper() in {"API", "API10", "APINUM"}), None)
        rows: list[dict[str, Any]] = []
        for _, r in gdf.iterrows():
            geom = r.get("geometry")
            if geom is None or geom.is_empty:
                continue
            rows.append({
                "geom": geom,
                "operator": clean_text(r.get(operator_col)) if operator_col else "",
                "api": clean_text(r.get(api_col)) if api_col else "",
                "source": "shapefile",
            })
        return rows


def synthesize_laterals_from_ewa(county: str, args: argparse.Namespace,
                                 shapefile_apis: set[str]) -> list[dict[str, Any]]:
    """Read surface + bottom-hole coords from the EWA CSV and build a
    shapely LineString per well whose API isn't already covered by the
    shapefile pass. Spec §4 explicitly calls this out for SERPENTINE /
    MOONSTONE-era wells that haven't landed in the shapefile yet."""
    from shapely.geometry import LineString

    path = Path(args.ewa_path)
    if not path.exists():
        print(f"  EWA CSV missing at {path}; skipping synthesis")
        return []

    county_upper = county.upper()
    rows: list[dict[str, Any]] = []
    scanned = 0
    with path.open("r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        for row in reader:
            scanned += 1
            if len(row) <= max(DEFAULT_EWA_BOTTOM_LON_COL, DEFAULT_EWA_OPERATOR_COL):
                continue
            if clean_text(row[DEFAULT_EWA_COUNTY_COL]).upper() != county_upper:
                continue
            api_digits = "".join(c for c in row[DEFAULT_EWA_API_COL] if c.isdigit())
            api = api_digits.lstrip("0") or "0" if api_digits else ""
            if not api or api in shapefile_apis:
                continue
            try:
                s_lat = float(row[DEFAULT_EWA_SURFACE_LAT_COL])
                s_lon = float(row[DEFAULT_EWA_SURFACE_LON_COL])
                b_lat = float(row[DEFAULT_EWA_BOTTOM_LAT_COL])
                b_lon = float(row[DEFAULT_EWA_BOTTOM_LON_COL])
            except (TypeError, ValueError):
                continue
            for v in (s_lat, s_lon, b_lat, b_lon):
                if not math.isfinite(v):
                    continue
            if abs(s_lat) < 1 or abs(s_lon) < 1 or abs(b_lat) < 1 or abs(b_lon) < 1:
                continue
            if s_lat == b_lat and s_lon == b_lon:
                continue
            try:
                geom = LineString([(s_lon, s_lat), (b_lon, b_lat)])
            except Exception:
                continue
            if geom.is_empty or geom.length == 0:
                continue
            rows.append({
                "geom": geom,
                "operator": clean_text(row[DEFAULT_EWA_OPERATOR_COL]),
                "api": api,
                "source": "ewa_synthesized",
            })
    print(f"  EWA scanned {scanned:,} rows, synthesized {len(rows):,} laterals "
          f"absent from the shapefile.")
    return rows


def load_abstract_polygons(county: str, client: Client) -> list[dict[str, Any]]:
    """Small wrapper around the same loader the compute script uses,
    imported lazily to avoid a hard dep when this is run standalone."""
    from compute_development_status import load_abstract_polygons as _load
    return _load(county, Path("data"), client)


def lateral_azimuth_deg(line) -> float:
    coords = list(line.coords)
    if len(coords) < 2:
        return 0.0
    x0, y0 = coords[0][:2]
    x1, y1 = coords[-1][:2]
    dx, dy = x1 - x0, y1 - y0
    if dx == 0 and dy == 0:
        return 0.0
    theta = math.degrees(math.atan2(dy, dx))
    if theta < 0:
        theta += 180.0
    if theta >= 180.0:
        theta -= 180.0
    return theta


def midpoint(line) -> tuple[float, float]:
    coords = list(line.coords)
    if not coords:
        return (0.0, 0.0)
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def compute_infill_gaps(abstracts: list[dict[str, Any]],
                        laterals: list[dict[str, Any]],
                        azimuth_tol: float = INFILL_AZIMUTH_TOLERANCE_DEG,
                        gap_min_ft: float = INFILL_GAP_MIN_FT,
                        gap_max_ft: float = INFILL_GAP_MAX_FT) -> dict[str, int]:
    if not abstracts or not laterals:
        return {}
    from shapely.geometry import LineString
    from shapely.strtree import STRtree

    buckets: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for lat in laterals:
        geom = lat["geom"]
        if not hasattr(geom, "geom_type"):
            continue
        parts: Iterable[Any] = list(geom.geoms) if geom.geom_type == "MultiLineString" else [geom]
        for line in parts:
            theta = lateral_azimuth_deg(line)
            key = (lat["operator"].upper(), int(theta // azimuth_tol))
            buckets[key].append({**lat, "geom": line})

    corridors: list[Any] = []
    for (_op, _bin), rows in buckets.items():
        if len(rows) < 2:
            continue
        thetas = [lateral_azimuth_deg(r["geom"]) for r in rows]
        mean_theta = sum(thetas) / len(thetas)
        perp_rad = math.radians(mean_theta + 90.0)
        nx, ny = math.cos(perp_rad), math.sin(perp_rad)
        proj: list[tuple[float, dict[str, Any]]] = []
        for r in rows:
            mx, my = midpoint(r["geom"])
            proj.append((mx * nx + my * ny, r))
        proj.sort(key=lambda t: t[0])
        for i in range(len(proj) - 1):
            a_deg, a_row = proj[i]
            b_deg, b_row = proj[i + 1]
            gap_ft = abs(b_deg - a_deg) * FEET_PER_DEGREE_LAT
            if gap_min_ft < gap_ft < gap_max_ft:
                (ax, ay) = midpoint(a_row["geom"])
                (bx, by) = midpoint(b_row["geom"])
                try:
                    corr = LineString([(ax, ay), (bx, by)])
                except Exception:
                    continue
                if not corr.is_empty and corr.length > 0:
                    corridors.append(corr)

    if not corridors:
        return {}

    geoms = [a["geom"] for a in abstracts]
    labels = [a["abstract"] for a in abstracts]
    tree = STRtree(geoms)
    hits: Counter[str] = Counter()
    for corr in corridors:
        for idx in tree.query(corr):
            if geoms[idx].intersects(corr):
                hits[labels[idx]] += 1
    return dict(hits)


def main() -> None:
    args = parse_args()
    county = args.county.strip().lower()
    fips = COUNTY_FIPS.get(county)
    if not fips:
        print(f"unknown county {county}", file=sys.stderr)
        sys.exit(1)

    supabase_url = require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
    supabase_key = require_env("SUPABASE_KEY", ("SUPABASE_SERVICE_ROLE_KEY",))
    client = create_client(supabase_url, supabase_key)

    abstracts = load_abstract_polygons(county, client)
    print(f"abstracts loaded: {len(abstracts):,}")
    if not abstracts:
        print("no abstracts; nothing to do.")
        return

    shape_laterals = load_shapefile_laterals(county, fips, Path("data"), client)
    print(f"shapefile laterals: {len(shape_laterals):,}")
    shapefile_apis = {lat["api"] for lat in shape_laterals if lat["api"]}

    ewa_laterals: list[dict[str, Any]] = []
    if not args.skip_ewa:
        ewa_laterals = synthesize_laterals_from_ewa(county, args, shapefile_apis)

    laterals = shape_laterals + ewa_laterals
    hits = compute_infill_gaps(
        abstracts, laterals,
        azimuth_tol=args.azimuth_tol,
        gap_min_ft=args.gap_min_ft,
        gap_max_ft=args.gap_max_ft,
    )
    print(f"abstracts with an infill gap: {len(hits):,}")
    total = sum(hits.values())
    print(f"total corridor -> abstract intersections: {total:,}")

    if not args.write:
        for abstract, n in sorted(hits.items(), key=lambda kv: (-kv[1], kv[0]))[:10]:
            print(f"  A-{abstract:<8s} {n} gap(s)")
        return

    # Merge into signal_detail.infill_gaps on each hit abstract.
    for abstract, n in hits.items():
        existing = (
            client.table("tract_development_status")
            .select("signal_detail")
            .eq("county_id", county)
            .eq("abstract_number", abstract)
            .maybeSingle()
            .execute()
        )
        if existing.error:
            continue
        current = (existing.data or {}).get("signal_detail") or {}
        current["infill_gaps"] = n
        client.table("tract_development_status").update({
            "signal_detail": current,
        }).eq("county_id", county).eq("abstract_number", abstract).execute()
    print("wrote infill_gaps counts into tract_development_status.signal_detail.")


if __name__ == "__main__":
    main()
