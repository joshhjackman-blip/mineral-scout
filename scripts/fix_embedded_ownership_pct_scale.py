#!/usr/bin/env python3
"""One-time migration: fix the 100x-inflated ownership_pct embedded in the
`owners_json` of the *_parcels_enriched.geojson files.

Background
----------
The DB (`<county>_mineral_ownership.ownership_pct`) stores each interest as a
raw 0-1 decimal (e.g. 0.0025 = a 0.25% override royalty), and the frontend
multiplies by 100 for display (`ownershipPctIsDecimal`). The enrichment
scripts, however, ALSO multiplied by 100 when baking `owners_json` into the
enriched GeoJSON, so the embedded value was already a percent (0.25). The
frontend then multiplied again -> "25%", a 100x overstatement.

The enrichment scripts are fixed to store the raw decimal going forward. This
script brings the already-committed GeoJSON in line without a full
re-enrichment: it divides every embedded `ownership_pct` by 100, which is
mathematically identical to what the fixed scripts would emit (verified: the
embedded values were uniformly DB x 100).

Idempotent: a top-level `_ownership_pct_scale: "decimal"` marker is written so
re-runs are no-ops.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
from typing import Any

MARKER_KEY = "_ownership_pct_scale"
MARKER_VALUE = "decimal"


def migrate_file(path: str) -> tuple[int, int, bool]:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    if data.get(MARKER_KEY) == MARKER_VALUE:
        return (0, 0, False)

    features = data.get("features") or []
    features_changed = 0
    owners_changed = 0

    for ft in features:
        props = ft.get("properties") or {}
        oj = props.get("owners_json")
        if oj is None:
            continue
        was_str = isinstance(oj, str)
        try:
            owners: Any = json.loads(oj) if was_str else oj
        except (TypeError, ValueError):
            continue
        if not isinstance(owners, list):
            continue

        changed = False
        for owner in owners:
            if not isinstance(owner, dict):
                continue
            pct = owner.get("ownership_pct")
            if isinstance(pct, bool):
                continue
            if isinstance(pct, (int, float)):
                owner["ownership_pct"] = round(pct / 100.0, 8)
                owners_changed += 1
                changed = True

        if changed:
            props["owners_json"] = json.dumps(owners) if was_str else owners
            features_changed += 1

    data[MARKER_KEY] = MARKER_VALUE
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    return (features_changed, owners_changed, True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "files",
        nargs="*",
        help="Enriched GeoJSON files (default: public/*_parcels_enriched.geojson)",
    )
    args = ap.parse_args()

    files = args.files or sorted(
        glob.glob(os.path.join("public", "*_parcels_enriched.geojson"))
    )
    for path in files:
        feats, owners, wrote = migrate_file(path)
        if wrote:
            print(f"{path}: rescaled {owners} interests across {feats} tracts")
        else:
            print(f"{path}: already migrated — skipped")


if __name__ == "__main__":
    main()
