#!/usr/bin/env python3
"""Generate slim GeoJSON files for the Mapbox renderer.

The full *_parcels_enriched.geojson files are 24–53 MB because they embed
``owners_json`` (a complete list of mineral owners per tract) inside every
feature. The CRM panel needs that data, but Mapbox does not — it only reads
geometry + a handful of small properties. Shipping the heavy file to the
worker thread for tile generation was causing visible coloring delay at
low/medium zoom.

This script reads the existing enriched files and emits a parallel
*_parcels_map.geojson that retains only the props the map actually uses.
The full files are still served to the rest of the app.
"""

from __future__ import annotations

import json
from pathlib import Path

# Property keys that the map cares about. Anything not in this set is
# stripped before the file is written.
KEEP_PROPS = {
    # Identifiers / labels
    'ABSTRACT_L', 'ABSTRACT_N', 'CODE',
    # Survey/legal description. Field-name convention varies by county:
    #   Howard   — Surv_Name / Block / Surv_Sect / DESC_
    #   Martin   — LEVEL1_SUR / LEVEL2_BLO / LEVEL3_SUR / LEVEL4_SUR
    #   Gonzales — LEVEL1_SUR / LEVEL2_BLO / TEXTSTRING (abstract label)
    # LEVEL3_SUR carries Martin's per-tract section number ("131", "36",
    # etc.) — the same role Surv_Sect plays for Howard. The section
    # labels layer in app/components/Map.tsx coalesces the two, so
    # keeping LEVEL3_SUR here is what makes Martin's section numbers
    # actually render on the map.
    'Block', 'Surv_Name', 'Surv_Sect', 'DESC_',
    'LEVEL1_SUR', 'LEVEL2_BLO', 'LEVEL3_SUR', 'LEVEL4_SUR', 'TEXTSTRING',
    # Geometry helpers
    'SHAPE_AREA', 'STArea__',
    # Paint inputs
    'max_propensity_score',
    # Misc that the map labels/popups read
    'owner_count', 'top_operator', 'field_name',
    'first_date', 'production_trend', 'est_lease_expiration',
}

INPUT_OUTPUT_PAIRS = [
    ('public/gonzales_parcels_enriched.geojson', 'public/gonzales_parcels_map.geojson'),
    ('public/howard_parcels_enriched.geojson',   'public/howard_parcels_map.geojson'),
    ('public/martin_parcels_enriched.geojson',   'public/martin_parcels_map.geojson'),
]


def slim_feature(feature: dict) -> dict:
    props = feature.get('properties') or {}
    slim_props = {k: props[k] for k in KEEP_PROPS if k in props}
    return {
        'type': 'Feature',
        'geometry': feature.get('geometry'),
        'properties': slim_props,
    }


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    for in_rel, out_rel in INPUT_OUTPUT_PAIRS:
        in_path = repo_root / in_rel
        out_path = repo_root / out_rel
        if not in_path.exists():
            print(f'skip: {in_rel} not found')
            continue

        in_size = in_path.stat().st_size
        with in_path.open() as f:
            collection = json.load(f)

        slim = {
            'type': 'FeatureCollection',
            'features': [slim_feature(feat) for feat in collection.get('features', [])],
        }

        # No pretty-printing: smallest payload to ship to the browser.
        with out_path.open('w') as f:
            json.dump(slim, f, separators=(',', ':'))

        out_size = out_path.stat().st_size
        ratio = (out_size / in_size) * 100 if in_size else 0
        print(
            f'{in_rel} -> {out_rel}: {in_size / 1e6:.1f} MB -> '
            f'{out_size / 1e6:.2f} MB ({ratio:.1f}% of original)'
        )


if __name__ == '__main__':
    main()
