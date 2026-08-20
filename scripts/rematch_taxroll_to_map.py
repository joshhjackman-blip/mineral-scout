#!/usr/bin/env python3
"""Rematch mineral tax-roll owners onto CAD abstract polygons (offline).

Reads the vendor roll (Howard CSV / Martin XLSX), resolves every row to an
abstract via scripts/abstract_match.py, rebuilds *_parcels_enriched.geojson
(+ slim map GeoJSON), and prints coverage before/after.

Usage:
  python3 scripts/rematch_taxroll_to_map.py --county howard
  python3 scripts/rematch_taxroll_to_map.py --county martin
  python3 scripts/rematch_taxroll_to_map.py --county all
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from abstract_match import AbstractMatcher, bare_abstract, clean_str  # noqa: E402
from load_county_mineral_records import compute_propensity_score  # noqa: E402

COUNTY_ROLLS = {
    "howard": ROOT / "data" / "howard_mineral_roll.csv",
    "martin": ROOT / "data" / "owners_2026_Martin.csv",
    "midland": ROOT / "data" / "owners_2026_Midland.csv",
    "loving": ROOT / "data" / "owners_2026_Loving.csv",
    "reagan": ROOT / "data" / "owners_2026_Reagan.csv",
    "upton": ROOT / "data" / "owners_2026_Upton.csv",
    "ward": ROOT / "data" / "owners_2026_Ward.csv",
}
COUNTY_ABSTRACTS = {
    "howard": ROOT / "data" / "howard" / "Abstracts.shp",
    "martin": ROOT / "data" / "martin" / "Abstracts.shp",
    "midland": ROOT / "data" / "midland" / "Abstracts.shp",
    "loving": ROOT / "data" / "loving" / "Abstracts.shp",
    "reagan": ROOT / "data" / "reagan" / "Abstracts.shp",
    "upton": ROOT / "data" / "upton" / "Abstracts.shp",
    "ward": ROOT / "data" / "ward" / "Abstracts.shp",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--county", default="all",
                   choices=["howard", "martin", "midland", "loving", "reagan", "upton", "ward", "all"])
    p.add_argument("--skip-map-slim", action="store_true")
    return p.parse_args()


def load_roll(path: Path) -> list[dict[str, Any]]:
    # Howard's CSV has a trailing empty header column that shifts fields
    # under pandas; use the stdlib reader for CSV and pandas only for xlsx.
    if path.suffix.lower() in {".xlsx", ".xls"}:
        df = pd.read_excel(path)
        df = df.loc[:, [c for c in df.columns if c and not str(c).startswith("Unnamed")]]
        records: list[dict[str, Any]] = []
        for row in df.to_dict(orient="records"):
            clean = {
                str(k): (None if (isinstance(v, float) and math.isnan(v)) else v)
                for k, v in row.items()
            }
            records.append(clean)
        return records

    import csv

    records = []
    with path.open(newline="", encoding="utf-8", errors="replace") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            clean = {
                str(k): (v.strip() if isinstance(v, str) else v)
                for k, v in row.items()
                if k is not None and str(k).strip() != ""
            }
            records.append(clean)
    return records


def owner_payload(row: dict[str, Any], abstract: str) -> dict[str, Any]:
    state = (clean_str(row.get("state")) or "").upper()
    out_of_state = bool(state) and state not in {"TX", "TEXAS"}
    address_parts = [
        clean_str(row.get("address1")),
        clean_str(row.get("address2")),
        clean_str(row.get("address3")),
        clean_str(row.get("address4")),
    ]
    mailing_address = ", ".join(p for p in address_parts if p) or None

    try:
        acreage = float(row.get("acres")) if row.get("acres") not in (None, "") else None
    except (TypeError, ValueError):
        acreage = None
    try:
        interest = float(row.get("interest")) if row.get("interest") not in (None, "") else None
    except (TypeError, ValueError):
        interest = None
    try:
        value = float(row.get("value")) if row.get("value") not in (None, "") else None
    except (TypeError, ValueError):
        value = None

    rrc = clean_str(row.get("rrc_id"))
    if rrc:
        try:
            rrc = str(int(float(rrc)))
        except Exception:
            pass

    payload = {
        "owner_name": clean_str(row.get("owner")) or "",
        "mailing_address": mailing_address,
        "mailing_city": clean_str(row.get("city")) or "",
        "mailing_state": state,
        "mailing_zip": clean_str(row.get("zip")) or "",
        "operator_name": clean_str(row.get("operator")) or "",
        "field_name": clean_str(row.get("field_name")) or "",
        "rrc_lease_id": rrc or "",
        "acreage": acreage,
        "ownership_pct": (round(interest * 100.0, 6) if interest is not None else None),
        "appraised_value": value,
        "abstract": abstract,
        "survey": clean_str(row.get("survey")),
        "out_of_state": out_of_state,
        "raw_record": {"Interest": interest, "lat": row.get("lat"), "long": row.get("long")},
    }
    score = compute_propensity_score(payload, out_of_state)
    payload["propensity_score"] = score
    payload["motivated"] = score >= 5
    # Stable-ish id for counting unique owners
    payload["_uid"] = (
        f"{row.get('owner_id') or payload['owner_name']}|{rrc or ''}|{abstract}|"
        f"{payload.get('ownership_pct')}|{row.get('_key') or row.get('searchndx') or ''}"
    )
    return payload


def preserve_activity_props(existing_path: Path) -> dict[str, dict[str, Any]]:
    """Keep production_status / well counts from a prior enriched file."""
    if not existing_path.exists():
        return {}
    data = json.loads(existing_path.read_text(encoding="utf-8"))
    out: dict[str, dict[str, Any]] = {}
    keep = {
        "production_status",
        "pdp_well_count",
        "pud_well_count",
        "well_count",
        "permit_count",
        "new_permit_count",
        "pending_permit_count",
    }
    for feat in data.get("features") or []:
        props = feat.get("properties") or {}
        key = str(props.get("ABSTRACT_L") or props.get("CODE") or "").strip().upper()
        if not key:
            continue
        if not key.startswith("A-") and key.isdigit():
            key = f"A-{key}"
        out[key] = {k: props.get(k) for k in keep if k in props}
    return out


def rematch_county(county: str) -> dict[str, Any]:
    roll_path = COUNTY_ROLLS[county]
    abstracts_path = COUNTY_ABSTRACTS[county]
    if not roll_path.exists():
        raise FileNotFoundError(roll_path)
    if not abstracts_path.exists():
        raise FileNotFoundError(abstracts_path)

    print(f"\n=== {county.upper()} ===")
    print(f"Roll: {roll_path}")
    print(f"Abstracts: {abstracts_path}")

    matcher = AbstractMatcher(abstracts_path)
    rows = load_roll(roll_path)
    print(f"Roll rows: {len(rows):,}")

    method_counts: Counter[str] = Counter()
    owners_by_label: dict[str, list[dict[str, Any]]] = defaultdict(list)
    placed = 0
    for row in rows:
        bare, method = matcher.resolve(row)
        method_counts[method] += 1
        if not bare:
            continue
        placed += 1
        label = matcher.label_for(bare)
        owners_by_label[label.upper()].append(owner_payload(row, bare))

    print("Match methods:")
    for method, count in method_counts.most_common():
        print(f"  {method:20s} {count:8,}  ({100 * count / max(len(rows), 1):.1f}%)")
    print(
        f"Placed owner-rows: {placed:,} / {len(rows):,} "
        f"({100 * placed / max(len(rows), 1):.1f}%)"
    )

    parcels = gpd.read_file(abstracts_path)
    if parcels.crs is None:
        parcels = parcels.set_crs("EPSG:4326")
    else:
        parcels = parcels.to_crs("EPSG:4326")

    if "CODE" in parcels.columns:
        parcels["ABSTRACT_N"] = parcels["CODE"].map(lambda v: bare_abstract(v) or "")
        parcels["ABSTRACT_L"] = parcels["ABSTRACT_N"].map(lambda c: f"A-{c}" if c else "")
    else:
        parcels["ABSTRACT_L"] = parcels["ABSTRACT_L"].map(lambda v: str(v or "").strip())
        parcels["ABSTRACT_N"] = parcels["ABSTRACT_L"].map(lambda v: bare_abstract(v) or "")

    prior = preserve_activity_props(ROOT / "public" / f"{county}_parcels_enriched.geojson")
    if not prior:
        prior = preserve_activity_props(ROOT / "data" / f"{county}_parcels_enriched.geojson")

    matched_polygons = 0
    represented: set[str] = set()

    for idx in parcels.index:
        label = str(parcels.at[idx, "ABSTRACT_L"] or "").strip().upper()
        owners = owners_by_label.get(label, [])
        # Also try bare-code key if label missing A-
        if not owners:
            bare = bare_abstract(label) or ""
            owners = owners_by_label.get(f"A-{bare}", [])

        for key, val in (prior.get(label) or {}).items():
            parcels.at[idx, key] = val

        if not owners:
            parcels.at[idx, "owner_count"] = 0
            parcels.at[idx, "top_owner"] = ""
            parcels.at[idx, "top_owner_state"] = ""
            parcels.at[idx, "top_operator"] = ""
            parcels.at[idx, "max_propensity_score"] = 0
            parcels.at[idx, "field_name"] = "Unknown"
            parcels.at[idx, "owners_json"] = "[]"
            if "production_trend" not in parcels.columns:
                parcels.at[idx, "production_trend"] = "stable"
            elif not parcels.at[idx, "production_trend"]:
                parcels.at[idx, "production_trend"] = "stable"
            continue

        matched_polygons += 1
        represented.update(str(o.get("_uid")) for o in owners)
        highest = max(owners, key=lambda o: int(o.get("propensity_score") or 0))
        op_counter = Counter(
            (o.get("operator_name") or "").strip()
            for o in owners
            if (o.get("operator_name") or "").strip()
        )
        field_counter = Counter(
            (o.get("field_name") or "").strip()
            for o in owners
            if (o.get("field_name") or "").strip()
        )
        parcels.at[idx, "owner_count"] = len(owners)
        parcels.at[idx, "top_owner"] = highest.get("owner_name") or ""
        parcels.at[idx, "top_owner_state"] = highest.get("mailing_state") or ""
        parcels.at[idx, "top_operator"] = op_counter.most_common(1)[0][0] if op_counter else ""
        parcels.at[idx, "max_propensity_score"] = int(highest.get("propensity_score") or 0)
        parcels.at[idx, "field_name"] = (
            field_counter.most_common(1)[0][0] if field_counter else "Unknown"
        )

        panel = []
        for owner in sorted(owners, key=lambda o: int(o.get("propensity_score") or 0), reverse=True):
            panel.append(
                {
                    "owner_name": owner.get("owner_name") or "",
                    "propensity_score": int(owner.get("propensity_score") or 0),
                    "mailing_city": owner.get("mailing_city") or "",
                    "mailing_state": owner.get("mailing_state") or "",
                    "mailing_zip": owner.get("mailing_zip") or "",
                    "address_1": owner.get("mailing_address") or "",
                    "out_of_state": bool(owner.get("out_of_state")),
                    "motivated": bool(owner.get("motivated")),
                    "operator_name": owner.get("operator_name") or "",
                    "rrc_lease_id": str(owner.get("rrc_lease_id") or ""),
                    "acreage": owner.get("acreage") or 0,
                    "ownership_pct": owner.get("ownership_pct") or 0,
                }
            )
        parcels.at[idx, "owners_json"] = json.dumps(panel)

    out_data = ROOT / "data" / f"{county}_parcels_enriched.geojson"
    out_public = ROOT / "public" / f"{county}_parcels_enriched.geojson"
    out_data.parent.mkdir(parents=True, exist_ok=True)
    parcels.to_file(out_data, driver="GeoJSON")
    out_public.write_text(out_data.read_text(encoding="utf-8"), encoding="utf-8")

    stats = {
        "county": county,
        "roll_rows": len(rows),
        "placed_rows": placed,
        "placed_pct": round(100 * placed / max(len(rows), 1), 2),
        "tracts": len(parcels),
        "tracts_with_owners": matched_polygons,
        "tract_pct": round(100 * matched_polygons / max(len(parcels), 1), 2),
        "methods": dict(method_counts),
        "enriched": str(out_public),
    }
    print(
        f"Tracts with owners: {matched_polygons:,} / {len(parcels):,} "
        f"({stats['tract_pct']}%)"
    )
    print(f"Wrote {out_public}")
    return stats


def slim_map_geojson(county: str) -> None:
    # Reuse build_map_geojson logic via subprocess for one county filter if needed.
    import subprocess

    subprocess.check_call([sys.executable, str(ROOT / "scripts" / "build_map_geojson.py")])
    print(f"Slim map GeoJSON refreshed (includes {county})")


def main() -> None:
    args = parse_args()
    counties = ["howard", "martin"] if args.county == "all" else [args.county]
    all_stats = []
    for county in counties:
        all_stats.append(rematch_county(county))
    if not args.skip_map_slim:
        import subprocess

        subprocess.check_call([sys.executable, str(ROOT / "scripts" / "build_map_geojson.py")])
    print("\n=== SUMMARY ===")
    print(json.dumps(all_stats, indent=2))


if __name__ == "__main__":
    main()
