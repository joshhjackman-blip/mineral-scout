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

Town / city lots (no survey section or abstract) are dropped. Keeping them
painted a 10k-lot grid over Pecos and Reeves, stacked dark-green overlaps on
top of the real sections, and labeled junk like BlockMOBILE / Block53PSL.

Pecos CAD writes the abstract as a leading number and T&P township as
"{block}-{twn}", e.g. "5270  48-8 T&P SEC 20". Reeves often glues tokens
("AB 5603BLK 55 SEC 33PSL"). Both are accepted; English words after BLK/BLOCK
are not.

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

# Parcel LEGAL_DESC comes in several shapes across Permian CADs:
#   Midland grid:  "N/2SW/4, SEC:  47, BLK:  39-T4S"        (block+township+section)
#   Ward H&TC:     "SEC 34 (A425) BLOCK 1 H&TC"             (explicit abstract in parens)
#   Upton U-Lands: "UNIVERSITY LAND BLOCK 5 SECT 19 227 AC" (spelled "SECT"/"SECTION")
#   Reagan surveys:"AB 935 SEC 2 D L CARVER"               (abstract written "AB <n>")
#   Upton surveys: "1270 PATTERSON W A SEC 98 1303 AC"      (leading-number abstract)
#   Pecos T&P:     "5270  48-8 T&P SEC 20"                 (abstract, block-twn, survey)
#   Reeves glued:  "AB 5603BLK 55 SEC 33PSL"               (missing spaces / PSL suffix)
# So: accept BLK/BLOCK, SEC/SECT/SECTION, an explicit A####/AB #### abstract, and
# (guarded) a leading abstract number. Missing SECT lost ~73% of Upton and the
# "AB <n>" gap lost ~64% of Reagan, which is why rigs sat in un-tracted white space.
#
# Block tokens are survey blocks only: digits, digits+one letter, a single
# letter, or letter-hyphen-digits (C-16). Greedy [0-9A-Z]+ turned
# "BLOCK MOBILE HOME", "BLK 53PSL", and "BLK 55TWP" into map labels.
_P_SEC = re.compile(
    r"(?:\bSEC(?:TION|T)?|(?<=[A-Z&])SEC)\.?[:\s]*([0-9]+)(?![0-9])",
    re.I,
)
# Pecos sometimes writes "SE 17" instead of "SEC 17".
_P_SE = re.compile(r"\bSE\s+(\d{1,3})\b", re.I)
_P_BLK = re.compile(
    # No leading \b — Reeves glues AB 5603BLK. Reject a letter immediately
    # before BLK so "PUBLIC" does not match.
    r"(?<![A-Z])(?:BLK|BLOCK)[:\.\s]*"
    r"([0-9]{1,4}(?:[A-Z](?![A-Z]))?|[A-Z]-\d{1,3}|[A-Z]{1,2}(?![A-Z]))"
    r"(?:-(\d{1,2}))?"
    r"(?:PSL|TWP)?"
    r"(?:\s*-\s*(T\d+[NS]))?",
    re.I,
)
_P_TWN = re.compile(r"\b(T\d+[NS])\b", re.I)
# Explicit abstract token, e.g. "A425", "A-425", "AB 935", "AB 5603BLK".
# Do not require a trailing word-boundary after the digits: Reeves glues
# BLK onto the abstract number.
_P_ABS = re.compile(r"\bA(?:B)?[-\s]?([0-9]{1,5})(?![0-9])", re.I)
# Leading-number abstract, e.g. "1270 PATTERSON W A SEC 98" or Pecos
# "5270  48-8 T&P SEC 20" / "8795  1 H&TC  SEC 16".
# Trusted only when the desc also has a section (see parcel_info).
_P_LEADABS = re.compile(
    r"^\s*([0-9]{1,5})",
    re.I,
)
# Optional block sitting between the leading abstract and the survey name.
_P_LEADBLK = re.compile(
    r"^\s*[0-9]{1,5}(?:[-&,]\s*[0-9]{1,5})*\s+"
    r"([0-9]{1,4}|[A-Z](?:-\d{1,3})?|[A-Z])(?:-([0-9]{1,2}))?\s+[A-Z&]",
    re.I,
)

# Roll survey: "T2S BLK 39 SEC 9     A-62" / "HILLIARD HP BLK X SEC 1 A-11"
_R_TWN = re.compile(r"\b(T\d+[NS])\b", re.I)
_R_BLK = re.compile(
    r"\bBLK\s*([0-9]{1,4}(?:[A-Z](?![A-Z]))?|[A-Z]-\d{1,3}|[A-Z]{1,2}(?![A-Z]))",
    re.I,
)
_R_SEC = re.compile(r"\bSEC(?:TION|T)?\.?[:\s]*([0-9]+)(?![0-9])", re.I)
_R_ABS = re.compile(r"\bA(?:B)?[-\s]?([0-9]+[A-Z]?)(?![0-9])", re.I)

# English / subdivision words that must never become a survey block label.
_BLOCK_REJECT = re.compile(
    r"^(MOBILE|ORIGINAL|COLLEGE|PECOS|IRAAN|ORIENT|ADDITION|TOWN|CITY|"
    r"LOT|LOTS|TRACT|PARK|HOME|VILLAGE|MEADOW|VET|VETS)$",
    re.I,
)


def norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().upper())


def _clean_block(block: str) -> str:
    b = (block or "").strip().upper()
    if not b or _BLOCK_REJECT.match(b):
        return ""
    return b


def parcel_info(legal: str):
    """Return (tract_key, abstract, block, twn, sec) or None.

    Prefer an explicit abstract (Ward-style) as the dissolve key; otherwise
    fall back to the (block, township, section) grid (Midland-style).
    Town lots with no abstract and no section are dropped.
    """
    u = norm(legal)
    b = _P_BLK.search(u)
    s = _P_SEC.search(u)
    a = _P_ABS.search(u)
    block = _clean_block(b.group(1) if b else "")
    twn = ""
    if b and b.group(3):
        twn = b.group(3)
    elif b and b.group(2):
        twn = f"T{b.group(2)}"
    if not twn:
        t = _P_TWN.search(u)
        twn = t.group(1) if t else ""
    twn = twn.upper()
    sec = s.group(1).upper() if s else ""
    if not sec:
        se = _P_SE.search(u)
        sec = se.group(1).upper() if se else ""
    abstract = a.group(1) if a else ""
    # Leading-number abstract when there's a section but no A/AB abstract.
    # Pecos writes "5270  48-8 T&P SEC 20"; requiring a following letter
    # (old leadabs) dropped every T&P block-township cell.
    if not abstract and sec:
        la = _P_LEADABS.search(u)
        if la:
            abstract = la.group(1)
            if not block:
                lb = _P_LEADBLK.search(u)
                if lb:
                    block = _clean_block(lb.group(1))
                    if not twn and lb.group(2):
                        twn = f"T{lb.group(2)}"
    if abstract:
        return (f"A:{abstract}", abstract, block, twn, sec)
    if block and sec:
        return (f"G:{block}|{twn}|{sec}", "", block, twn, sec)
    return None


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


def fill_county_holes(tracts: gpd.GeoDataFrame, source: gpd.GeoDataFrame,
                      min_acres: float = 200.0) -> gpd.GeoDataFrame:
    """Add large leftover polygons inside the CAD footprint.

    Union of source parcels minus union of dissolved survey tracts. Only
    pieces >= min_acres are kept so Fort Stockton / Pecos city lots do not
    become a second tract layer. Labels have no block, so they never render
    as BlockMOBILE.
    """
    if tracts.empty or source.empty:
        return tracts
    src_u = source.geometry.union_all() if hasattr(source.geometry, "union_all") else source.unary_union
    tr_u = tracts.geometry.union_all() if hasattr(tracts.geometry, "union_all") else tracts.unary_union
    if src_u is None or src_u.is_empty or tr_u is None or tr_u.is_empty:
        return tracts
    leftover = src_u.difference(tr_u)
    if leftover is None or leftover.is_empty:
        return tracts
    holes = gpd.GeoDataFrame(geometry=[leftover], crs=tracts.crs).explode(index_parts=False)
    holes = holes[~holes.geometry.is_empty & holes.geometry.notna()].copy()
    if holes.empty:
        return tracts
    acres = holes.to_crs("EPSG:5070").geometry.area / 4046.8564224
    holes = holes.loc[acres.values >= min_acres].copy()
    if holes.empty:
        return tracts
    rows = []
    for i, geom in enumerate(holes.geometry):
        rows.append({
            "tkey": f"H:{i}",
            "pabs": "",
            "block": "",
            "twn": "",
            "sec": "",
            "geometry": geom,
        })
    extra = gpd.GeoDataFrame(rows, crs=tracts.crs)
    print(f"  hole-fill tracts: {len(extra)} (>= {min_acres:.0f} ac CAD gaps)", flush=True)
    return gpd.GeoDataFrame(pd.concat([tracts, extra], ignore_index=True), crs=tracts.crs)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--county", required=True)
    ap.add_argument("--src", required=True, help="land-parcel .shp or .gdb path")
    ap.add_argument(
        "--roll",
        default=None,
        help="owners_2026_<County>.csv path. Optional: without it, abstracts "
             "come only from parcel LEGAL_DESC (grid keys when missing).",
    )
    args = ap.parse_args()

    print(f"Reading parcels: {args.src}", flush=True)
    g = gpd.read_file(args.src)
    if g.crs is None:
        g = g.set_crs("EPSG:4326")
    else:
        g = g.to_crs("EPSG:4326")
    source_all = g[["geometry"]].copy()
    parsed = []
    dropped = 0
    for legal in g["LEGAL_DESC"].tolist():
        info = parcel_info(legal)
        if info:
            parsed.append(info)
        else:
            parsed.append(None)
            dropped += 1
    placed = len(g) - dropped
    print(
        f"  parcels resolved to a tract: {placed}/{len(g)} ({100*placed/len(g):.1f}%); "
        f"dropped town/unparsed lots: {dropped}",
        flush=True,
    )
    keep_idx = [i for i, info in enumerate(parsed) if info is not None]
    g = g.iloc[keep_idx].copy()
    kept = [parsed[i] for i in keep_idx]
    g["tkey"] = [k[0] for k in kept]
    g["pabs"] = [k[1] for k in kept]
    g["block"] = [k[2] for k in kept]
    g["twn"] = [k[3] for k in kept]
    g["sec"] = [k[4] for k in kept]

    print("Dissolving into tracts (explicit abstract, else block/township/section)...", flush=True)
    tracts = g.dissolve(by="tkey", as_index=False, aggfunc="first")[
        ["tkey", "pabs", "block", "twn", "sec", "geometry"]
    ]
    print(f"  tracts: {len(tracts)}", flush=True)
    tracts = fill_county_holes(tracts, source_all)

    lookup = {}
    if args.roll:
        print(f"Deriving abstract/survey labels from roll: {args.roll}", flush=True)
        lookup = build_roll_lookup(Path(args.roll))
        print(f"  roll grid cells with data: {len(lookup)}", flush=True)
    else:
        print("No owner roll: labeling tracts from parcel LEGAL_DESC only", flush=True)

    def label_row(i, r):
        # Prefer the parcel's own explicit abstract; else the roll-derived one
        # for this (block, township, section) grid cell.
        absn = str(r["pabs"] or "").strip()
        gridkey = (r["block"], r["twn"], r["sec"])
        info_r = lookup.get(gridkey, {})
        if not absn:
            absn = info_r.get("abstract") or ""
        survey = info_r.get("survey") or ""
        blk_lvl = f"{r['block']} {r['twn']}".strip()
        if absn:
            abstract_l = f"A-{absn}"
            abstract_n = absn
        elif r["block"] and r["sec"]:
            abstract_l = f"B{r['block']}-{r['twn']}-S{r['sec']}"
            abstract_n = ""
        else:
            abstract_l = str(r["tkey"])
            abstract_n = ""
        return abstract_l, abstract_n, survey, blk_lvl, r["sec"]

    labels = [label_row(i, r) for i, r in tracts.iterrows()]
    tracts["ABSTRACT_L"] = [x[0] for x in labels]
    tracts["ABSTRACT_N"] = [x[1] for x in labels]
    tracts["LEVEL1_SUR"] = [x[2] for x in labels]
    tracts["LEVEL2_BLO"] = [x[3] for x in labels]
    tracts["LEVEL3_SUR"] = [x[4] for x in labels]
    tracts["Surv_Sect"] = tracts["sec"]
    with_abs = sum(1 for x in labels if x[1])
    print(f"  tracts with an abstract: {with_abs}/{len(tracts)}", flush=True)

    # Merge any tracts that resolved to the SAME abstract label into one
    # polygon. Two adjacent grid cells can map to the same roll-derived
    # abstract; leaving duplicate ABSTRACT_L breaks the map's per-abstract
    # keying and the tract_development_status upsert (ON CONFLICT twice).
    before = len(tracts)
    tracts = tracts.dissolve(by="ABSTRACT_L", as_index=False, aggfunc="first")
    if len(tracts) != before:
        print(f"  merged duplicate-abstract tracts: {before} -> {len(tracts)}", flush=True)
    tracts["SHAPE_AREA"] = tracts.to_crs("EPSG:5070").geometry.area / 4046.8564224
    try:
        tracts["geometry"] = tracts.geometry.make_valid()
    except Exception:
        pass

    out_dir = ROOT / "data" / args.county
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "Abstracts.shp"
    keep = tracts[["ABSTRACT_L", "ABSTRACT_N", "LEVEL1_SUR", "LEVEL2_BLO",
                   "LEVEL3_SUR", "Surv_Sect", "SHAPE_AREA", "geometry"]].copy()
    keep.to_file(out)
    print(f"Wrote {out} ({len(keep)} tracts)", flush=True)


if __name__ == "__main__":
    main()
