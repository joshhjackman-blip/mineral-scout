#!/usr/bin/env python3
"""Build a survey-abstract-style tract layer for Permian section-grid counties.

The StratMap land-parcel shapefiles for counties like Midland/Loving/Reagan/
Upton/Ward describe each parcel by the Texas survey grid in LEGAL_DESC, e.g.
"N/2SW/4, SEC:  47, BLK:  39-T4S". They almost never carry an abstract number.
The owner tax roll, however, packs the same grid *plus* the abstract into its
`survey` column, e.g. "T2S BLK 39 SEC 9     A-62".

So the natural tract = one (block, township, section) cell. This script:

  1. Dissolves land parcels into (block, township, section) polygons.
  2. Derives the dominant abstract number + surveyor name for each cell from
     the owner roll's `survey` text.
  3. Writes data/<county>/Abstracts.shp with the Martin-style schema
     (ABSTRACT_L / ABSTRACT_N / LEVEL1_SUR / LEVEL2_BLO / LEVEL3_SUR /
     Surv_Sect / SHAPE_AREA) that abstract_match.py + rematch_taxroll_to_map.py
     already understand.

Usage:
  python3 scripts/build_county_tracts.py --county midland \
      --src data/_src_midland/midland.shp --roll data/owners_2026_Midland.csv
"""
from __future__ import annotations

import argparse
import re
from collections import Counter, defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent

# Parcel LEGAL_DESC: "... SEC:  47, BLK:  39-T4S"
_P_SEC = re.compile(r"SEC[:\.\s]*([0-9]+[A-Z]?)", re.I)
_P_BLK = re.compile(r"BLK[:\.\s]*([0-9A-Z]+)(?:\s*-\s*(T\d+[NS]))?", re.I)
_P_TWN = re.compile(r"\b(T\d+[NS])\b", re.I)

# Roll survey: "T2S BLK 39 SEC 9     A-62" / "HILLIARD HP BLK X SEC 1 A-11"
_R_TWN = re.compile(r"\b(T\d+[NS])\b", re.I)
_R_BLK = re.compile(r"\bBLK\s*([0-9A-Z]+)", re.I)
_R_SEC = re.compile(r"\bSEC\s*([0-9]+[A-Z]?)", re.I)
_R_ABS = re.compile(r"\bA[-\s]?([0-9]+[A-Z]?)\b", re.I)


def norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().upper())


def parcel_key(legal: str):
    u = norm(legal)
    b = _P_BLK.search(u)
    s = _P_SEC.search(u)
    if not (b and s):
        return None
    block = b.group(1)
    twn = (b.group(2) or "")
    if not twn:
        t = _P_TWN.search(u)
        twn = t.group(1) if t else ""
    return (block.upper(), twn.upper(), s.group(1).upper())


def roll_key(survey: str):
    u = norm(survey)
    b = _R_BLK.search(u)
    s = _R_SEC.search(u)
    if not (b and s):
        return None, None, None
    t = _R_TWN.search(u)
    twn = t.group(1) if t else ""
    a = _R_ABS.search(u)
    abstract = a.group(1) if a else None
    # surveyor name = text before the first township / BLK token
    name = u.split(" BLK ")[0]
    name = _R_TWN.sub("", name).strip()
    return (b.group(1).upper(), twn.upper(), s.group(1).upper()), abstract, (name or None)


def build_roll_lookup(roll_path: Path):
    """(block,twn,sec) -> {'abstract': dominant, 'survey': dominant name}."""
    abs_votes: dict[tuple, Counter] = defaultdict(Counter)
    name_votes: dict[tuple, Counter] = defaultdict(Counter)
    for chunk in pd.read_csv(roll_path, dtype=object, low_memory=False,
                             index_col=False, usecols=["survey"], chunksize=100000):
        for sv in chunk["survey"].fillna(""):
            key, abstract, name = roll_key(sv)
            if not key:
                continue
            if abstract:
                abs_votes[key][abstract] += 1
            if name:
                name_votes[key][name] += 1
    out = {}
    keys = set(abs_votes) | set(name_votes)
    for k in keys:
        out[k] = {
            "abstract": (abs_votes[k].most_common(1)[0][0] if abs_votes.get(k) else None),
            "survey": (name_votes[k].most_common(1)[0][0] if name_votes.get(k) else None),
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--county", required=True)
    ap.add_argument("--src", required=True, help="land-parcel .shp path")
    ap.add_argument("--roll", required=True, help="owners_2026_<County>.csv path")
    args = ap.parse_args()

    print(f"Reading parcels: {args.src}", flush=True)
    g = gpd.read_file(args.src)
    if g.crs is None:
        g = g.set_crs("EPSG:4326")
    else:
        g = g.to_crs("EPSG:4326")
    g["_key"] = g["LEGAL_DESC"].map(parcel_key)
    placed = g["_key"].notna().sum()
    print(f"  parcels with block/section: {placed}/{len(g)} ({100*placed/len(g):.1f}%)", flush=True)
    g = g[g["_key"].notna()].copy()
    g["block"] = g["_key"].map(lambda k: k[0])
    g["twn"] = g["_key"].map(lambda k: k[1])
    g["sec"] = g["_key"].map(lambda k: k[2])

    print("Dissolving into (block, township, section) tracts...", flush=True)
    tracts = g.dissolve(by=["block", "twn", "sec"], as_index=False)[["block", "twn", "sec", "geometry"]]
    print(f"  tracts: {len(tracts)}", flush=True)

    print(f"Deriving abstract/survey labels from roll: {args.roll}", flush=True)
    lookup = build_roll_lookup(Path(args.roll))
    print(f"  roll grid cells with data: {len(lookup)}", flush=True)

    # acreage: project to TX-centric equal-area (EPSG:6580, US survey ft) → acres
    area_ac = tracts.to_crs("EPSG:5070").geometry.area / 4046.8564224

    def label_row(i, r):
        key = (r["block"], r["twn"], r["sec"])
        info = lookup.get(key, {})
        absn = info.get("abstract")
        survey = info.get("survey") or ""
        blk_lvl = f"{r['block']} {r['twn']}".strip()
        if absn:
            abstract_l = f"A-{absn}"
            abstract_n = absn
        else:
            # synthetic but unique so the tract is still matchable/renderable
            abstract_l = f"B{r['block']}-{r['twn']}-S{r['sec']}"
            abstract_n = ""
        return abstract_l, abstract_n, survey, blk_lvl, r["sec"]

    labels = [label_row(i, r) for i, r in tracts.iterrows()]
    tracts["ABSTRACT_L"] = [x[0] for x in labels]
    tracts["ABSTRACT_N"] = [x[1] for x in labels]
    tracts["LEVEL1_SUR"] = [x[2] for x in labels]
    tracts["LEVEL2_BLO"] = [x[3] for x in labels]
    tracts["LEVEL3_SUR"] = [x[4] for x in labels]
    tracts["Surv_Sect"] = tracts["sec"]
    tracts["SHAPE_AREA"] = area_ac.values
    with_abs = sum(1 for x in labels if x[1])
    print(f"  tracts with a roll-derived abstract: {with_abs}/{len(tracts)}", flush=True)

    out_dir = ROOT / "data" / args.county
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "Abstracts.shp"
    keep = tracts[["ABSTRACT_L", "ABSTRACT_N", "LEVEL1_SUR", "LEVEL2_BLO",
                   "LEVEL3_SUR", "Surv_Sect", "SHAPE_AREA", "geometry"]].copy()
    keep.to_file(out)
    print(f"Wrote {out} ({len(keep)} tracts)", flush=True)


if __name__ == "__main__":
    main()
