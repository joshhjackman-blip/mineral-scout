#!/usr/bin/env python3
"""Sanity-check public/tx_counties.geojson against Ward/Pecos and Midland/Martin parcels."""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import box, shape

ROOT = Path(__file__).resolve().parents[1]
COUNTIES = json.loads((ROOT / "public" / "tx_counties.geojson").read_text())
BY_FIPS = {str(f["id"]): f for f in COUNTIES["features"]}

# Census Midland/Martin line is ~32.087. Midland CAD tracts (A-672,
# B38-T1N-S35, A-285 strips) continue north of that into Martin.
MIDLAND_MARTIN_LINE = 32.087


def verts(geom: dict) -> int:
    if geom["type"] == "Polygon":
        return sum(len(r) for r in geom["coordinates"])
    return sum(len(r) for p in geom["coordinates"] for r in p)


def northern_point(geom, min_lat: float):
    part = geom.intersection(box(-180, min_lat, 180, 90))
    if part.is_empty:
        return None
    return part.representative_point()


def main() -> None:
    assert len(COUNTIES["features"]) == 254
    ward = shape(BY_FIPS["48475"]["geometry"])
    pecos = shape(BY_FIPS["48371"]["geometry"])
    assert verts(BY_FIPS["48475"]["geometry"]) > 200
    assert verts(BY_FIPS["48371"]["geometry"]) > 200
    assert ward.intersection(pecos).area < 1e-5

    wp = json.loads((ROOT / "public" / "ward_parcels_map.geojson").read_text())
    pecos_hits = 0
    for feat in wp["features"][::25]:
        pt = shape(feat["geometry"]).representative_point()
        if pecos.contains(pt):
            pecos_hits += 1
    assert pecos_hits == 0, pecos_hits

    midland = shape(BY_FIPS["48329"]["geometry"])
    martin = shape(BY_FIPS["48317"]["geometry"])
    mp = json.loads((ROOT / "public" / "midland_parcels_map.geojson").read_text())
    north = 0
    martin_covers = 0
    examples = []
    for feat in mp["features"]:
        geom = shape(feat["geometry"])
        pt = northern_point(geom, MIDLAND_MARTIN_LINE + 0.001)
        if pt is None:
            continue
        north += 1
        if martin.contains(pt):
            martin_covers += 1
            if len(examples) < 6:
                examples.append(feat.get("properties", {}).get("ABSTRACT_L"))
    assert north >= 5, north
    assert martin_covers == 0, (martin_covers, examples)
    assert midland.intersection(martin).area < 1e-4, midland.intersection(martin).area
    print("tx_counties tests passed")


if __name__ == "__main__":
    main()
