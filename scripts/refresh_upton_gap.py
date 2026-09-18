#!/usr/bin/env python3
"""Rebuild Upton tracts from the RRC survey grid and rematch the tax roll.

CAD dissolve left a rectangular hole (and smaller slivers) in the Upton
map. Official RRC Surveys layer 24 fills those polygons. Then rematch
owners and retag production_status.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from onboard_2026_counties import (  # noqa: E402
    download_rrc_well_zip,
    download_storage_object,
    pull_roll_from_storage,
    upload_map_asset,
)


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd, cwd=ROOT)


def main() -> None:
    abstracts = ROOT / "data" / "upton" / "Abstracts.shp"
    if not abstracts.exists():
        run([sys.executable, "scripts/download_rrc_surveys.py", "--county", "upton"])

    roll = ROOT / "data" / "owners_2026_Upton.csv"
    if not roll.exists():
        pull_roll_from_storage("upton", roll)
    if roll.exists() and abstracts.exists():
        run([
            sys.executable, "scripts/rematch_taxroll_to_map.py",
            "--county", "upton", "--skip-map-slim",
        ])
    else:
        print("skip rematch: missing Upton roll or Abstracts.shp", flush=True)

    wells_zip = ROOT / "data" / "well461.zip"
    if not wells_zip.exists():
        if not download_storage_object("well461.zip", wells_zip):
            download_rrc_well_zip("461", wells_zip)

    enriched = ROOT / "public" / "upton_parcels_enriched.geojson"
    if not enriched.exists() or enriched.stat().st_size < 10_000:
        enriched = ROOT / "public" / "upton_parcels_map.geojson"
    if wells_zip.exists() and enriched.exists():
        run([
            sys.executable, "scripts/add_production_status.py",
            "--county", "upton",
            "--from-shapefile",
            "--wells-zip", str(wells_zip),
            "--input-geojson", str(enriched),
        ])
        run([sys.executable, "scripts/build_map_geojson.py", "--county", "upton"])

    for kind in ("parcels_map", "parcels_enriched"):
        upload_map_asset(
            f"upton_{kind}.geojson",
            ROOT / "public" / f"upton_{kind}.geojson",
        )


if __name__ == "__main__":
    main()
