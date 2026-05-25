#!/usr/bin/env python3
"""Load a county's RRC well shapefile bundle into Supabase.

Targets the same schema Howard uses (``howard_wells``):

    api_number, latitude, longitude, well_status, well_type, lease_name,
    operator_name, rrc_lease_id, oil_gas_code, abstract, completion_date

Texas RRC publishes per-county well bundles named ``wellNNN.zip`` where
``NNN`` is the FIPS county code. Each bundle contains three companion
shapefiles:

* ``wellNNNs.shp`` — surface points (one per well)
* ``wellNNNb.shp`` — bottom-hole points (one per producing string)
* ``wellNNNl.shp`` — lateral lines (LINESTRING per horizontal lateral)

This loader unpacks the zip, joins the three layers on ``API``, classifies
each well as ``HORIZONTAL`` / ``VERTICAL``, spatially joins each surface
point against the county's abstract polygons (``data/<county>/Abstracts.shp``)
to populate the ``abstract`` join key, and optionally enriches
``operator_name`` / ``lease_name`` / ``rrc_lease_id`` / ``oil_gas_code``
from the same county's CAD owners file via API match.

Usage::

    python3 scripts/load_martin_wells.py
    python3 scripts/load_county_wells_shapefile.py \\
        --county martin --zip data/well317.zip \\
        --abstracts data/martin/Abstracts.shp \\
        --cad-roll data/owners__2025_Martin.xlsx
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import pandas as pd

DEFAULT_COUNTY_ID = "martin"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--county", default=os.getenv("COUNTY_ID", DEFAULT_COUNTY_ID))
    parser.add_argument("--zip", dest="zip_path", default=os.getenv("COUNTY_WELLS_ZIP"))
    parser.add_argument("--fips", default=os.getenv("COUNTY_FIPS_CODE"))
    parser.add_argument(
        "--abstracts",
        default=os.getenv("COUNTY_ABSTRACTS_SHP"),
        help="Path to <county>/Abstracts.shp for the spatial join (default: data/<county>/Abstracts.shp).",
    )
    parser.add_argument(
        "--cad-roll",
        dest="cad_roll",
        default=os.getenv("COUNTY_CAD_ROLL"),
        help="Optional CAD owners file (xlsx/csv) to enrich operator/lease/rrc_lease_id by API match.",
    )
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="DELETE all rows from the target table before inserting.",
    )
    parser.add_argument("--supabase-url")
    parser.add_argument("--supabase-key")
    return parser.parse_args()


def require_env_or_arg(value: str | None, *env_names: str) -> str:
    if value:
        return value
    for env_name in env_names:
        env_value = os.getenv(env_name)
        if env_value:
            return env_value
    joined = " / ".join(env_names)
    raise ValueError(f"Missing required value. Pass argument or set one of: {joined}")


def to_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip()
    return text or None


def to_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
        result = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result


def find_layer(extract_dir: Path, prefix: str, suffix: str):
    target = f"{prefix}{suffix}.shp".lower()
    for candidate in extract_dir.rglob("*.shp"):
        if candidate.name.lower() == target:
            return candidate
    for candidate in extract_dir.rglob("*.shp"):
        if candidate.stem.lower().endswith(suffix):
            return candidate
    return None


def detect_prefix(extract_dir: Path, fips: str | None) -> str:
    if fips:
        return f"well{fips}"
    candidates = sorted({p.stem.rstrip("sblSBL") for p in extract_dir.rglob("*.shp")})
    if not candidates:
        raise FileNotFoundError(f"No .shp files found inside {extract_dir}")
    well_candidates = [c for c in candidates if c.lower().startswith("well")]
    return (well_candidates or candidates)[0]


def load_layers(zip_path: Path, fips: str | None):
    import geopandas as gpd

    if not zip_path.exists():
        raise FileNotFoundError(f"Wells zip not found: {zip_path}")

    extract_dir = Path(tempfile.mkdtemp(prefix="county_wells_"))
    try:
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(extract_dir)

        prefix = detect_prefix(extract_dir, fips)
        surface_path = find_layer(extract_dir, prefix, "s")
        bottom_path = find_layer(extract_dir, prefix, "b")
        lateral_path = find_layer(extract_dir, prefix, "l")

        if surface_path is None:
            raise FileNotFoundError(f"Could not find '{prefix}s.shp' in {zip_path}")

        surface_gdf = gpd.read_file(surface_path)
        bottom_df = pd.DataFrame()
        lateral_df = pd.DataFrame()
        if bottom_path:
            bottom_df = pd.DataFrame(gpd.read_file(bottom_path).drop(columns="geometry", errors="ignore"))
        if lateral_path:
            lateral_df = pd.DataFrame(gpd.read_file(lateral_path).drop(columns="geometry", errors="ignore"))
        return surface_gdf, bottom_df, lateral_df
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)


def normalize_api(value: Any) -> str | None:
    text = to_str(value)
    if text is None:
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return None
    return digits.lstrip("0") or "0"


def load_cad_roll(path: Path) -> dict[str, dict[str, str]]:
    if path.suffix.lower() in {".xlsx", ".xls"}:
        df = pd.read_excel(path, dtype=object)
    else:
        df = pd.read_csv(path, dtype=object, low_memory=False, index_col=False)

    cols = {str(c).strip().lower(): c for c in df.columns}

    def col(*names: str) -> str | None:
        for name in names:
            if name in cols:
                return cols[name]
        return None

    api_col = col("api")
    operator_col = col("operator", "operator_name")
    lease_col = col("well", "lease_name", "county_lease_name")
    rrc_col = col("rrc_id", "rrc_lease_id")
    oil_gas_col = col("class_type", "oil_gas_code")

    if not api_col:
        return {}

    lookup: dict[str, dict[str, str]] = {}
    for _, row in df.iterrows():
        for raw in str(row.get(api_col, "")).split(","):
            api = normalize_api(raw)
            if not api:
                continue
            entry = lookup.setdefault(api, {})
            if operator_col and not entry.get("operator_name"):
                entry["operator_name"] = to_str(row.get(operator_col)) or ""
            if lease_col and not entry.get("lease_name"):
                entry["lease_name"] = to_str(row.get(lease_col)) or ""
            if rrc_col and not entry.get("rrc_lease_id"):
                entry["rrc_lease_id"] = to_str(row.get(rrc_col)) or ""
            if oil_gas_col and not entry.get("oil_gas_code"):
                code = (to_str(row.get(oil_gas_col)) or "").upper()
                # Howard maps RI/WI/etc into oil_gas_code as 'O' (oil),
                # 'G' (gas). The CAD class_type is "C" / "I" (lease class
                # rather than commodity), so don't accept those — better to
                # leave NULL and let downstream fall back to 'O'.
                entry["oil_gas_code"] = code if code in {"O", "G"} else ""
    return lookup


def classify_well_type(stcode: str | None, has_lateral: bool) -> str:
    code = (stcode or "").strip().upper()
    if code.startswith("H") or has_lateral:
        return "HORIZONTAL"
    return "VERTICAL"


def spatial_assign_abstract(surface_gdf, abstracts_path: Path) -> dict[str, str]:
    """Return ``api -> abstract`` for surface wells that fall inside an abstract polygon."""
    import geopandas as gpd

    if not abstracts_path.exists():
        print(f"  abstracts shapefile not found at {abstracts_path}; skipping spatial join")
        return {}

    abstracts = gpd.read_file(abstracts_path)
    if abstracts.crs is None:
        abstracts = abstracts.set_crs("EPSG:4326")
    else:
        abstracts = abstracts.to_crs("EPSG:4326")

    if surface_gdf.crs is None:
        surface_gdf = surface_gdf.set_crs("EPSG:4326")
    else:
        surface_gdf = surface_gdf.to_crs("EPSG:4326")

    abstract_label_col = next(
        (c for c in ("ABSTRACT_L", "ABSTRACT_N", "CODE", "ABSTRACT", "abstract")
         if c in abstracts.columns),
        None,
    )
    if abstract_label_col is None:
        print(f"  abstracts shapefile lacks an abstract column ({list(abstracts.columns)}); skipping")
        return {}

    abstracts_subset = abstracts[[abstract_label_col, "geometry"]].rename(
        columns={abstract_label_col: "_abstract_raw"}
    )
    joined = gpd.sjoin(surface_gdf, abstracts_subset, predicate="within", how="left")
    api_to_abstract: dict[str, str] = {}
    for _, row in joined.iterrows():
        api = normalize_api(row.get("API") or row.get("API10") or row.get("APINUM"))
        raw = to_str(row.get("_abstract_raw"))
        if not api or not raw:
            continue
        # Howard owners store the bare abstract number (e.g. "543"); strip
        # the optional A- prefix from the polygon label so the join keys
        # line up across owners + wells.
        normalized = raw[2:].strip() if raw.upper().startswith("A-") else raw
        api_to_abstract.setdefault(api, normalized)
    return api_to_abstract


def build_well_rows(
    surface_gdf,
    bottom_df,
    lateral_df,
    cad_lookup: dict[str, dict[str, str]],
    api_to_abstract: dict[str, str],
) -> list[dict[str, Any]]:
    bottom_by_api: dict[str, dict[str, Any]] = {}
    if len(bottom_df):
        for record in bottom_df.to_dict(orient="records"):
            api = normalize_api(record.get("API") or record.get("APINUM") or record.get("API10"))
            if not api:
                continue
            bottom_by_api.setdefault(api, record)

    laterals: dict[str, float] = {}
    if len(lateral_df):
        for record in lateral_df.to_dict(orient="records"):
            api = normalize_api(record.get("API") or record.get("API10"))
            if not api:
                continue
            length = to_number(record.get("SHAPE_LEN"))
            if length is not None:
                laterals[api] = max(length, laterals.get(api, 0.0))

    surface_records = pd.DataFrame(surface_gdf.drop(columns="geometry", errors="ignore")).to_dict(orient="records")
    rows: list[dict[str, Any]] = []
    for record in surface_records:
        api = normalize_api(record.get("API") or record.get("API10") or record.get("APINUM"))
        if not api:
            continue
        bottom = bottom_by_api.get(api, {})
        latitude = to_number(record.get("LAT83") or record.get("LAT27"))
        longitude = to_number(record.get("LONG83") or record.get("LONG27"))
        stcode = to_str(bottom.get("STCODE"))
        well_type = classify_well_type(stcode, api in laterals)
        cad = cad_lookup.get(api, {})
        rows.append(
            {
                "api_number": api,
                "latitude": latitude,
                "longitude": longitude,
                "well_status": "ACTIVE",
                "well_type": well_type,
                "lease_name": cad.get("lease_name") or None,
                "operator_name": cad.get("operator_name") or None,
                "rrc_lease_id": cad.get("rrc_lease_id") or None,
                "oil_gas_code": cad.get("oil_gas_code") or None,
                "abstract": api_to_abstract.get(api),
                "completion_date": None,
            }
        )
    return rows


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def main() -> None:
    args = parse_args()
    county_id = args.county.strip().lower()
    table_name = f"{county_id}_wells"

    fips = args.fips or os.getenv("COUNTY_FIPS_CODE")
    zip_path = Path(args.zip_path) if args.zip_path else (
        Path(f"data/well{fips}.zip") if fips else None
    )
    if zip_path is None:
        raise ValueError("Provide --zip or --fips so we can locate the wells bundle.")
    abstracts_path = Path(args.abstracts) if args.abstracts else Path(f"data/{county_id}/Abstracts.shp")

    print(f"Loading wells for county '{county_id}' from {zip_path}", flush=True)
    surface_gdf, bottom_df, lateral_df = load_layers(zip_path, fips)
    print(
        f"Read {len(surface_gdf):,} surface, {len(bottom_df):,} bottom, "
        f"{len(lateral_df):,} lateral records.",
        flush=True,
    )

    api_to_abstract = spatial_assign_abstract(surface_gdf, abstracts_path)
    print(f"Spatial-joined {len(api_to_abstract):,} surface wells to abstracts.", flush=True)

    cad_lookup: dict[str, dict[str, str]] = {}
    if args.cad_roll:
        cad_path = Path(args.cad_roll)
        if not cad_path.exists():
            raise FileNotFoundError(f"--cad-roll path not found: {cad_path}")
        cad_lookup = load_cad_roll(cad_path)
        print(f"Loaded {len(cad_lookup):,} api->lease lookups from {cad_path.name}.", flush=True)

    rows = build_well_rows(surface_gdf, bottom_df, lateral_df, cad_lookup, api_to_abstract)
    horizontal = sum(1 for r in rows if r["well_type"] == "HORIZONTAL")
    with_abstract = sum(1 for r in rows if r["abstract"])
    with_operator = sum(1 for r in rows if r["operator_name"])
    print(
        f"Prepared {len(rows):,} well rows. Horizontal={horizontal:,}, "
        f"WithAbstract={with_abstract:,}, WithOperator={with_operator:,}.",
        flush=True,
    )

    if args.dry_run:
        print("Dry run — first 3 rows:")
        for entry in rows[:3]:
            print(entry)
        return

    try:
        from supabase import create_client
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "Missing dependency 'supabase'. Install with: pip install supabase"
        ) from exc

    supabase_url = require_env_or_arg(args.supabase_url, "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL")
    supabase_key = require_env_or_arg(args.supabase_key, "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY")
    client = create_client(supabase_url, supabase_key)

    if args.truncate:
        print(f"Truncating {table_name} in batches…", flush=True)
        existing = (
            client.table(table_name)
            .select("id")
            .order("id", desc=True)
            .limit(1)
            .execute()
        )
        max_id = (existing.data[0]["id"] if existing.data else 0)
        cursor = 0
        delete_batch = 500
        while cursor <= max_id:
            client.table(table_name).delete().gte("id", cursor).lt("id", cursor + delete_batch).execute()
            cursor += delete_batch
        print(f"  truncate complete (cleared up to id {max_id}).", flush=True)

    total_batches = max(1, math.ceil(len(rows) / args.batch_size))
    written = 0
    for batch_index, batch in enumerate(chunked(rows, args.batch_size), start=1):
        client.table(table_name).insert(batch).execute()
        written += len(batch)
        pct = (written / len(rows)) * 100 if rows else 100.0
        if batch_index == 1 or batch_index % 25 == 0 or batch_index == total_batches:
            print(f"  [{batch_index}/{total_batches}] inserted {written:,}/{len(rows):,} ({pct:.1f}%)", flush=True)

    print(f"Done. Wrote {written:,} rows into {table_name}.")


if __name__ == "__main__":
    main()
