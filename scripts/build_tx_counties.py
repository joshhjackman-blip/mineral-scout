#!/usr/bin/env python3
"""Build public/tx_counties.geojson for the orange tract-view overlay.

Plotly's US-county file is a handful of vertices per county, so river
borders (Ward/Pecos/Reeves) leave white gaps and paint the neighbor
over the selected county's tracts.

This file is a planar coverage:
  1. Start from Census 2023 1:500,000 county polygons (legal lines).
  2. Union each live county with the outer shell of its CAD parcels so
     tracts that sit past the Census line still belong to that county.
  3. Subtract those parcel shells from every other county so the orange
     mask can never cover a neighbor's tracts.
"""

from __future__ import annotations

import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import shapefile
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUT = PUBLIC / "tx_counties.geojson"
CENSUS_DIR = Path("/tmp/counties")
CENSUS_SHP = CENSUS_DIR / "cb_2023_us_county_500k.shp"
CENSUS_ZIP_URL = (
    "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip"
)

LIVE = {
    "howard": "48227",
    "martin": "48317",
    "midland": "48329",
    "glasscock": "48173",
    "loving": "48301",
    "reagan": "48383",
    "upton": "48461",
    "ward": "48475",
    "winkler": "48495",
    "reeves": "48389",
    "pecos": "48371",
    "crane": "48103",
}

SIMPLIFY_DEG = 0.0002  # ~20 m — keeps survey jogs, drops CAD vertex noise


def fill_holes(geom):
    if geom.is_empty:
        return geom
    if geom.geom_type == "Polygon":
        return Polygon(geom.exterior)
    if geom.geom_type == "MultiPolygon":
        return MultiPolygon([Polygon(p.exterior) for p in geom.geoms if not p.is_empty])
    return geom


def clean(geom):
    if geom is None or geom.is_empty:
        return geom
    if not geom.is_valid:
        geom = geom.buffer(0)
    geom = fill_holes(geom)
    if geom.is_empty:
        return geom
    simplified = geom.simplify(SIMPLIFY_DEG, preserve_topology=True)
    return simplified if not simplified.is_empty else geom


def ensure_census_shapefile() -> Path:
    if CENSUS_SHP.exists():
        return CENSUS_SHP
    CENSUS_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = CENSUS_DIR / "cb_2023_us_county_500k.zip"
    print(f"downloading {CENSUS_ZIP_URL} …")
    urllib.request.urlretrieve(CENSUS_ZIP_URL, zip_path)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(CENSUS_DIR)
    if not CENSUS_SHP.exists():
        raise FileNotFoundError(CENSUS_SHP)
    return CENSUS_SHP


def load_census_texas(path: Path) -> dict[str, dict]:
    sf = shapefile.Reader(str(path))
    fields = [f[0] for f in sf.fields[1:]]
    out: dict[str, dict] = {}
    for sr in sf.iterShapeRecords():
        rec = dict(zip(fields, sr.record))
        if str(rec.get("STATEFP", "")) != "48":
            continue
        geoid = str(rec.get("GEOID", "")).strip()
        try:
            geom = shape(sr.shape.__geo_interface__)
        except Exception:
            continue
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        out[geoid] = {
            "name": str(rec.get("NAME", "")),
            "geom": geom,
        }
    return out


def dissolve_parcels(path: Path):
    data = json.loads(path.read_text())
    geoms = []
    for feat in data.get("features") or []:
        g = feat.get("geometry")
        if not g:
            continue
        try:
            geom = shape(g)
        except Exception:
            continue
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        geoms.append(geom)
    if not geoms:
        return None
    merged = unary_union(geoms)
    if not merged.is_valid:
        merged = merged.buffer(0)
    return fill_holes(merged)


def round_coords(obj, ndigits=6):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(c), ndigits) for c in obj]
        return [round_coords(x, ndigits) for x in obj]
    return obj


def geom_to_mapping(geom):
    m = mapping(geom)
    m["coordinates"] = round_coords(m["coordinates"])
    return m


def main() -> int:
    census_shp = ensure_census_shapefile()

    print("loading Census Texas counties…")
    counties = load_census_texas(census_shp)
    print(f"  {len(counties)} Texas counties")

    extras: dict[str, object] = {}
    for county_id, fips in LIVE.items():
        parcel_path = PUBLIC / f"{county_id}_parcels_map.geojson"
        if not parcel_path.exists():
            print(f"  skip {county_id}: no parcel file")
            continue
        print(f"dissolving {county_id} parcels…")
        shell = dissolve_parcels(parcel_path)
        if shell is None or shell.is_empty:
            print(f"  skip {county_id}: empty dissolve")
            continue
        extras[fips] = shell
        base = counties[fips]["geom"]
        counties[fips]["geom"] = base.union(shell)
        counties[fips]["source"] = "census+cad"

    print("subtracting CAD shells from neighbors…")
    for fips, shell in extras.items():
        for other_fips, entry in counties.items():
            if other_fips == fips:
                continue
            trimmed = entry["geom"].difference(shell)
            if trimmed.is_empty:
                continue
            if not trimmed.is_valid:
                trimmed = trimmed.buffer(0)
            entry["geom"] = trimmed

    print("simplifying…")
    features = []
    for fips, entry in sorted(counties.items()):
        geom = clean(entry["geom"])
        if geom is None or geom.is_empty:
            continue
        features.append({
            "type": "Feature",
            "id": fips,
            "properties": {
                "GEOID": fips,
                "NAME": entry["name"],
                "__fips": fips,
                "source": entry.get("source", "census"),
            },
            "geometry": geom_to_mapping(geom),
        })

    OUT.write_text(json.dumps(
        {"type": "FeatureCollection", "features": features},
        separators=(",", ":"),
    ))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB, {len(features)} counties)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
