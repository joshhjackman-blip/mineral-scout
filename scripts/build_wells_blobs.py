#!/usr/bin/env python3
"""Prototype "blob" coloring: turn the per-well geometry into status-colored
development footprints so a tract isn't a single flat color when it holds
multiple designations (PDP / DUC / permitted / …).

Method: buffer each lateral (and vertical/permit well) by ~half the typical
well spacing, dissolve by status `kind`, and clip to the county's tracts. The
result is one (Multi)Polygon per kind — overlaps between kinds blend via the
map layer's transparency, giving the multi-colored-within-a-tract look.

NOTE: the lateral *lines* are surveyed/exact; these blobs are an interpretive
drainage/spacing footprint (the buffer width is an assumption), not a legal
unit. Reads the already-built public/<county>_wells.geojson + the tract map
geojson — no shapefile re-read.

Usage:
  python3 scripts/build_wells_blobs.py --county loving --buffer-ft 330
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
# Render order: undeveloped/horizontal first (bottom), active signals on top.
KIND_ORDER = ["vertical", "horizontal", "permitted", "injection", "shut_in", "duc", "producing"]


def build(county: str, buffer_ft: float, out_dir: str) -> None:
    wells_path = ROOT / "public" / f"{county}_wells.geojson"
    tracts_path = ROOT / "public" / f"{county}_parcels_map.geojson"
    if not wells_path.exists():
        raise SystemExit(f"missing {wells_path} (run build_wells_geojson.py first)")

    wells = json.loads(wells_path.read_text())
    by_kind: dict[str, list] = {}
    for f in wells["features"]:
        k = f["properties"].get("kind")
        g = f.get("geometry")
        if not k or not g:
            continue
        by_kind.setdefault(k, []).append(shape(g))

    # Tract union (to clip blobs to mapped land, not blank space).
    clip_geom = None
    if tracts_path.exists():
        tg = json.loads(tracts_path.read_text())
        clip_geom = unary_union([shape(f["geometry"]) for f in tg["features"] if f.get("geometry")])

    buffer_m = buffer_ft * 0.3048
    features = []
    for kind in KIND_ORDER:
        geoms = by_kind.get(kind)
        if not geoms:
            continue
        # Buffer in an equal-distance projection (EPSG:5070, meters), dissolve,
        # then back to WGS84.
        gs = gpd.GeoSeries(geoms, crs="EPSG:4326").to_crs(5070)
        blob = gs.buffer(buffer_m).union_all()
        blob = blob.buffer(0)  # clean self-intersections
        blob4326 = gpd.GeoSeries([blob], crs=5070).to_crs(4326).iloc[0]
        if clip_geom is not None:
            blob4326 = blob4326.intersection(clip_geom)
        if blob4326.is_empty:
            continue
        # Light simplification to keep the file small (~10 m tolerance).
        blob4326 = blob4326.simplify(0.0001, preserve_topology=True)
        features.append({
            "type": "Feature",
            "geometry": json.loads(gpd.GeoSeries([blob4326]).to_json())["features"][0]["geometry"],
            "properties": {"kind": kind},
        })

    out = ROOT / out_dir / f"{county}_blobs.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                              separators=(",", ":")))
    kinds = [f["properties"]["kind"] for f in features]
    print(f"{county}: {len(features)} blob layers {kinds} -> {out} ({out.stat().st_size/1e6:.2f} MB)")


def upload(county: str, out_dir: str) -> None:
    import os
    from urllib.parse import urlparse
    import httpx
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("--upload needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    p = urlparse(url); base = f"{p.scheme}://{p.netloc}"
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    blob = (ROOT / out_dir / f"{county}_blobs.geojson").read_bytes()
    with httpx.Client(timeout=120) as c:
        c.post(f"{base}/storage/v1/bucket", headers={**h, "Content-Type": "application/json"},
               json={"id": "map-data", "name": "map-data", "public": True})
        r = c.post(f"{base}/storage/v1/object/map-data/{county}_blobs.geojson",
                   headers={**h, "Content-Type": "application/json", "x-upsert": "true",
                            "cache-control": "max-age=300"},
                   content=blob)
        if r.status_code >= 300:
            raise SystemExit(f"blob upload failed ({r.status_code}): {r.text[:200]}")
        print(f"  uploaded map-data/{county}_blobs.geojson")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--county", default="loving")
    ap.add_argument("--buffer-ft", type=float, default=330.0)
    ap.add_argument("--out", default="public")
    ap.add_argument("--upload", action="store_true")
    args = ap.parse_args()
    for c in [x.strip() for x in args.county.split(",") if x.strip()]:
        build(c, args.buffer_ft, args.out)
        if args.upload:
            upload(c, args.out)


if __name__ == "__main__":
    main()
