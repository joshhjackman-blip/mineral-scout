#!/usr/bin/env python3
"""Sanity-check public/tx_counties.geojson against Ward/Pecos parcels."""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
COUNTIES = json.loads((ROOT / "public" / "tx_counties.geojson").read_text())
BY_FIPS = {str(f["id"]): f for f in COUNTIES["features"]}


def verts(geom: dict) -> int:
    if geom["type"] == "Polygon":
        return sum(len(r) for r in geom["coordinates"])
    return sum(len(r) for p in geom["coordinates"] for r in p)


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
    print("tx_counties tests passed")


if __name__ == "__main__":
    main()
