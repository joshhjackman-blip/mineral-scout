#!/usr/bin/env python3
"""Rebuild well colors + tract production_status for the 2026 counties.

Downloads rematched enriched GeoJSON from public map-data, classifies
tracts from the wells shapefile (bottom-hole = PDP), rebuilds laterals
with real kinds, and uploads the slim map + wells layers.

Pecos/Reeves rebuild Abstracts from the RRC public survey grid (official
GLO abstracts / sections). TNRIS CAD ownership parcels leave ranch-sized
holes and over-merged beige blobs.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from onboard_2026_counties import (  # noqa: E402
    COUNTIES,
    _storage_creds,
    curl,
    download_storage_object,
    pull_roll_from_storage,
    upload_map_asset,
)

REFRESH = ("howard", "glasscock", "reeves", "pecos", "crane")
REBUILD_TRACTS = ("pecos", "reeves", "crane")


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd, cwd=ROOT)


def download_map_data(name: str, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    creds = _storage_creds()
    if not creds:
        return False
    base, key_env = creds
    print(f"  GET map-data/{name} -> {dest}", flush=True)
    r = curl([
        "-H", f"apikey: {key_env}",
        "-H", f"Authorization: Bearer {key_env}",
        "-o", str(dest),
        "-w", "%{http_code}",
        f"{base}/storage/v1/object/public/map-data/{name}",
    ])
    code = r.stdout.decode().strip() if r and r.returncode == 0 else "ERR"
    if dest.exists() and dest.stat().st_size > 1000 and code.startswith("2"):
        print(f"  downloaded {dest} ({dest.stat().st_size:,} bytes)", flush=True)
        return True
    dest.unlink(missing_ok=True)
    print(f"  map-data miss {name} (http={code})", flush=True)
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--county", default="all", choices=["all", *REFRESH])
    ap.add_argument("--skip-tract-rebuild", action="store_true")
    args = ap.parse_args()
    names = list(REFRESH) if args.county == "all" else [args.county]

    for county in names:
        cfg = COUNTIES[county]
        print(f"\n=== refresh {county} ===", flush=True)
        roll = ROOT / "data" / cfg["roll"]
        if not roll.exists():
            pull_roll_from_storage(county, roll)
        wells_zip = ROOT / "data" / f"well{cfg['fips']}.zip"
        if not wells_zip.exists():
            download_storage_object(f"well{cfg['fips']}.zip", wells_zip)

        abstracts = ROOT / "data" / county / "Abstracts.shp"
        if county in REBUILD_TRACTS and not args.skip_tract_rebuild:
            run([
                sys.executable, "scripts/download_rrc_surveys.py",
                "--county", county,
            ])

        # Always rematch the roll onto Abstracts.shp so we never publish
        # the empty git baseline (that wiped Reeves/Pecos owners once).
        if roll.exists() and abstracts.exists():
            run([
                sys.executable, "scripts/rematch_taxroll_to_map.py",
                "--county", county, "--skip-map-slim",
            ])

        enriched = ROOT / "public" / f"{county}_parcels_enriched.geojson"
        if not enriched.exists() or enriched.stat().st_size < 10_000_000:
            download_map_data(f"{county}_parcels_enriched.geojson", enriched)

        if enriched.exists() and wells_zip.exists():
            run([
                sys.executable, "scripts/add_production_status.py",
                "--county", county,
                "--input-geojson", str(enriched),
                "--wells-zip", str(wells_zip),
            ])
            run([sys.executable, "scripts/build_map_geojson.py", "--county", county])

        if wells_zip.exists():
            wcmd = [sys.executable, "scripts/build_wells_geojson.py", "--county", county]
            if os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY"):
                wcmd.append("--upload")
            run(wcmd)

        for kind in ("parcels_enriched", "parcels_map", "wells"):
            upload_map_asset(
                f"{county}_{kind}.geojson",
                ROOT / "public" / f"{county}_{kind}.geojson",
            )


if __name__ == "__main__":
    main()
