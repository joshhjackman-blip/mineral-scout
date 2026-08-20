#!/usr/bin/env python3
"""Convert TxDOT StratMap land-parcel shapefiles into map-ready GeoJSON.

Midland and Loving arrived as StratMap25 land-parcel shapefiles — one polygon
per individual parcel, with owner name, mailing address, market value, and
tax-year fields baked into the DBF. That is structurally different from the
Abstracts.shp we use for Howard / Martin / Gonzales, where each polygon is an
RRC survey abstract that many mineral owners map into.

This script:

1) Reads the StratMap shapefile.
2) Reprojects to EPSG:4326 if needed.
3) Writes a slim ``public/<county>_parcels_map.geojson`` with just geometry +
   ``Prop_ID`` and ``LEGAL_DESC`` (all the map renderer touches; a real
   propensity join comes later once the county's tax roll is loaded).
4) Writes an identical ``public/<county>_parcels_enriched.geojson`` copy so
   the side-panel fetch in ``app/page.tsx`` succeeds. The panel filters out
   features with empty ``ABSTRACT_L``, so no tract rows are surfaced until
   the tax-roll enrichment script runs.

Usage:
    python3 scripts/build_stratmap_parcels_geojson.py \\
        --county midland \\
        --input data/midland/stratmap25-landparcels_48329_midland_202507.shp

    python3 scripts/build_stratmap_parcels_geojson.py \\
        --county loving  \\
        --input data/loving/stratmap25-landparcels_48301_loving_202505.shp
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import geopandas as gpd


# Fields we surface on the map version. Anything else is dropped to keep the
# ``public/*_parcels_map.geojson`` file small — Midland has ~76k parcels and
# the DBF is 160 MB, so keeping the full attribute set would balloon the
# GeoJSON well past what we want to ship to the browser.
KEEP_PROPS = ("Prop_ID", "LEGAL_DESC", "OWNER_NAME", "GIS_AREA")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--county", required=True, help="County id (e.g. midland, loving).")
    parser.add_argument("--input", required=True, help="Path to the StratMap .shp file.")
    parser.add_argument("--public-dir", default="public", help="Directory to write GeoJSON into.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    county = args.county.strip().lower()
    shp_path = Path(args.input)
    if not shp_path.exists():
        raise FileNotFoundError(f"Missing shapefile: {shp_path}")

    print(f"reading {shp_path}")
    gdf = gpd.read_file(shp_path)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")

    keep = [c for c in KEEP_PROPS if c in gdf.columns]
    slim = gdf[[*keep, "geometry"]].copy()

    # StratMap DBFs use "nan" strings and float NaN for missing values; keep
    # them out of the GeoJSON so the browser doesn't have to filter them.
    def clean(value: object) -> object:
        if value is None:
            return None
        if isinstance(value, float):
            if value != value:  # NaN check
                return None
            return value
        text = str(value).strip()
        if not text or text.lower() == "nan":
            return None
        return text

    for column in keep:
        slim[column] = slim[column].apply(clean)

    slim = slim[~(slim.geometry.is_empty | slim.geometry.isna())].copy()

    raw = json.loads(slim.to_json())
    features = []
    for feature in raw.get("features", []):
        props = feature.get("properties") or {}
        clean_props = {key: value for key, value in props.items() if value is not None}
        features.append({
            "type": "Feature",
            "geometry": feature.get("geometry"),
            "properties": clean_props,
        })
    collection = {"type": "FeatureCollection", "features": features}

    public_dir = Path(args.public_dir)
    public_dir.mkdir(parents=True, exist_ok=True)

    map_path = public_dir / f"{county}_parcels_map.geojson"
    enriched_path = public_dir / f"{county}_parcels_enriched.geojson"

    with map_path.open("w") as f:
        json.dump(collection, f, separators=(",", ":"))

    # The side-panel fetch in ``app/page.tsx`` filters out features with an
    # empty ``ABSTRACT_L`` (see the tract loader), and StratMap parcels don't
    # carry that column. Writing an empty FeatureCollection keeps the initial
    # HTTP request cheap (no need to ship a duplicate 39 MB payload for
    # Midland) until the tax-roll enrichment produces a real enriched file.
    empty_collection = {"type": "FeatureCollection", "features": []}
    with enriched_path.open("w") as f:
        json.dump(empty_collection, f, separators=(",", ":"))

    map_size = map_path.stat().st_size
    print(
        f"wrote {map_path} ({map_size / 1e6:.2f} MB, {len(features)} features)"
    )
    print(
        f"wrote {enriched_path} (empty placeholder; overwritten by tax-roll enrichment)"
    )


if __name__ == "__main__":
    main()
