#!/usr/bin/env python3
"""Build ``data/<county>/Abstracts.shp`` from the RRC public survey grid.

TNRIS land parcels follow ownership, not the GLO abstract grid. Large
ranches and unsubmitted CAD areas become one beige blob (or drop out of
the map entirely). The RRC GIS Viewer Surveys layer is the official
section/abstract polygons (ABSTRACT_LABEL, block, section) and covers
the whole county.

Usage::

    python3 scripts/download_rrc_surveys.py --county reeves,pecos
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import geopandas as gpd
import httpx
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
BASE = (
    "https://gis.rrc.texas.gov/server/rest/services/"
    "rrc_public/RRC_Public_Viewer_Srvs/MapServer"
)
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
PAGE = 1000
MIN_ACRES = 10.0

COUNTY_FIPS = {
    "howard": "227",
    "glasscock": "173",
    "reeves": "389",
    "pecos": "371",
    "martin": "317",
    "midland": "329",
    "loving": "301",
    "reagan": "383",
    "upton": "461",
    "ward": "475",
    "winkler": "495",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--county", required=True, help="Comma-separated county ids")
    return p.parse_args()


def _request(client: httpx.Client, method: str, url: str, **kwargs: Any) -> httpx.Response:
    last: Exception | httpx.Response | None = None
    for attempt in range(6):
        try:
            response = client.request(method, url, **kwargs)
        except httpx.TransportError as exc:
            last = exc
            time.sleep(2 ** attempt)
            continue
        if response.status_code in {429, 500, 502, 503, 504} and attempt < 5:
            last = response
            time.sleep(2 ** attempt)
            continue
        return response
    if isinstance(last, httpx.Response):
        return last
    raise last  # type: ignore[misc]


def fetch_county_polygon(client: httpx.Client, fips: str) -> Any:
    response = _request(
        client,
        "GET",
        f"{BASE}/29/query",
        params={
            "where": f"FIPS='{fips}'",
            "outFields": "FIPS,COUNTY_NAME",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        },
    )
    response.raise_for_status()
    data = response.json()
    feats = data.get("features") or []
    if not feats:
        raise RuntimeError(f"RRC counties layer has no FIPS={fips}")
    return shape(feats[0]["geometry"])


def fetch_survey_page(
    client: httpx.Client,
    bbox: tuple[float, float, float, float],
    offset: int,
) -> list[dict[str, Any]]:
    xmin, ymin, xmax, ymax = bbox
    response = _request(
        client,
        "GET",
        f"{BASE}/24/query",
        params={
            "geometry": f"{xmin},{ymin},{xmax},{ymax}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": (
                "ABSTRACT_NUMBER,LEVEL1_SURVEY_NAME,LEVEL2_BLOCK_NUMBER,"
                "LEVEL3_SURVEY_NUMBER,LEVEL4_SURVEY_NAME,ABSTRACT_LABEL"
            ),
            "outSR": "4326",
            "returnGeometry": "true",
            "resultOffset": str(offset),
            "resultRecordCount": str(PAGE),
            "f": "geojson",
        },
    )
    response.raise_for_status()
    data = response.json()
    if data.get("error"):
        raise RuntimeError(f"RRC surveys query failed: {data['error']}")
    return list(data.get("features") or [])


def bare_abstract(value: Any) -> str:
    text = str(value or "").strip().upper()
    if text.startswith("A-"):
        text = text[2:]
    digits = "".join(ch for ch in text if ch.isdigit() or ch.isalpha())
    # Prefer the numeric abstract (2210) when present.
    num = "".join(ch for ch in text if ch.isdigit())
    return num or digits


def feature_to_row(feat: dict[str, Any]) -> dict[str, Any] | None:
    props = feat.get("properties") or {}
    geom = feat.get("geometry")
    if not geom:
        return None
    try:
        shp = shape(geom)
    except Exception:
        return None
    if shp.is_empty:
        return None
    label = str(props.get("ABSTRACT_LABEL") or "").strip()
    number = bare_abstract(props.get("ABSTRACT_NUMBER") or label)
    if not label and number:
        label = f"A-{number}"
    if not label:
        block = str(props.get("LEVEL2_BLOCK_NUMBER") or "").strip()
        sec = str(props.get("LEVEL3_SURVEY_NUMBER") or "").strip()
        if block and sec:
            label = f"B{block}--S{sec}"
        else:
            return None
    return {
        "ABSTRACT_L": label,
        "ABSTRACT_N": number,
        "LEVEL1_SUR": str(props.get("LEVEL1_SURVEY_NAME") or "").strip(),
        "LEVEL2_BLO": str(props.get("LEVEL2_BLOCK_NUMBER") or "").strip(),
        "LEVEL3_SUR": str(props.get("LEVEL3_SURVEY_NUMBER") or "").strip(),
        "Surv_Sect": str(props.get("LEVEL3_SURVEY_NUMBER") or "").strip(),
        "geometry": shp,
    }


def write_map_geojson(county: str, tracts: gpd.GeoDataFrame) -> None:
    """Commit a geometry-only map layer so /public shows the new grid
    before rematch writes owners + production_status.
    """
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from build_map_geojson import KEEP_PROPS, build_legal_desc  # noqa: E402

    gdf = tracts.copy()
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")
    features = []
    for _, row in gdf.iterrows():
        props = {
            "ABSTRACT_L": row.get("ABSTRACT_L") or "",
            "ABSTRACT_N": row.get("ABSTRACT_N") or "",
            "LEVEL1_SUR": row.get("LEVEL1_SUR") or "",
            "LEVEL2_BLO": row.get("LEVEL2_BLO") or "",
            "LEVEL3_SUR": row.get("LEVEL3_SUR") or "",
            "Surv_Sect": row.get("Surv_Sect") or "",
            "SHAPE_AREA": float(row.get("SHAPE_AREA") or 0),
            "production_status": "none",
            "pdp_well_count": 0,
            "pud_well_count": 0,
            "well_count": 0,
            "permit_count": 0,
            "owner_count": 0,
        }
        props["legal_desc"] = build_legal_desc(props)
        props = {k: v for k, v in props.items() if k in KEEP_PROPS or k == "legal_desc"}
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": geom.__geo_interface__,
        })
    dest = ROOT / "public" / f"{county}_parcels_map.geojson"
    dest.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"  wrote {dest} ({len(features)} features, {dest.stat().st_size:,} bytes)", flush=True)


def download_county(client: httpx.Client, county: str) -> None:
    fips = COUNTY_FIPS[county]
    print(f"\n=== {county} FIPS {fips} ===", flush=True)
    county_poly = fetch_county_polygon(client, fips)
    minx, miny, maxx, maxy = county_poly.bounds
    print(
        f"  county bounds {minx:.3f},{miny:.3f} {maxx:.3f},{maxy:.3f}",
        flush=True,
    )
    features: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = fetch_survey_page(client, (minx, miny, maxx, maxy), offset)
        features.extend(page)
        print(f"  surveys fetched {len(features)} (+{len(page)})", flush=True)
        if len(page) < PAGE:
            break
        offset += PAGE
    rows = []
    for feat in features:
        row = feature_to_row(feat)
        if row:
            rows.append(row)
    if not rows:
        raise RuntimeError(f"no survey polygons for {county}")
    gdf = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    print(f"  raw survey polys in bbox: {len(gdf)}", flush=True)
    gdf["geometry"] = gdf.geometry.intersection(county_poly)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    try:
        gdf["geometry"] = gdf.geometry.make_valid()
    except Exception:
        pass
    acres = gdf.to_crs("EPSG:5070").geometry.area / 4046.8564224
    gdf = gdf.loc[acres.values >= MIN_ACRES].copy()
    before = len(gdf)
    gdf = gdf.dissolve(by="ABSTRACT_L", as_index=False, aggfunc="first")
    if len(gdf) != before:
        print(f"  merged multi-part abstracts: {before} -> {len(gdf)}", flush=True)
    gdf["SHAPE_AREA"] = gdf.to_crs("EPSG:5070").geometry.area / 4046.8564224
    keep = gdf[[
        "ABSTRACT_L", "ABSTRACT_N", "LEVEL1_SUR", "LEVEL2_BLO",
        "LEVEL3_SUR", "Surv_Sect", "SHAPE_AREA", "geometry",
    ]].copy()
    out_dir = ROOT / "data" / county
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "Abstracts.shp"
    keep.to_file(out)
    print(
        f"  wrote {out} ({len(keep)} tracts, "
        f"{keep['SHAPE_AREA'].sum():,.0f} ac, "
        f"max {keep['SHAPE_AREA'].max():,.0f} ac)",
        flush=True,
    )
    write_map_geojson(county, keep)


def main() -> None:
    args = parse_args()
    counties = [c.strip().lower() for c in args.county.split(",") if c.strip()]
    unknown = [c for c in counties if c not in COUNTY_FIPS]
    if unknown:
        raise SystemExit(f"unknown county: {unknown}")
    with httpx.Client(timeout=180.0, headers={"User-Agent": UA}) as client:
        for county in counties:
            download_county(client, county)


if __name__ == "__main__":
    main()
