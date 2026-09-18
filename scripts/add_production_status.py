#!/usr/bin/env python3
"""Tag each parcel feature in ``<county>_parcels_enriched.geojson`` with a
``production_status`` categorical field so the Mapbox renderer can color
tracts by well activity instead of by owner propensity score.

Values
------
``pdp``            — parcel contains at least one well with a bottom-hole
                     record in the RRC bundle (drilled + completed).
``pud``            — parcel contains wells (surface points only, no
                     matching bottom-hole record → permitted / undrilled
                     / proved undeveloped) but no PDP wells.
``new_permit``     — parcel has an approved permit but no drilled well.
``pending_permit`` — parcel has a pending/filed permit but no drilled
                     well and no approved permit.
``none``           — no wells and no permits touching this parcel.

Also writes:
* ``pdp_well_count``, ``pud_well_count``, ``permit_count`` per parcel so
  the sidebar can render category counts without a Supabase round-trip.
* ``well_count`` (total of PDP + PUD) for backwards compat with existing
  UI that treated any well as "activity".

Data sources
------------
* ``Raw-Data/wellNNN.zip`` (Supabase Storage) — canonical source for
  "does this API have a bottom-hole record?"; needed because the
  existing ``<county>_wells`` table hardcodes ``well_status='ACTIVE'``
  for Howard/Martin at load time so we can't tell PDP vs PUD from the
  DB alone.
* ``<county>_wells`` Supabase table — canonical source for the
  ``abstract`` join key (already populated by
  ``load_county_wells_shapefile.py``'s spatial join against
  ``data/<county>/Abstracts.shp``).
* ``<county>_permits`` Supabase table — optional. Missing for
  Howard/Martin; when present its rows are lat/lon points, joined to
  tracts spatially against the parcels shapefile.

Usage
-----
::

    python3 scripts/add_production_status.py --county howard
    python3 scripts/add_production_status.py --county martin \
        --wells-zip data/well317.zip
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import tempfile
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import httpx
import shapely.geometry as sgeom
from shapely.strtree import STRtree
from urllib.parse import urlparse

PAGE_SIZE = 1000
BUCKET_NAME = "Raw-Data"

COUNTY_FIPS = {
    "gonzales": "177",
    "howard":   "227",
    "martin":   "317",
    "midland":  "329",
    "glasscock": "173",
    "loving":   "301",
    "reagan":   "383",
    "upton":    "461",
    "ward":     "475",
    "winkler":  "495",
    "reeves":   "389",
    "pecos":    "371",
    "crane":    "103",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--county", required=True, help="County id, e.g. howard")
    parser.add_argument("--fips", help="County FIPS suffix (defaults per county).")
    parser.add_argument(
        "--input-geojson",
        help="Path to the enriched GeoJSON. Defaults to public/<county>_parcels_enriched.geojson.",
    )
    parser.add_argument(
        "--wells-zip",
        help="Local path to wellNNN.zip. Defaults to downloading from the "
             "Raw-Data bucket (top-level key wellNNN.zip).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Compute + print category totals but don't write the geojson.",
    )
    parser.add_argument(
        "--data-dir", default="data",
        help="Where to cache the downloaded wells zip.",
    )
    parser.add_argument(
        "--from-shapefile",
        action="store_true",
        help="Tag tracts from the wells zip surface points only (no Supabase).",
    )
    return parser.parse_args()


def require_env(name: str, aliases: tuple[str, ...] = ()) -> str:
    value = os.getenv(name)
    if value:
        return value
    for alias in aliases:
        alt = os.getenv(alias)
        if alt:
            return alt
    raise ValueError(f"Missing required env: {name}")


def normalize_api(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return (digits.lstrip("0") or "0") if digits else None


def rest_base(url: str) -> str:
    raw = (url or "").strip().rstrip("/")
    if raw.lower().endswith("/rest/v1"):
        raw = raw[: -len("/rest/v1")].rstrip("/")
    parsed = urlparse(raw)
    return f"{parsed.scheme}://{parsed.netloc}"


def rest_headers(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def resolve_wells_zip(county: str, fips: str, wells_zip_arg: str | None,
                      data_dir: Path, base: str, headers: dict[str, str]) -> Path:
    if wells_zip_arg:
        p = Path(wells_zip_arg)
        if not p.exists():
            raise FileNotFoundError(f"--wells-zip not found: {p}")
        return p
    local_candidates = [
        data_dir / f"well{fips}.zip",
        Path(f"data/well{fips}.zip"),
    ]
    for cand in local_candidates:
        if cand.exists():
            return cand
    key = f"well{fips}.zip"
    print(f"downloading {BUCKET_NAME}/{key} from Supabase Storage...")
    with httpx.Client(timeout=180) as client:
        response = client.get(f"{base}/storage/v1/object/{BUCKET_NAME}/{key}", headers=headers)
        response.raise_for_status()
        blob = response.content
    data_dir.mkdir(parents=True, exist_ok=True)
    out = data_dir / key
    out.write_bytes(blob)
    return out


def read_bundle_surface_rows(zip_path: Path) -> list[dict[str, Any]]:
    """Surface well points from wellNNNs.shp for --from-shapefile tagging."""
    import shapefile  # pyshp

    rows: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory() as tmp:
        extract = Path(tmp)
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(extract)
        for shp in extract.rglob("*.shp"):
            if not shp.stem.lower().endswith("s"):
                continue
            reader = shapefile.Reader(str(shp.with_suffix("")))
            field_names = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
            api_field = next((f for f in ("API", "APINUM", "API10", "API14") if f in field_names), None)
            if api_field is None:
                continue
            api_idx = field_names.index(api_field)
            lon_field = next((f for f in ("LONG83", "LONG27") if f in field_names), None)
            lat_field = next((f for f in ("LAT83", "LAT27") if f in field_names), None)
            if lon_field is None or lat_field is None:
                continue
            lon_idx = field_names.index(lon_field)
            lat_idx = field_names.index(lat_field)
            for record in reader.iterRecords():
                api = normalize_api(record[api_idx])
                try:
                    lon = float(record[lon_idx])
                    lat = float(record[lat_idx])
                except (TypeError, ValueError):
                    continue
                if api:
                    rows.append({"api_number": api, "longitude": lon, "latitude": lat})
    return rows


def read_bundle_api_sets(zip_path: Path) -> tuple[set[str], set[str]]:
    """Return (all_surface_apis, apis_with_bottom_hole) parsed from the
    RRC well bundle. Uses pyshp so we don't pay for geopandas here."""
    import shapefile  # pyshp

    with tempfile.TemporaryDirectory() as tmp:
        extract = Path(tmp)
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(extract)
        surface_apis: set[str] = set()
        bottom_apis: set[str] = set()
        for shp in extract.rglob("*.shp"):
            stem = shp.stem.lower()
            # Surface points: wellNNNs.shp; bottom-holes: wellNNNb.shp
            layer = stem[-1]
            if layer not in ("s", "b"):
                continue
            reader = shapefile.Reader(str(shp.with_suffix("")))
            field_names = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
            api_field_candidates = ("API", "APINUM", "API10", "API14")
            api_field = next((f for f in api_field_candidates if f in field_names), None)
            if api_field is None:
                continue
            api_idx = field_names.index(api_field)
            target = surface_apis if layer == "s" else bottom_apis
            for record in reader.iterRecords():
                api = normalize_api(record[api_idx])
                if api:
                    target.add(api)
        return surface_apis, bottom_apis


def paginate_wells(base: str, headers: dict[str, str], table: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    last_api = ""
    with httpx.Client(timeout=90) as client:
        while True:
            params = {
                "select": "api_number,latitude,longitude",
                "latitude": "not.is.null",
                "longitude": "not.is.null",
                "order": "api_number.asc",
                "limit": str(PAGE_SIZE),
            }
            if last_api:
                params["api_number"] = f"gt.{last_api}"
            response = client.get(f"{base}/rest/v1/{table}", params=params, headers=headers)
            if response.status_code >= 300:
                raise RuntimeError(f"wells {table} failed ({response.status_code}): {response.text[:300]}")
            page = response.json() or []
            if not page:
                break
            rows.extend(page)
            last_api = page[-1].get("api_number") or last_api
            if len(page) < PAGE_SIZE:
                break
    return rows


def paginate_permits(base: str, headers: dict[str, str], table: str) -> list[dict[str, Any]] | None:
    try:
        with httpx.Client(timeout=90) as client:
            rows: list[dict[str, Any]] = []
            last_id = 0
            while True:
                response = client.get(
                    f"{base}/rest/v1/{table}",
                    params={
                        "select": "id,latitude,longitude,status",
                        "latitude": "not.is.null",
                        "longitude": "not.is.null",
                        "order": "id.asc",
                        "id": f"gt.{last_id}",
                        "limit": str(PAGE_SIZE),
                    },
                    headers=headers,
                )
                if response.status_code >= 300:
                    text = response.text.lower()
                    if "not find" in text or "does not exist" in text or response.status_code == 404:
                        return None
                    raise RuntimeError(f"permits {table} failed ({response.status_code}): {response.text[:300]}")
                page = response.json() or []
                if not page:
                    break
                rows.extend(page)
                last_id = int(page[-1].get("id") or last_id)
                if len(page) < PAGE_SIZE:
                    break
            return rows
    except Exception as exc:
        message = str(exc).lower()
        if "not find" in message or "does not exist" in message:
            return None
        raise


def norm_abstract(value: Any) -> str:
    return " ".join(str(value or "").strip().upper().split())


def spatial_permit_join(features: list[dict[str, Any]], permits: list[dict[str, Any]]
                        ) -> dict[str, dict[str, int]]:
    """Return abstract_label -> {'approved': N, 'pending': N} by point-in-polygon
    joining each permit lat/lon against parcel geometries. Permit status buckets:

    * ``approved``: RRC status contains 'APPROVED' / '0' / empty / 'RECENT WELL'
    * ``pending``:  status contains 'PENDING' / 'FILED' / 'HELD'
    """
    if not permits:
        return {}
    geoms: list[Any] = []
    labels: list[str] = []
    for feature in features:
        geom = feature.get("geometry")
        if not geom:
            continue
        try:
            shapely_geom = sgeom.shape(geom)
        except Exception:
            continue
        if shapely_geom.is_empty:
            continue
        props = feature.get("properties") or {}
        label = norm_abstract(props.get("ABSTRACT_L"))
        if not label:
            continue
        geoms.append(shapely_geom)
        labels.append(label)
    if not geoms:
        return {}
    tree = STRtree(geoms)

    per_abstract: dict[str, dict[str, int]] = defaultdict(lambda: {"approved": 0, "pending": 0})
    for permit in permits:
        lon = permit.get("longitude")
        lat = permit.get("latitude")
        try:
            point = sgeom.Point(float(lon), float(lat))
        except (TypeError, ValueError):
            continue
        candidates = tree.query(point)
        for idx in candidates:
            if geoms[idx].contains(point):
                bucket = classify_permit_status(permit.get("status"))
                per_abstract[labels[idx]][bucket] += 1
                break
    return per_abstract


def classify_permit_status(raw: Any) -> str:
    text = str(raw or "").strip().upper()
    if text in ("PENDING", "FILED", "HELD"):
        return "pending"
    return "approved"


def classify_tract(pdp_count: int, pud_count: int, approved: int, pending: int) -> str:
    if pdp_count > 0:
        return "pdp"
    if pud_count > 0:
        return "pud"
    if approved > 0:
        return "new_permit"
    if pending > 0:
        return "pending_permit"
    return "none"


def main() -> None:
    args = parse_args()
    county = args.county.strip().lower()
    fips = args.fips or COUNTY_FIPS.get(county)
    if not fips:
        raise ValueError(f"Unknown county '{county}'; pass --fips.")

    repo_root = Path(__file__).resolve().parent.parent
    input_path = Path(
        args.input_geojson
        or repo_root / "public" / f"{county}_parcels_enriched.geojson"
    )
    if not input_path.exists():
        raise FileNotFoundError(f"Enriched GeoJSON missing: {input_path}")

    data_dir = Path(args.data_dir)
    if args.from_shapefile:
        if not args.wells_zip:
            raise ValueError("--from-shapefile requires --wells-zip")
        zip_path = Path(args.wells_zip)
        if not zip_path.exists():
            raise FileNotFoundError(f"--wells-zip not found: {zip_path}")
        base = ""
        headers: dict[str, str] = {}
    else:
        supabase_url = require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
        supabase_key = require_env(
            "SUPABASE_KEY",
            ("SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        )
        base = rest_base(supabase_url)
        headers = rest_headers(supabase_key)
        zip_path = resolve_wells_zip(county, fips, args.wells_zip, data_dir, base, headers)
    print(f"wells bundle: {zip_path}")
    surface_apis, bottom_apis = read_bundle_api_sets(zip_path)
    print(f"  surface APIs: {len(surface_apis):,}")
    print(f"  bottom-hole APIs: {len(bottom_apis):,}")

    wells_table = f"{county}_wells"
    if args.from_shapefile:
        wells_rows = read_bundle_surface_rows(zip_path)
        print(f"wells rows from shapefile: {len(wells_rows):,}")
    else:
        wells_rows = paginate_wells(base, headers, wells_table)
        print(f"wells rows in {wells_table} with lat/lon: {len(wells_rows):,}")

    with input_path.open() as f:
        collection = json.load(f)
    features = collection.get("features") or []

    # Spatial index of parcel polygons so each well can be point-in-polygon
    # matched to its containing tract. This intentionally ignores the
    # loader-populated ``wells.abstract`` join key because (a) Gonzales
    # doesn't have that column at all and (b) roughly half of Howard's
    # wells lost their abstract during the historical spatial-join pass.
    geoms: list[Any] = []
    labels: list[str] = []
    for feature in features:
        geom = feature.get("geometry")
        if not geom:
            continue
        try:
            shapely_geom = sgeom.shape(geom)
        except Exception:
            continue
        if shapely_geom.is_empty:
            continue
        props = feature.get("properties") or {}
        label = norm_abstract(props.get("ABSTRACT_L"))
        if not label:
            continue
        geoms.append(shapely_geom)
        labels.append(label)
    tree = STRtree(geoms) if geoms else None

    pdp_per_abstract: Counter[str] = Counter()
    pud_per_abstract: Counter[str] = Counter()
    wells_outside_county = 0
    for row in wells_rows:
        try:
            lon = float(row.get("longitude"))
            lat = float(row.get("latitude"))
        except (TypeError, ValueError):
            continue
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
            continue
        if tree is None:
            continue
        point = sgeom.Point(lon, lat)
        matched_label: str | None = None
        for idx in tree.query(point):
            if geoms[idx].contains(point):
                matched_label = labels[idx]
                break
        if matched_label is None:
            wells_outside_county += 1
            continue
        api = normalize_api(row.get("api_number"))
        if api and api in bottom_apis:
            pdp_per_abstract[matched_label] += 1
        else:
            pud_per_abstract[matched_label] += 1

    print(f"  wells inside a parcel:  {sum(pdp_per_abstract.values()) + sum(pud_per_abstract.values()):,}")
    print(f"  wells outside parcels:  {wells_outside_county:,}")
    print(f"  abstracts with PDP:     {len(pdp_per_abstract):,}")
    print(f"  abstracts with PUD:     {len(pud_per_abstract):,}")

    permits_table = f"{county}_permits"
    permits = None if args.from_shapefile else paginate_permits(base, headers, permits_table)
    if permits is None:
        print(f"permits table {permits_table} not present; skipping permit join.")
        permit_by_abstract: dict[str, dict[str, int]] = {}
    else:
        print(f"permits rows in {permits_table}: {len(permits):,}")
        permit_by_abstract = spatial_permit_join(features, permits)
        print(f"  abstracts with permits: {len(permit_by_abstract):,}")

    category_counts: Counter[str] = Counter()
    for feature in features:
        props = feature.setdefault("properties", {})
        label = norm_abstract(props.get("ABSTRACT_L"))
        pdp = pdp_per_abstract.get(label, 0)
        pud = pud_per_abstract.get(label, 0)
        permit_stats = permit_by_abstract.get(label, {})
        approved = int(permit_stats.get("approved", 0))
        pending = int(permit_stats.get("pending", 0))

        status = classify_tract(pdp, pud, approved, pending)
        props["production_status"] = status
        props["pdp_well_count"] = pdp
        props["pud_well_count"] = pud
        props["well_count"] = pdp + pud
        props["permit_count"] = approved + pending
        props["new_permit_count"] = approved
        props["pending_permit_count"] = pending
        category_counts[status] += 1

    print("Category totals:")
    for cat in ("pdp", "pud", "new_permit", "pending_permit", "none"):
        print(f"  {cat:<16s} {category_counts.get(cat, 0):>7,d}")

    if args.dry_run:
        print("dry-run: enriched GeoJSON not written.")
        return

    with input_path.open("w") as f:
        json.dump(collection, f)
    print(f"wrote {input_path} ({input_path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
