#!/usr/bin/env python3
"""Enrich Howard parcel polygons with motivated-owner aggregates.

This script:
1) Fetches ALL motivated owners from Supabase via pagination.
2) Prints join-key diagnostics for owner and parcel fields.
3) Maps owners directly to parcel abstracts (owner.abstract -> parcel CODE).
4) Enriches each polygon with aggregate owner metadata.
5) Writes data/howard_parcels_enriched.geojson and copies to public/.
"""

from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

import geopandas as gpd
from supabase import Client, create_client

PAGE_SIZE = 1000
INPUT_PARCELS = Path("/workspace/data/howard/Abstracts.shp")
OUTPUT_PARCELS = Path("data/howard_parcels_enriched.geojson")
PUBLIC_PARCELS = Path("public/howard_parcels_enriched.geojson")


def require_env(name: str, aliases: tuple[str, ...] = ()) -> str:
    value = os.getenv(name)
    if value:
        return value
    for alias in aliases:
        alias_value = os.getenv(alias)
        if alias_value:
            return alias_value
    alias_text = f" (or one of: {', '.join(aliases)})" if aliases else ""
    raise ValueError(f"Missing required environment variable: {name}{alias_text}")


def resolve_input_parcels_path() -> Path:
    if INPUT_PARCELS.exists():
        return INPUT_PARCELS
    raise FileNotFoundError(f"Missing input shapefile: {INPUT_PARCELS}")


def norm_text(value: Any) -> str:
    return " ".join(str(value or "").strip().upper().split())


def to_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def to_abstract_code(value: Any) -> str:
    # Keep matching rule as requested: str(value).strip()
    return str(value if value is not None else "").strip()


def paginate_motivated_owners(client: Client) -> list[dict[str, Any]]:
    all_owners: list[dict[str, Any]] = []
    last_id: str | None = None
    server_side_motivated_filter = True
    page_num = 0
    page_size = PAGE_SIZE

    while True:
        # Use keyset pagination to avoid deep OFFSET scan timeouts.
        # Howard schema can differ from Gonzales; pull full rows to avoid hard-failing
        # on optional/missing columns while keeping downstream logic unchanged.
        query = client.table("howard_mineral_ownership").select("*")
        if server_side_motivated_filter:
            query = query.eq("motivated", True)
        query = query.order("id", desc=False).limit(page_size)
        if last_id:
            query = query.gt("id", last_id)
        try:
            result = query.execute()
            page_rows = result.data or []
        except Exception as exc:
            if server_side_motivated_filter and "statement timeout" in str(exc).lower():
                print(
                    "Server-side motivated filter timed out; "
                    "falling back to client-side motivated filtering."
                )
                all_owners = []
                last_id = None
                page_num = 0
                server_side_motivated_filter = False
                page_size = PAGE_SIZE
                continue
            if "statement timeout" in str(exc).lower():
                if page_size > 200:
                    page_size = max(200, page_size // 2)
                    print(
                        f"Page query timed out; retrying with smaller page_size={page_size}."
                    )
                else:
                    print("Page query timed out; retrying with current page size.")
                continue
            raise

        if not page_rows:
            break

        page_num += 1
        if server_side_motivated_filter:
            batch = page_rows
        else:
            batch = [row for row in page_rows if bool(row.get("motivated"))]

        all_owners.extend(batch)
        last_id = str(page_rows[-1]["id"])
        print(
            f"Fetched page {page_num}: {len(batch)} motivated owners in page, "
            f"total so far: {len(all_owners)}"
        )
        if len(page_rows) < page_size:
            break

    print(f"Total motivated owners fetched: {len(all_owners)}")

    # Fetch raw_record separately in manageable chunks and merge by id when available.
    owners_by_id: dict[str, dict[str, Any]] = {
        str(owner["id"]): owner for owner in all_owners
    }
    owner_ids = list(owners_by_id.keys())
    chunk_size = 500
    for start in range(0, len(owner_ids), chunk_size):
        chunk_ids = owner_ids[start : start + chunk_size]
        try:
            result = (
                client.table("howard_mineral_ownership")
                .select("id, raw_record")
                .in_("id", chunk_ids)
                .execute()
            )
        except Exception:
            # If raw_record does not exist in Howard, continue without it.
            break
        for row in result.data or []:
            owner = owners_by_id.get(str(row.get("id")))
            if owner is not None:
                owner["raw_record"] = row.get("raw_record")

    return all_owners


def main() -> None:
    supabase_url = require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
    supabase_key = require_env(
        "SUPABASE_KEY",
        ("SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    )
    client = create_client(supabase_url, supabase_key)

    # 1) Fetch all motivated owners with pagination
    all_owners = paginate_motivated_owners(client)

    # 2) Load parcels and normalize Howard-specific abstract fields
    input_parcels_path = resolve_input_parcels_path()
    print(f"Using input parcels from: {input_parcels_path}")
    parcels_gdf = gpd.read_file(input_parcels_path)
    if parcels_gdf.crs is None:
        parcels_gdf = parcels_gdf.set_crs("EPSG:4326")
    else:
        parcels_gdf = parcels_gdf.to_crs("EPSG:4326")

    parcels_gdf["ABSTRACT_N"] = parcels_gdf["CODE"].apply(to_abstract_code)
    parcels_gdf["ABSTRACT_L"] = parcels_gdf["ABSTRACT_N"].apply(
        lambda code: f"A-{code}" if code else ""
    )

    print("First 5 owners join-field preview:")
    for index, owner in enumerate(all_owners[:5], start=1):
        print(
            index,
            {
                "abstract": owner.get("abstract"),
                "county_lease_name": owner.get("county_lease_name"),
                "field_name": owner.get("field_name"),
            },
        )

    print("First 5 parcel join-field preview:")
    for index, row in parcels_gdf.head(5).iterrows():
        _ = index
        print(
            {
                "CODE": row.get("CODE"),
                "DESC_": row.get("DESC_"),
                "Block": row.get("Block"),
                "Surv_Name": row.get("Surv_Name"),
                "ABSTRACT_L": row.get("ABSTRACT_L"),
                "ABSTRACT_N": row.get("ABSTRACT_N"),
            }
        )

    # 3) User-requested grouping preview by abstract / county_lease_name / field_name
    owners_by_abstract = defaultdict(list)
    for owner in all_owners:
        key = (
            to_abstract_code(owner.get("abstract"))
            or owner.get("county_lease_name", "")
            or owner.get("field_name", "")
            or ""
        )
        owners_by_abstract[key].append(owner)
    print(f"Unique abstract/group keys with owners: {len(owners_by_abstract)}")
    print("Sample keys:", list(owners_by_abstract.keys())[:10])

    # PRIMARY MATCH (Howard): owner.abstract -> parcel CODE
    code_to_abstract_label: dict[str, str] = {}
    for _, row in parcels_gdf.iterrows():
        code = to_abstract_code(row.get("CODE"))
        if not code:
            continue
        code_to_abstract_label[code] = f"A-{code}"

    owner_id_to_abstract: dict[str, str] = {}
    for owner in all_owners:
        owner_id = str(owner.get("id", ""))
        owner_code = to_abstract_code(owner.get("abstract"))
        if owner_id and owner_code in code_to_abstract_label:
            owner_id_to_abstract[owner_id] = code_to_abstract_label[owner_code]

    fallback_name_hits = 0
    print(
        f"After direct abstract matching: {len(owner_id_to_abstract)} owners mapped to abstracts"
    )

    # Final dictionary: abstract identifier -> list[owners]
    owners_by_abstract_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for owner in all_owners:
        abstract_id = owner_id_to_abstract.get(str(owner["id"]))
        if abstract_id:
            owners_by_abstract_id[norm_text(abstract_id)].append(owner)

    # 4) Enrich polygons
    matched_polygons = 0
    represented_owner_ids: set[str] = set()
    polygon_rankings: list[dict[str, Any]] = []

    for idx in parcels_gdf.index:
        abstract_l = norm_text(parcels_gdf.at[idx, "ABSTRACT_L"])
        owners = owners_by_abstract_id.get(abstract_l, [])
        if owners:
            matched_polygons += 1
            represented_owner_ids.update(str(owner.get("id")) for owner in owners)
            highest = max(owners, key=lambda item: to_int(item.get("propensity_score")))
            operator_counter = Counter(
                (owner.get("operator_name") or "").strip()
                for owner in owners
                if (owner.get("operator_name") or "").strip()
            )
            top_operator = (
                operator_counter.most_common(1)[0][0] if operator_counter else ""
            )

            parcels_gdf.at[idx, "max_propensity_score"] = to_int(
                highest.get("propensity_score")
            )
            # Field name: most common non-null field across owners in tract.
            field_names = [
                owner.get("field_name")
                for owner in owners
                if (owner.get("field_name") or "")
            ]
            top_field = (
                Counter(str(name).strip() for name in field_names).most_common(1)[0][0]
                if field_names
                else "Unknown"
            )
            parcels_gdf.at[idx, "field_name"] = top_field

            # First date: earliest lease start date among tract owners.
            first_dates = [
                str(owner.get("first_date", ""))[:10]
                for owner in owners
                if owner.get("first_date")
            ]
            earliest_date = min(first_dates) if first_dates else ""
            parcels_gdf.at[idx, "first_date"] = earliest_date

            parcels_gdf.at[idx, "owner_count"] = len(owners)
            parcels_gdf.at[idx, "top_owner"] = highest.get("owner_name") or ""
            parcels_gdf.at[idx, "top_owner_state"] = highest.get("mailing_state") or ""
            parcels_gdf.at[idx, "top_operator"] = top_operator

            # Tract-level production aggregates for charting.
            oil_6 = [float(owner.get("first_6_month_oil", 0) or 0) for owner in owners]
            oil_12 = [float(owner.get("first_12_month_oil", 0) or 0) for owner in owners]
            oil_24 = [float(owner.get("first_24_month_oil", 0) or 0) for owner in owners]
            oil_60 = [float(owner.get("first_60_month_oil", 0) or 0) for owner in owners]
            oil_cum = [
                float(owner.get("prod_cumulative_sum_oil", 0) or 0) for owner in owners
            ]

            parcels_gdf.at[idx, "first_6_month_oil"] = sum(oil_6)
            parcels_gdf.at[idx, "first_12_month_oil"] = sum(oil_12)
            parcels_gdf.at[idx, "first_24_month_oil"] = sum(oil_24)
            parcels_gdf.at[idx, "first_60_month_oil"] = sum(oil_60)
            parcels_gdf.at[idx, "prod_cumulative_sum_oil"] = sum(oil_cum)

            avg_early = sum(oil_6) / max(len(oil_6), 1)
            avg_late = sum(oil_60) / max(len(oil_60), 1)
            decline_pct = (
                round((avg_early - avg_late) / max(avg_early, 1) * 100, 1)
                if avg_early > 0
                else 0
            )
            parcels_gdf.at[idx, "decline_pct"] = decline_pct
            parcels_gdf.at[idx, "production_trend"] = (
                "declining"
                if decline_pct > 30
                else "stable"
                if decline_pct > -10
                else "growing"
            )

            # Lease status logic:
            # - Active production: HBP (held by production), no fixed expiration.
            # - No production: estimate from first date + 5-year primary term.
            has_production = any(
                (owner.get("prod_cumulative_sum_oil") or 0) > 0 for owner in owners
            )
            production_trend = str(
                parcels_gdf.at[idx, "production_trend"] or "unknown"
            )

            if has_production:
                if production_trend == "declining":
                    est_expiration = "HBP - declining"
                else:
                    est_expiration = "HBP - active"
            elif earliest_date:
                try:
                    d = datetime.strptime(earliest_date, "%Y-%m-%d")
                    exp_year = d.year + 5
                    exp_date = date(exp_year, d.month, 1)
                    today = date.today()
                    if exp_date < today:
                        est_expiration = f"Expired {d.strftime('%b %Y')} - open acreage"
                    else:
                        months_left = (
                            (exp_date.year - today.year) * 12
                            + (exp_date.month - today.month)
                        )
                        est_expiration = (
                            f"Exp {exp_date.strftime('%b %Y')} ({months_left}mo)"
                        )
                except Exception:
                    est_expiration = "Unknown"
            else:
                est_expiration = "Unknown"

            parcels_gdf.at[idx, "est_lease_expiration"] = est_expiration
            owners_for_panel: list[dict[str, Any]] = []
            for owner in sorted(
                owners, key=lambda item: to_int(item.get("propensity_score")), reverse=True
            ):
                raw_record = owner.get("raw_record")
                interest_value = None
                if isinstance(raw_record, dict):
                    interest_value = raw_record.get("Interest")
                try:
                    ownership_pct = (
                        round(float(interest_value) * 100.0, 4)
                        if interest_value is not None
                        else None
                    )
                except (TypeError, ValueError):
                    ownership_pct = None

                def as_bool(value: Any) -> bool:
                    if isinstance(value, bool):
                        return value
                    if isinstance(value, (int, float)):
                        return value != 0
                    if isinstance(value, str):
                        return value.strip().lower() in {"1", "true", "yes", "y"}
                    return False

                owners_for_panel.append(
                    {
                        "owner_name": owner.get("owner_name", "") or "",
                        "propensity_score": to_int(owner.get("propensity_score", 0)),
                        "mailing_city": owner.get("mailing_city", "") or "",
                        "mailing_state": owner.get("mailing_state", "") or "",
                        "mailing_zip": owner.get("mailing_zip", "") or "",
                        "address_1": owner.get("address_1", "")
                        or owner.get("address", "")
                        or owner.get("mailing_address", "")
                        or "",
                        "out_of_state": as_bool(owner.get("out_of_state", False)),
                        "motivated": as_bool(owner.get("motivated", False)),
                        "operator_name": owner.get("operator_name", "") or "",
                        "rrc_lease_id": str(owner.get("rrc_lease_id", "") or ""),
                        "acreage": owner.get("acreage", 0),
                        "ownership_pct": (
                            ownership_pct
                            if ownership_pct is not None
                            else owner.get("ownership_pct", 0)
                        ),
                    }
                )

            parcels_gdf.at[idx, "owners_json"] = json.dumps(owners_for_panel)

            polygon_rankings.append(
                {
                    "abstract": parcels_gdf.at[idx, "ABSTRACT_L"],
                    "owner_count": len(owners),
                    "max_propensity_score": int(parcels_gdf.at[idx, "max_propensity_score"]),
                    "top_owner": parcels_gdf.at[idx, "top_owner"],
                }
            )
        else:
            parcels_gdf.at[idx, "max_propensity_score"] = 0
            parcels_gdf.at[idx, "field_name"] = "Unknown"
            parcels_gdf.at[idx, "first_date"] = ""
            parcels_gdf.at[idx, "est_lease_expiration"] = "Unknown"
            parcels_gdf.at[idx, "owner_count"] = 0
            parcels_gdf.at[idx, "top_owner"] = ""
            parcels_gdf.at[idx, "top_owner_state"] = ""
            parcels_gdf.at[idx, "top_operator"] = ""
            parcels_gdf.at[idx, "owners_json"] = "[]"
            parcels_gdf.at[idx, "first_6_month_oil"] = 0
            parcels_gdf.at[idx, "first_12_month_oil"] = 0
            parcels_gdf.at[idx, "first_24_month_oil"] = 0
            parcels_gdf.at[idx, "first_60_month_oil"] = 0
            parcels_gdf.at[idx, "prod_cumulative_sum_oil"] = 0
            parcels_gdf.at[idx, "decline_pct"] = 0
            parcels_gdf.at[idx, "production_trend"] = "stable"

    # 5) Save and copy
    OUTPUT_PARCELS.parent.mkdir(parents=True, exist_ok=True)
    parcels_gdf.to_file(OUTPUT_PARCELS, driver="GeoJSON")

    PUBLIC_PARCELS.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_PARCELS.write_text(OUTPUT_PARCELS.read_text(encoding="utf-8"), encoding="utf-8")

    # 6) Summary metrics
    print(f"Total polygons enriched: {len(parcels_gdf)}")
    print(f"How many matched at least one owner: {matched_polygons}")
    print(f"Total owners represented: {len(represented_owner_ids)}")
    print(
        f"Owners not represented (no abstract mapping found): "
        f"{len(all_owners) - len(represented_owner_ids)}"
    )
    print(f"Fallback owner mappings via county_lease_name: {fallback_name_hits}")

    polygon_rankings.sort(key=lambda item: item["owner_count"], reverse=True)
    print("Top 5 polygons by owner count:")
    for item in polygon_rankings[:5]:
        print(item)


if __name__ == "__main__":
    main()
