#!/usr/bin/env python3
"""Tag Upton tracts with production_status and rebuild the wells overlay.

Upton's slim map never got add_production_status, so every tract painted
Frontier green. Wells already have scrape statuses; rebuild them with
SYMNUM fallback for the ACTIVE/empty stubs, then upload map-data.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from onboard_2026_counties import (  # noqa: E402
    download_rrc_well_zip,
    download_storage_object,
    upload_map_asset,
)


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd, cwd=ROOT)


def main() -> None:
    wells_zip = ROOT / "data" / "well461.zip"
    if not wells_zip.exists():
        if not download_storage_object("well461.zip", wells_zip):
            download_rrc_well_zip("461", wells_zip)
    if not wells_zip.exists():
        raise SystemExit("missing data/well461.zip")

    enriched = ROOT / "public" / "upton_parcels_enriched.geojson"
    run([
        sys.executable, "scripts/add_production_status.py",
        "--county", "upton",
        "--from-shapefile",
        "--wells-zip", str(wells_zip),
        "--input-geojson", str(enriched),
    ])
    run([sys.executable, "scripts/build_map_geojson.py", "--county", "upton"])

    wcmd = [sys.executable, "scripts/build_wells_geojson.py", "--county", "upton"]
    if os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY"):
        wcmd.append("--upload")
    run(wcmd)

    for kind in ("parcels_map", "wells"):
        upload_map_asset(
            f"upton_{kind}.geojson",
            ROOT / "public" / f"upton_{kind}.geojson",
        )


if __name__ == "__main__":
    main()
