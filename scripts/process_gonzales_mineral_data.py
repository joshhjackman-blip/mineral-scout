#!/usr/bin/env python3
"""Process Gonzales County mineral owner data and load to Supabase.

Usage:
    python scripts/process_gonzales_mineral_data.py \
      --lease-csv /path/to/lease_data.csv \
      --owner-csv /path/to/owner_data.csv

Environment:
    SUPABASE_DB_URL   PostgreSQL connection string for Supabase
                      (or pass --supabase-db-url).
"""

from __future__ import annotations

import argparse
import math
import os
import re
from typing import Iterator

import pandas as pd
import psycopg
from psycopg import sql


ENTITY_PATTERN = re.compile(
    r"\b(LLC|LP|TRUST|ESTATE|CORP|INC|COMPANY)\b",
    flags=re.IGNORECASE,
)


def clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Trim column whitespace while preserving column order."""
    df = df.copy()
    df.columns = [str(col).strip() for col in df.columns]
    return df


def find_column_name(df: pd.DataFrame, target: str) -> str:
    """Find a column name case-insensitively after trimming."""
    normalized_target = target.strip().lower()
    for col in df.columns:
        if str(col).strip().lower() == normalized_target:
            return str(col)
    raise KeyError(
        f"Column '{target}' not found. Available columns: {list(df.columns)}"
    )


def to_numeric(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce")


def build_propensity_columns(joined: pd.DataFrame) -> pd.DataFrame:
    df = joined.copy()

    required = [
        "State",
        "Owner Name",
        "First 6 Month Oil",
        "Prod Cumulative Sum Oil",
        "Acreage",
    ]
    for col in required:
        find_column_name(df, col)

    state_col = find_column_name(df, "State")
    owner_name_col = find_column_name(df, "Owner Name")
    first_6_month_oil_col = find_column_name(df, "First 6 Month Oil")
    prod_cum_oil_col = find_column_name(df, "Prod Cumulative Sum Oil")
    acreage_col = find_column_name(df, "Acreage")

    # Normalize numerics for scoring logic.
    first_6_month_oil = to_numeric(df, first_6_month_oil_col)
    prod_cum_oil = to_numeric(df, prod_cum_oil_col)
    acreage = to_numeric(df, acreage_col)

    normalized_state = (
        df[state_col].fillna("").astype(str).str.strip().str.upper()
    )
    df["out_of_state"] = ~normalized_state.isin(["", "TX", "TEXAS"])

    owner_name = df[owner_name_col].fillna("").astype(str)
    df["is_entity"] = owner_name.str.contains(ENTITY_PATTERN, na=False)

    decline_rate = (
        (first_6_month_oil - (prod_cum_oil / 60.0)) / first_6_month_oil
    )
    decline_rate = decline_rate.where(first_6_month_oil != 0)
    df["decline_rate"] = decline_rate

    acreage_median = acreage.median(skipna=True)
    is_low_acreage = acreage < acreage_median if not math.isnan(acreage_median) else False
    is_producing = prod_cum_oil > 0
    high_decline = df["decline_rate"] > 0.5

    df["propensity_score"] = (
        df["out_of_state"].astype(int) * 3
        + df["is_entity"].astype(int) * 2
        + high_decline.fillna(False).astype(int) * 2
        + pd.Series(is_low_acreage, index=df.index).fillna(False).astype(int) * 2
        + is_producing.fillna(False).astype(int) * 1
    ).astype(int)

    df["motivated"] = df["propensity_score"] >= 7
    return df


def sanitize_column(name: str) -> str:
    """Convert column names to safe snake_case Postgres identifiers."""
    out = re.sub(r"[^A-Za-z0-9]+", "_", name.strip().lower()).strip("_")
    if not out:
        out = "column"
    if out[0].isdigit():
        out = f"col_{out}"
    return out


def make_unique_columns(columns: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    unique: list[str] = []
    for col in columns:
        base = sanitize_column(col)
        count = seen.get(base, 0)
        if count == 0:
            unique.append(base)
        else:
            unique.append(f"{base}_{count}")
        seen[base] = count + 1
    return unique


def infer_pg_type(series: pd.Series, col_name: str) -> str:
    if col_name == "propensity_score":
        return "INTEGER"
    if col_name in {"out_of_state", "is_entity", "motivated"}:
        return "BOOLEAN"
    if col_name == "decline_rate":
        return "DOUBLE PRECISION"
    if pd.api.types.is_integer_dtype(series):
        return "BIGINT"
    if pd.api.types.is_float_dtype(series):
        return "DOUBLE PRECISION"
    if pd.api.types.is_bool_dtype(series):
        return "BOOLEAN"
    return "TEXT"


def normalize_value(value):
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:  # pragma: no cover - defensive
            return value
    return value


def chunked_rows(df: pd.DataFrame, chunk_size: int) -> Iterator[list[tuple]]:
    rows: list[tuple] = []
    for row in df.itertuples(index=False, name=None):
        rows.append(tuple(normalize_value(v) for v in row))
        if len(rows) >= chunk_size:
            yield rows
            rows = []
    if rows:
        yield rows


def load_to_supabase(
    df: pd.DataFrame, db_url: str, table_name: str = "mineral_owners", schema: str = "public"
) -> int:
    db_df = df.copy()
    db_df.columns = make_unique_columns([str(c) for c in db_df.columns])

    # Keep explicit column typing for derived fields.
    for bool_col in ["out_of_state", "is_entity", "motivated"]:
        if bool_col in db_df.columns:
            db_df[bool_col] = db_df[bool_col].astype("boolean")
    if "propensity_score" in db_df.columns:
        db_df["propensity_score"] = pd.to_numeric(
            db_df["propensity_score"], errors="coerce"
        ).astype("Int64")
    if "decline_rate" in db_df.columns:
        db_df["decline_rate"] = pd.to_numeric(db_df["decline_rate"], errors="coerce")

    col_defs = [
        sql.SQL("{} {}").format(
            sql.Identifier(col),
            sql.SQL(infer_pg_type(db_df[col], col)),
        )
        for col in db_df.columns
    ]

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            drop_table_query = sql.SQL("DROP TABLE IF EXISTS {}.{}").format(
                sql.Identifier(schema),
                sql.Identifier(table_name),
            )
            cur.execute(drop_table_query)

            create_table_query = sql.SQL("CREATE TABLE {}.{} ({})").format(
                sql.Identifier(schema),
                sql.Identifier(table_name),
                sql.SQL(", ").join(col_defs),
            )
            cur.execute(create_table_query)

            insert_query = sql.SQL("INSERT INTO {}.{} ({}) VALUES ({})").format(
                sql.Identifier(schema),
                sql.Identifier(table_name),
                sql.SQL(", ").join(sql.Identifier(c) for c in db_df.columns),
                sql.SQL(", ").join(sql.Placeholder() for _ in db_df.columns),
            )

            loaded = 0
            for rows in chunked_rows(db_df, chunk_size=1000):
                cur.executemany(insert_query, rows)
                loaded += len(rows)
        conn.commit()
    return loaded


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Join Gonzales mineral CSVs, score owners, load Supabase, and export motivated owners."
    )
    parser.add_argument("--lease-csv", required=True, help="Path to lease/production CSV")
    parser.add_argument("--owner-csv", required=True, help="Path to owner CSV")
    parser.add_argument(
        "--output-csv",
        default="gonzales_motivated_owners.csv",
        help="Output CSV path for motivated owners",
    )
    parser.add_argument(
        "--supabase-db-url",
        default=os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL"),
        help="Supabase/Postgres DB URL (defaults to SUPABASE_DB_URL or DATABASE_URL)",
    )
    parser.add_argument(
        "--table-name",
        default="mineral_owners",
        help="Destination Supabase table name",
    )
    parser.add_argument("--schema", default="public", help="Destination schema")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    lease_df = clean_columns(pd.read_csv(args.lease_csv, dtype=str))
    owner_df = clean_columns(pd.read_csv(args.owner_csv, dtype=str))

    lease_join_col = find_column_name(lease_df, "CAD Account Number")
    try:
        owner_join_col = find_column_name(owner_df, "CAD Account Number")
    except KeyError as exc:
        raise KeyError(
            "Owner CSV must include 'CAD Account Number' to perform the requested join."
        ) from exc

    joined = owner_df.merge(
        lease_df,
        left_on=owner_join_col,
        right_on=lease_join_col,
        how="inner",
    )

    scored = build_propensity_columns(joined)

    decline_over_50 = (scored["decline_rate"] > 0.5).fillna(False)
    motivated = scored["motivated"].fillna(False)

    print("Summary")
    print("-" * 60)
    print(f"Total records loaded: {len(scored):,}")
    print(f"Out of state: {int(scored['out_of_state'].sum()):,}")
    print(f"Entities: {int(scored['is_entity'].sum()):,}")
    print(f"Decline rate > 50%: {int(decline_over_50.sum()):,}")
    print(f"Motivated (score >= 7): {int(motivated.sum()):,}")

    export_columns = [
        "Owner Name",
        "Address 1",
        "Address 2",
        "City",
        "State",
        "Zip",
        "Operator Name",
        "Field Name",
        "Acreage",
        "Prod Cumulative Sum Oil",
        "decline_rate",
        "propensity_score",
    ]
    missing_export_cols = [c for c in export_columns if c not in scored.columns]
    if missing_export_cols:
        raise KeyError(f"Missing export columns: {missing_export_cols}")

    (
        scored[scored["motivated"]]
        .sort_values(by="propensity_score", ascending=False)
        .loc[:, export_columns]
        .to_csv(args.output_csv, index=False)
    )
    print(f"Exported motivated owners to: {args.output_csv}")

    if not args.supabase_db_url:
        raise ValueError(
            "No Supabase DB URL provided. Set SUPABASE_DB_URL (or DATABASE_URL) "
            "or pass --supabase-db-url."
        )

    loaded_count = load_to_supabase(
        scored,
        db_url=args.supabase_db_url,
        table_name=args.table_name,
        schema=args.schema,
    )
    print(f"Loaded {loaded_count:,} rows into {args.schema}.{args.table_name}")


if __name__ == "__main__":
    main()
