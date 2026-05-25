#!/usr/bin/env python3
"""Load a county's RRC well shapefile bundle into Supabase.

Texas RRC publishes per-county well bundles named ``wellNNN.zip`` where
``NNN`` is the FIPS county code. Each bundle contains three companion
shapefiles:

* ``wellNNNs.shp`` — surface points (one per well)
* ``wellNNNb.shp`` — bottom-hole points (one per producing string)
* ``wellNNNl.shp`` — lateral lines (LINESTRING per horizontal lateral)

This script unpacks the zip, joins the three layers on ``API``/``API10``,
classifies each well as horizontal or vertical, and upserts a flat row
per well into ``<county>_wells``.

The output schema mirrors what ``app/api/wells/route.ts`` expects:
``api``, ``api10``, ``latitude``, ``longitude``, ``well_type``,
``rrc_lease_id``, ``operator_name``, ``lease_name``, ``oil_gas_code``,
plus a few useful identifiers. Operator/lease/oil_gas_code aren't in the
shapefile itself — they're populated only when ``--cad-roll`` is passed
pointing at the same county mineral roll, in which case the loader
joins on ``api`` to fill those columns.

Usage::

    python3 scripts/load_martin_wells.py --zip data/well317.zip
    python3 scripts/load_county_wells_shapefile.py \\
        --county martin --zip data/well317.zip \\
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
    parser.add_argument(
        "--county",
        default=os.getenv("COUNTY_ID", DEFAULT_COUNTY_ID),
        help="County id (matches lib/counties.ts entry, e.g. 'martin', 'howard').",
    )
    parser.add_argument(
        "--zip",
        dest="zip_path",
        default=os.getenv("COUNTY_WELLS_ZIP"),
        help="Path to wellNNN.zip. Defaults to data/well<fipsCode>.zip when --fips is provided.",
    )
    parser.add_argument(
        "--fips",
        default=os.getenv("COUNTY_FIPS_CODE"),
        help=(
            "3-digit county FIPS code (e.g. '317' for Martin, '227' for Howard). "
            "Used to default --zip and the inner shapefile prefix."
        ),
    )
    parser.add_argument(
        "--cad-roll",
        dest="cad_roll",
        default=os.getenv("COUNTY_CAD_ROLL"),
        help=(
            "Optional path to the CAD mineral owners file (xlsx/csv) used to "
            "fill operator_name / lease_name / rrc_lease_id by API match."
        ),
    )
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true", help="Parse only, do not write to Supabase.")
    parser.add_argument("--supabase-url", help="Supabase URL. Defaults to NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL.")
    parser.add_argument("--supabase-key", help="Service role key. Defaults to SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY.")
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


def find_layer(extract_dir: Path, prefix: str, suffix: str) -> Path | None:
    """Return path to the first ``<prefix><suffix>.shp`` (case-insensitive) found."""
    target = f"{prefix}{suffix}.shp".lower()
    for candidate in extract_dir.rglob("*.shp"):
        if candidate.name.lower() == target:
            return candidate
    # Fallback: any *.shp ending in suffix (handles renamed bundles).
    for candidate in extract_dir.rglob("*.shp"):
        if candidate.stem.lower().endswith(suffix):
            return candidate
    return None


def detect_prefix(extract_dir: Path, fips: str | None) -> str:
    """Pick the inner shapefile prefix (e.g. ``well317`` or ``well227``)."""
    if fips:
        return f"well{fips}"
    candidates = sorted({p.stem.rstrip("sblSBL") for p in extract_dir.rglob("*.shp")})
    if not candidates:
        raise FileNotFoundError(f"No .shp files found inside {extract_dir}")
    # Prefer entries that start with 'well'.
    well_candidates = [c for c in candidates if c.lower().startswith("well")]
    return (well_candidates or candidates)[0]


def load_layers(zip_path: Path, fips: str | None) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    try:
        import geopandas as gpd
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "Missing dependency 'geopandas'. Install with: pip install geopandas"
        ) from exc

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
        bottom_gdf = gpd.read_file(bottom_path) if bottom_path else gpd.GeoDataFrame()
        lateral_gdf = gpd.read_file(lateral_path) if lateral_path else gpd.GeoDataFrame()
        return (
            pd.DataFrame(surface_gdf.drop(columns="geometry", errors="ignore")),
            pd.DataFrame(bottom_gdf.drop(columns="geometry", errors="ignore")) if len(bottom_gdf) else pd.DataFrame(),
            pd.DataFrame(lateral_gdf.drop(columns="geometry", errors="ignore")) if len(lateral_gdf) else pd.DataFrame(),
        )
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)


def normalize_api(value: Any) -> str | None:
    """RRC publishes API as int and string forms; normalize to a 14-char zero-padded key."""
    text = to_str(value)
    if text is None:
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return None
    return digits.zfill(14)[:14]


def load_cad_roll(path: Path) -> dict[str, dict[str, str]]:
    """Load a county mineral roll (xlsx/csv) keyed by 14-digit API.

    Returns a mapping ``api -> { operator_name, lease_name, rrc_lease_id, oil_gas_code }``
    for filling well rows that came from the geometry-only RRC shapefile.
    Multiple owner rows can share the same API; we keep the first value seen
    for each non-empty field.
    """
    if path.suffix.lower() in {".xlsx", ".xls"}:
        df = pd.read_excel(path, dtype=str)
    else:
        df = pd.read_csv(path, dtype=str, low_memory=False)

    cols = {c.strip().lower(): c for c in df.columns}

    def col(*names: str) -> str | None:
        for name in names:
            if name in cols:
                return cols[name]
        return None

    api_col = col("api")
    operator_col = col("operator", "operator_name")
    lease_col = col("well", "lease_name", "county_lease_name")
    rrc_col = col("rrc_id", "rrc_lease_id")
    oil_gas_col = col("class_type", "oil_gas_code", "rrc_oil_and_gas_code")

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
                entry["oil_gas_code"] = (to_str(row.get(oil_gas_col)) or "").upper() or ""
    return lookup


def classify_well_type(stcode: str | None, has_lateral: bool) -> str:
    """Heuristic well classification.

    RRC ``STCODE`` of ``H1``/``H2``... means a horizontal completion. A row
    that participates in a lateral feature is also horizontal. Everything
    else falls back to ``vertical``.
    """
    code = (stcode or "").strip().upper()
    if code.startswith("H") or has_lateral:
        return "horizontal"
    return "vertical"


def build_well_rows(
    surface_df: pd.DataFrame,
    bottom_df: pd.DataFrame,
    lateral_df: pd.DataFrame,
    cad_lookup: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    bottom_by_api: dict[str, dict[str, Any]] = {}
    if len(bottom_df):
        for record in bottom_df.to_dict(orient="records"):
            api = normalize_api(record.get("API") or record.get("APINUM") or record.get("API10"))
            if not api:
                continue
            bottom_by_api.setdefault(api, record)

    lateral_lengths: dict[str, float] = {}
    if len(lateral_df):
        for record in lateral_df.to_dict(orient="records"):
            api = normalize_api(record.get("API") or record.get("API10"))
            if not api:
                continue
            length = to_number(record.get("SHAPE_LEN"))
            if length is not None:
                lateral_lengths[api] = max(length, lateral_lengths.get(api, 0.0))

    rows: list[dict[str, Any]] = []
    for record in surface_df.to_dict(orient="records"):
        api = normalize_api(record.get("API") or record.get("API10") or record.get("APINUM"))
        if not api:
            continue
        bottom = bottom_by_api.get(api, {})
        latitude = to_number(record.get("LAT83") or record.get("LAT27"))
        longitude = to_number(record.get("LONG83") or record.get("LONG27"))
        bottom_latitude = to_number(bottom.get("LAT83") or bottom.get("LAT27"))
        bottom_longitude = to_number(bottom.get("LONG83") or bottom.get("LONG27"))
        stcode = to_str(bottom.get("STCODE"))
        has_lateral = api in lateral_lengths
        well_type = classify_well_type(stcode, has_lateral)
        cad = cad_lookup.get(api, {})

        rows.append(
            {
                "api": api,
                "api10": to_str(record.get("API10") or bottom.get("API10")),
                "well_id": to_str(record.get("WELLID")),
                "surface_id": to_str(record.get("SURFACE_ID") or bottom.get("SURFACE_ID")),
                "bottom_id": to_str(bottom.get("BOTTOM_ID")),
                "latitude": latitude,
                "longitude": longitude,
                "bottom_latitude": bottom_latitude,
                "bottom_longitude": bottom_longitude,
                "st_code": stcode,
                "well_type": well_type,
                "lateral_length": lateral_lengths.get(api),
                "abstract": None,
                "lease_name": cad.get("lease_name") or None,
                "operator_name": cad.get("operator_name") or None,
                "rrc_lease_id": cad.get("rrc_lease_id") or None,
                "oil_gas_code": cad.get("oil_gas_code") or None,
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

    print(f"Loading wells for county '{county_id}' from {zip_path}")
    surface_df, bottom_df, lateral_df = load_layers(zip_path, fips)
    print(
        f"Read {len(surface_df)} surface, {len(bottom_df)} bottom, "
        f"{len(lateral_df)} lateral records."
    )

    cad_lookup: dict[str, dict[str, str]] = {}
    if args.cad_roll:
        cad_path = Path(args.cad_roll)
        if not cad_path.exists():
            raise FileNotFoundError(f"--cad-roll path not found: {cad_path}")
        cad_lookup = load_cad_roll(cad_path)
        print(f"Loaded {len(cad_lookup)} api->lease lookups from {cad_path.name}")

    rows = build_well_rows(surface_df, bottom_df, lateral_df, cad_lookup)
    print(f"Prepared {len(rows)} well rows.")

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
    supabase_key = require_env_or_arg(
        args.supabase_key, "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY"
    )
    client = create_client(supabase_url, supabase_key)

    total_batches = max(1, math.ceil(len(rows) / args.batch_size))
    written = 0
    for batch_index, batch in enumerate(chunked(rows, args.batch_size), start=1):
        client.table(table_name).upsert(batch, on_conflict="api").execute()
        written += len(batch)
        pct = (written / len(rows)) * 100 if rows else 100.0
        print(f"[{batch_index}/{total_batches}] Upserted {written}/{len(rows)} ({pct:.1f}%)", flush=True)

    print(f"Done. Wrote {written} rows into {table_name}.")


if __name__ == "__main__":
    main()
