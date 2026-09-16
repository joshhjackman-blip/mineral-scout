#!/usr/bin/env python3
"""Shared tax-roll legal → abstract polygon matching.

Supports both CAD Abstracts.shp schemas:

* Howard: CODE / Block ("31 T2N") / Surv_Sect / Surv_Name
* Martin: ABSTRACT_L ("A-1013") / LEVEL1_SUR / LEVEL2_BLO / LEVEL3_SUR

Strategies (in order):
1. Explicit abstract column / A-XXXX in survey text
2. T&P block + township + section lookup against Abstracts.shp
3. CSL / named-surveyor fallbacks
4. RRC lease → abstract mapping CSV
5. Lat/lon point-in-polygon into Abstracts.shp
"""

from __future__ import annotations

import csv
import math
import re
from pathlib import Path
from typing import Any

_TOWNSHIP_RE = re.compile(r"\b(T\d+[NS])\b", re.IGNORECASE)
# Reeves T&P writes the township before the block number: "BLK T2S 57 SEC 46".
_BLK_TWN_NUM_RE = re.compile(
    r"\bBLK\s+(T\d+[NS])\s+(\d{1,4}[A-Z]?)\b",
    re.IGNORECASE,
)
# Midland / Howard / Reeves: "BLK 35", "BLK 55-5", "BLK C-16".
_BLK_NUM_RE = re.compile(
    r"\bBLK\s+([0-9]{1,4}(?:[A-Z](?![A-Z]))?|[A-Z]-\d{1,3}|[A-Z]{1,2}(?![A-Z]))"
    r"(?:-(\d{1,2}))?",
    re.IGNORECASE,
)
# Legacy single-token capture (Howard "BLK 35").
_BLOCK_RE = re.compile(r"\bBLK\s*([A-Z0-9]+)", re.IGNORECASE)
_SECTION_RE = re.compile(r"\bSEC(?:TION|T)?\.?\s*([0-9]+)(?![0-9])", re.IGNORECASE)
# "AB 2210" / "A-1013" / "A 654". Do not capture the B of AB as the abstract.
_ABSTRACT_RE = re.compile(r"\bA(?:B)?[-\s]?([0-9]{1,5}[A-Z]?)\b", re.IGNORECASE)
# Pecos roll: "GC&SF B-119 S-18" (block / section, no BLK or SEC words).
_B_DASH_RE = re.compile(r"(?<![A-Z])B-(\d{1,4})\b", re.IGNORECASE)
_S_DASH_RE = re.compile(r"(?<![A-Z])S-(\d{1,4})\b", re.IGNORECASE)
_CSL_RE = re.compile(r"\b(\w+)\s+CSL\b", re.IGNORECASE)
_LGE_RE = re.compile(r"\bLGE\s+(\d+)", re.IGNORECASE)
_BLO_SPLIT_RE = re.compile(
    r"^(\d{1,4}[A-Z]?|[A-Z]-\d{1,3}|[A-Z]{1,2})\s+(T\d+[NS]?)$",
    re.IGNORECASE,
)


def clean_str(value: Any) -> str | None:
    if value is None:
        return None
    try:
        if isinstance(value, float) and math.isnan(value):
            return None
    except Exception:
        pass
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    return text


def bare_abstract(value: Any) -> str | None:
    text = clean_str(value)
    if not text:
        return None
    text = re.sub(r"^A-", "", text, flags=re.IGNORECASE).strip()
    # Drop broken ingest sentinel seen in older Martin loads.
    if not text or text.upper() == "SEC":
        return None
    return text


def township_variants(twn: str, *, allow_empty: bool = False) -> list[str]:
    """T2S and CAD 'T2' are the same T&P township. Do not flip N/S."""
    t = (twn or "").strip().upper()
    if not t:
        return [""]
    out = [t]
    m = re.fullmatch(r"T(\d+)([NS]?)", t)
    if m:
        num, hemi = m.group(1), m.group(2)
        out.append(f"T{num}")
        if hemi:
            out.append(f"T{num}{hemi}")
    if allow_empty:
        out.append("")
    seen: set[str] = set()
    uniq: list[str] = []
    for v in out:
        if v not in seen:
            seen.add(v)
            uniq.append(v)
    return uniq


def grid_from_text(survey_text: str) -> tuple[str, str, str]:
    """Return (block_num, township, section) from a roll or CAD legal string."""
    upper = (survey_text or "").upper()
    block = ""
    twn = ""
    sec = ""
    m = _BLK_TWN_NUM_RE.search(upper)
    if m:
        twn = m.group(1).upper()
        block = m.group(2).upper()
    else:
        m = _BLK_NUM_RE.search(upper)
        if m:
            block = m.group(1).upper()
            if m.group(2):
                twn = f"T{m.group(2)}"
    if not twn:
        tm = _TOWNSHIP_RE.search(upper)
        if tm:
            twn = tm.group(1).upper()
    sm = _SECTION_RE.search(upper)
    if sm:
        sec = sm.group(1).upper()
    if not block or not sec:
        bm = list(_B_DASH_RE.finditer(upper))
        sm2 = list(_S_DASH_RE.finditer(upper))
        if bm:
            block = block or bm[-1].group(1)
        if sm2:
            sec = sec or sm2[-1].group(1)
    return block, twn, sec


def parse_legal_description(survey_text: str) -> dict[str, str | None]:
    text = clean_str(survey_text)
    if not text:
        return {"abstract": None, "block": None, "section": None, "survey": None}

    upper = text.upper()
    abstract_match = _ABSTRACT_RE.search(upper)
    abstract = abstract_match.group(1) if abstract_match else None
    block_num, twn, sec = grid_from_text(upper)
    if block_num and twn:
        block_value = f"{block_num} {twn}"
    else:
        block_value = block_num or None

    cleaned = _ABSTRACT_RE.sub("", upper)
    cleaned = _SECTION_RE.sub("", cleaned)
    cleaned = _BLK_TWN_NUM_RE.sub("", cleaned)
    cleaned = _BLK_NUM_RE.sub("", cleaned)
    cleaned = _BLOCK_RE.sub("", cleaned)
    cleaned = _TOWNSHIP_RE.sub("", cleaned)
    cleaned = _B_DASH_RE.sub("", cleaned)
    cleaned = _S_DASH_RE.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -·")
    return {
        "abstract": abstract,
        "block": block_value,
        "section": sec or None,
        "survey": cleaned or None,
    }


def build_abstract_lookups(abstracts_path: Path) -> dict[str, dict]:
    """Build geometry-aware fallbacks from a county Abstracts.shp."""
    empty: dict[str, dict] = {"tp": {}, "csl": {}, "surveyor": {}, "codes": {}}
    if not abstracts_path.exists():
        return empty
    try:
        import geopandas as gpd
    except ModuleNotFoundError:
        return empty

    gdf = gpd.read_file(abstracts_path)
    tp: dict[tuple[str, str, str], str] = {}
    csl: dict[tuple[str, str], str] = {}
    surveyor: dict[tuple[str, str], str] = {}
    codes: dict[str, str] = {}

    for _, row in gdf.iterrows():
        # Canonical label + bare code
        if clean_str(row.get("ABSTRACT_L")):
            label = str(row.get("ABSTRACT_L")).strip()
            code = bare_abstract(label) or ""
        elif clean_str(row.get("CODE")):
            code = bare_abstract(row.get("CODE")) or ""
            label = f"A-{code}" if code else ""
        else:
            continue
        if not code:
            continue
        codes[code] = label if label.upper().startswith("A-") else f"A-{code}"

        # Martin-style attributes
        sur_raw = (clean_str(row.get("LEVEL1_SUR")) or "").upper()
        blo = (clean_str(row.get("LEVEL2_BLO")) or "").upper()
        sec = (clean_str(row.get("LEVEL3_SUR")) or "").upper()

        # Howard-style attributes
        if not blo:
            blo = (clean_str(row.get("Block")) or "").upper()
        if not sec:
            sec = (clean_str(row.get("Surv_Sect")) or "").upper()
        if not sur_raw:
            sur_raw = (clean_str(row.get("Surv_Name")) or "").upper()

        blo_m = _BLO_SPLIT_RE.match(blo)
        if blo_m and sec:
            blk_n, twn_n = blo_m.group(1).upper(), blo_m.group(2).upper()
            for twn_v in township_variants(twn_n, allow_empty=True):
                tp.setdefault((blk_n, twn_v, sec), codes[code])
        elif blo and blo.replace(" ", "").replace("-", "").isalnum() and sec:
            # Block without township (Howard sometimes stores bare "27")
            tp.setdefault((blo.split()[0], "", sec), codes[code])

        if sur_raw and sec:
            first = re.split(r"[\s,]", sur_raw, 1)[0]
            if "CSL" in sur_raw:
                csl.setdefault((first, sec), codes[code])
            if first:
                surveyor.setdefault((first, sec), codes[code])

    return {"tp": tp, "csl": csl, "surveyor": surveyor, "codes": codes}


def lookup_abstract_via_shapefile(survey_text: str, lookups: dict[str, dict]) -> str | None:
    if not survey_text or not lookups:
        return None
    upper = survey_text.upper()

    def _bare(label: str) -> str:
        return re.sub(r"^A-", "", label.strip(), flags=re.IGNORECASE)

    block, twn, sec = grid_from_text(upper)
    if block and sec:
        tp = lookups.get("tp", {})
        for twn_v in township_variants(twn, allow_empty=not bool(twn)):
            key = (block, twn_v, sec)
            if key in tp:
                return _bare(tp[key])

    m_csl = _CSL_RE.search(upper)
    m_lge = _LGE_RE.search(upper)
    if m_csl and m_lge:
        key = (m_csl.group(1).upper(), m_lge.group(1))
        if key in lookups.get("csl", {}):
            return _bare(lookups["csl"][key])

    first_word = upper.split()[0] if upper else ""
    if first_word:
        for num in re.findall(r"\d+", upper):
            key = (first_word, num)
            if key in lookups.get("surveyor", {}):
                return _bare(lookups["surveyor"][key])
    return None


def load_lease_abstract_map(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    with path.open(newline="", encoding="utf-8", errors="replace") as handle:
        for row in csv.DictReader(handle):
            lid = clean_str(row.get("rrc_lease_id"))
            lab = bare_abstract(row.get("abstract_label"))
            if lid and lab:
                out[lid] = lab
    return out


def owner_coords(row: dict[str, Any]) -> tuple[float, float] | None:
    candidates = [
        (row.get("lat"), row.get("long")),
        (row.get("lat"), row.get("lon")),
        (row.get("latitude"), row.get("longitude")),
    ]
    rr = row.get("raw_record")
    if isinstance(rr, dict):
        candidates.extend(
            [
                (rr.get("lat"), rr.get("long")),
                (rr.get("lat"), rr.get("lon")),
                (rr.get("latitude"), rr.get("longitude")),
            ]
        )
    for lat_v, lon_v in candidates:
        try:
            lat = float(lat_v)
            lon = float(lon_v)
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(lat) and math.isfinite(lon)):
            continue
        if abs(lat) < 1 or abs(lon) < 1:
            continue
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
            continue
        return lon, lat
    return None


class AbstractMatcher:
    """Resolve owner rows to bare abstract codes present in a county shapefile."""

    def __init__(
        self,
        abstracts_path: Path,
        lease_map_path: Path | None = None,
    ) -> None:
        import geopandas as gpd
        from shapely.strtree import STRtree

        self.lookups = build_abstract_lookups(abstracts_path)
        self.codes: dict[str, str] = dict(self.lookups.get("codes") or {})
        self.lease_map = load_lease_abstract_map(
            lease_map_path or Path("data/lease_abstract_mapping.csv")
        )

        gdf = gpd.read_file(abstracts_path)
        if gdf.crs is None:
            gdf = gdf.set_crs("EPSG:4326")
        else:
            gdf = gdf.to_crs("EPSG:4326")
        self.gdf = gdf
        self._geoms = list(gdf.geometry.values)
        self._labels: list[str] = []
        for _, row in gdf.iterrows():
            if clean_str(row.get("ABSTRACT_L")):
                bare = bare_abstract(row.get("ABSTRACT_L")) or ""
            else:
                bare = bare_abstract(row.get("CODE")) or ""
            self._labels.append(bare)
        self._tree = STRtree(self._geoms)

    def label_for(self, bare: str) -> str:
        return self.codes.get(bare, f"A-{bare}" if bare else "")

    def resolve(self, row: dict[str, Any]) -> tuple[str | None, str]:
        """Return (bare_abstract, method)."""
        rr = row.get("raw_record") if isinstance(row.get("raw_record"), dict) else {}
        survey = clean_str(row.get("survey")) or clean_str(rr.get("survey")) or ""
        if rr.get("survey") and len(str(rr.get("survey"))) > len(survey):
            survey = clean_str(rr.get("survey")) or survey
        abstract = bare_abstract(row.get("abstract"))
        # "AB 2210" was ingested as abstract "B" — ignore one-letter ghosts.
        if abstract and len(abstract) <= 2 and abstract.isalpha():
            abstract = None
        block = clean_str(row.get("block")) or ""
        section = clean_str(row.get("section")) or ""

        if abstract and abstract in self.codes:
            return abstract, "explicit_abstract"

        parsed = parse_legal_description(survey)
        if parsed["abstract"] and parsed["abstract"] in self.codes:
            return parsed["abstract"], "parse_a_token"

        # Structured columns (Howard often has block/section filled).
        haystack = " ".join(x for x in [survey, block, section] if x)
        via = lookup_abstract_via_shapefile(haystack, self.lookups)
        if via and via in self.codes:
            return via, "shapefile_lookup"

        # If block/section columns exist without BLK/SEC keywords, synthesize.
        if block and section:
            twn = _TOWNSHIP_RE.search(block.upper())
            blk_num = block.split()[0]
            synth = f"BLK {blk_num} SEC {section}"
            if twn:
                synth = f"{twn.group(0)} {synth}"
            via = lookup_abstract_via_shapefile(synth, self.lookups)
            if via and via in self.codes:
                return via, "block_section_cols"

        rrc = clean_str(row.get("rrc_id") or row.get("rrc_lease_id"))
        if rrc:
            # Normalize "56506.0"
            try:
                rrc = str(int(float(rrc)))
            except Exception:
                pass
            mapped = self.lease_map.get(rrc)
            if mapped and mapped in self.codes:
                return mapped, "lease_map"

        coords = owner_coords(row)
        if coords is not None:
            from shapely.geometry import Point

            point = Point(coords[0], coords[1])
            for i in self._tree.query(point):
                if self._geoms[i].contains(point) and self._labels[i] in self.codes:
                    return self._labels[i], "spatial"

        return None, "unplaced"
