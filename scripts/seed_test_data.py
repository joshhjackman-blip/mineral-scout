from __future__ import annotations

import argparse
import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from rich.console import Console
from rich.table import Table

from calculate_risk_scores import calculate_risk_score, fetch_supplier_actions, score_to_tier
from utils.supabase_client import supabase

console = Console()

RANDOM_SEED = 42
SHIPMENTS_MIN = 3
SHIPMENTS_MAX = 10

PORTS_OF_ENTRY = [
    "Port of Los Angeles",
    "Port of Long Beach",
    "Port of Newark",
    "Port of Houston",
    "Port of Savannah",
    "Port of Miami",
    "Port of Oakland",
    "Port of Seattle",
    "Port of Baltimore",
]

CONSIGNEES = [
    "Bayview Compounding Pharmacy",
    "SterileRx Labs",
    "Northshore Wellness Compounding",
    "Precision IV Pharmacy",
    "Harbor Clinical Compounds",
]

HS_CODES = ["2937.19", "2941.90", "3003.90", "3004.90", "3822.00"]


@dataclass
class ActionSeed:
    action_type: str
    status: str
    issue_date: str
    title: str
    description: str
    source_url: str
    unique_ref: str


@dataclass
class SupplierSeed:
    name: str
    country: str
    city: str
    fda_registered: bool
    fda_registration_number: str | None
    primary_compounds: list[str]
    notes: str
    actions: list[ActionSeed] = field(default_factory=list)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed Supabase with realistic PharmaTrace test data.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete all non-auth data before seeding.",
    )
    return parser.parse_args()


def chunked(items: list[str], size: int = 250) -> list[list[str]]:
    return [items[idx : idx + size] for idx in range(0, len(items), size)]


def fetch_ids(table_name: str) -> list[str]:
    response = supabase.table(table_name).select("id").execute()
    return [row["id"] for row in (response.data or []) if row.get("id")]


def delete_rows_by_ids(table_name: str, ids: list[str]) -> int:
    deleted = 0
    for group in chunked(ids):
        supabase.table(table_name).delete().in_("id", group).execute()
        deleted += len(group)
    return deleted


def reset_non_auth_data() -> None:
    console.print("[yellow]Reset flag enabled: deleting non-auth data...[/yellow]")
    tables = [
        "watchlist",
        "coa_documents",
        "organization_members",
        "scheduling_alerts",
        "shipments",
        "fda_actions",
        "suppliers",
        "organizations",
    ]

    for table_name in tables:
        ids = fetch_ids(table_name)
        if not ids:
            continue
        deleted = delete_rows_by_ids(table_name, ids)
        console.print(f"  • {table_name}: deleted {deleted} rows")


def seeded_suppliers() -> list[SupplierSeed]:
    return [
        SupplierSeed(
            name="Shenzhen BioAPI Sciences Co. Ltd",
            country="China",
            city="Shenzhen",
            fda_registered=False,
            fda_registration_number=None,
            primary_compounds=["Semaglutide", "Tirzepatide", "BPC-157"],
            notes="High-volume peptide API exporter.",
            actions=[
                ActionSeed(
                    action_type="warning_letter",
                    status="active",
                    issue_date="2024-06-18",
                    title="FDA Warning Letter WL-2024-117",
                    description="Data integrity and sterility assurance observations.",
                    source_url="https://www.fda.gov/mock/warning-letter/wl-2024-117",
                    unique_ref="WL-2024-117",
                ),
                ActionSeed(
                    action_type="recall",
                    status="active",
                    issue_date="2025-01-22",
                    title="Recall RCL-2025-044",
                    description="Potential endotoxin contamination in peptide lots.",
                    source_url="https://api.fda.gov/drug/enforcement.json?search=recall_number:RCL-2025-044",
                    unique_ref="RCL-2025-044",
                ),
            ],
        ),
        SupplierSeed(
            name="Hangzhou PeptideChem Inc",
            country="China",
            city="Hangzhou",
            fda_registered=True,
            fda_registration_number="CN-HP-44791",
            primary_compounds=["Semaglutide", "Retatrutide"],
            notes="Specializes in GMP peptide synthesis.",
            actions=[],
        ),
        SupplierSeed(
            name="Qingdao SynPep Biologics Ltd",
            country="China",
            city="Qingdao",
            fda_registered=False,
            fda_registration_number=None,
            primary_compounds=["BPC-157", "TB-500"],
            notes="Early-stage exporter with mixed compliance history.",
            actions=[
                ActionSeed(
                    action_type="recall",
                    status="closed",
                    issue_date="2023-04-10",
                    title="Recall RCL-2023-209",
                    description="Mislabeling corrected; recall terminated.",
                    source_url="https://api.fda.gov/drug/enforcement.json?search=recall_number:RCL-2023-209",
                    unique_ref="RCL-2023-209",
                )
            ],
        ),
        SupplierSeed(
            name="Suzhou API Nexus Labs Co. Ltd",
            country="China",
            city="Suzhou",
            fda_registered=True,
            fda_registration_number="CN-SZ-88214",
            primary_compounds=["Cagrilintide", "Semaglutide"],
            notes="Medium-scale contract peptide manufacturer.",
            actions=[
                ActionSeed(
                    action_type="warning_letter",
                    status="active",
                    issue_date="2023-09-14",
                    title="FDA Warning Letter WL-2023-451",
                    description="Inadequate batch record controls in API production.",
                    source_url="https://www.fda.gov/mock/warning-letter/wl-2023-451",
                    unique_ref="WL-2023-451",
                )
            ],
        ),
        SupplierSeed(
            name="Wuhan MacroPeptide Ingredients Co. Ltd",
            country="China",
            city="Wuhan",
            fda_registered=False,
            fda_registration_number=None,
            primary_compounds=["Tirzepatide", "Ipamorelin"],
            notes="Emerging supplier focused on custom peptide precursors.",
            actions=[],
        ),
        SupplierSeed(
            name="Mumbai Active Pharma Pvt Ltd",
            country="India",
            city="Mumbai",
            fda_registered=True,
            fda_registration_number="IN-MB-33472",
            primary_compounds=["Semaglutide", "Metformin Base API"],
            notes="Large API producer with export-heavy operations.",
            actions=[
                ActionSeed(
                    action_type="import_alert",
                    status="active",
                    issue_date="2024-11-02",
                    title="Import Alert IA-66-79",
                    description="Import alert due to sterile controls and documentation concerns.",
                    source_url="https://www.accessdata.fda.gov/cms_ia/importalert_66.html#66-79",
                    unique_ref="IA-66-79",
                )
            ],
        ),
        SupplierSeed(
            name="Hyderabad BulkChem Industries",
            country="India",
            city="Hyderabad",
            fda_registered=False,
            fda_registration_number=None,
            primary_compounds=["Tirzepatide precursor", "Liraglutide"],
            notes="Bulk synthesis provider with variable QA maturity.",
            actions=[
                ActionSeed(
                    action_type="warning_letter",
                    status="resolved",
                    issue_date="2022-08-30",
                    title="FDA Warning Letter WL-2022-233",
                    description="Resolved observations regarding cleaning validation.",
                    source_url="https://www.fda.gov/mock/warning-letter/wl-2022-233",
                    unique_ref="WL-2022-233",
                )
            ],
        ),
        SupplierSeed(
            name="Gujarat Peptide Inputs Ltd",
            country="India",
            city="Ahmedabad",
            fda_registered=True,
            fda_registration_number="IN-GJ-66501",
            primary_compounds=["BPC-157", "AOD-9604"],
            notes="Contract API and intermediate manufacturer.",
            actions=[],
        ),
        SupplierSeed(
            name="Carolina Compounding APIs LLC",
            country="United States",
            city="Raleigh",
            fda_registered=True,
            fda_registration_number="US-NC-12011",
            primary_compounds=["Semaglutide", "NAD+", "Glutathione"],
            notes="Domestic supplier with strong compliance controls.",
            actions=[],
        ),
        SupplierSeed(
            name="Midwest Sterile Ingredients Corp",
            country="United States",
            city="Indianapolis",
            fda_registered=True,
            fda_registration_number="US-IN-22994",
            primary_compounds=["Tirzepatide", "L-Carnitine"],
            notes="US sterile ingredient manufacturer with stable quality metrics.",
            actions=[
                ActionSeed(
                    action_type="recall",
                    status="closed",
                    issue_date="2023-02-17",
                    title="Recall RCL-2023-084",
                    description="Packaging deviation corrected and recall closed.",
                    source_url="https://api.fda.gov/drug/enforcement.json?search=recall_number:RCL-2023-084",
                    unique_ref="RCL-2023-084",
                )
            ],
        ),
    ]


def upsert_supplier(seed: SupplierSeed) -> str:
    now_iso = datetime.now(timezone.utc).isoformat()
    payload: dict[str, Any] = {
        "name": seed.name,
        "country": seed.country,
        "city": seed.city,
        "fda_registration_number": seed.fda_registration_number,
        "fda_registered": seed.fda_registered,
        "primary_compounds": seed.primary_compounds,
        "notes": seed.notes,
        "updated_at": now_iso,
    }

    existing = (
        supabase.table("suppliers")
        .select("id")
        .eq("name", seed.name)
        .eq("country", seed.country)
        .limit(1)
        .execute()
    )
    if existing.data:
        supplier_id = existing.data[0]["id"]
        supabase.table("suppliers").update(payload).eq("id", supplier_id).execute()
        return supplier_id

    created = supabase.table("suppliers").insert(payload).execute()
    created_row = (created.data or [None])[0]
    if not created_row or not created_row.get("id"):
        raise RuntimeError(f"Failed to insert supplier {seed.name}")
    return created_row["id"]


def clear_supplier_dependent_data(supplier_id: str) -> None:
    supabase.table("shipments").delete().eq("supplier_id", supplier_id).execute()
    supabase.table("fda_actions").delete().eq("supplier_id", supplier_id).execute()


def random_arrival_date(rng: random.Random) -> date:
    days_back = rng.randint(5, 730)
    return date.today() - timedelta(days=days_back)


def insert_shipments_for_supplier(
    supplier_id: str, seed: SupplierSeed, rng: random.Random
) -> tuple[int, date]:
    shipment_count = rng.randint(SHIPMENTS_MIN, SHIPMENTS_MAX)
    rows: list[dict[str, Any]] = []
    latest_arrival: date | None = None

    for idx in range(shipment_count):
        arrival = random_arrival_date(rng)
        latest_arrival = arrival if latest_arrival is None else max(latest_arrival, arrival)
        compound = rng.choice(seed.primary_compounds)
        row = {
            "supplier_id": supplier_id,
            "shipper_name": seed.name,
            "consignee_name": rng.choice(CONSIGNEES),
            "arrival_date": arrival.isoformat(),
            "port_of_entry": rng.choice(PORTS_OF_ENTRY),
            "country_of_origin": seed.country,
            "description": f"{compound} API shipment",
            "weight_kg": round(rng.uniform(80.0, 2400.0), 2),
            "container_count": rng.randint(1, 12),
            "hs_code": rng.choice(HS_CODES),
            "raw_data": {
                "manifest_id": f"MAN-{supplier_id[:8]}-{idx + 1}",
                "seeded": True,
            },
        }
        rows.append(row)

    supabase.table("shipments").insert(rows).execute()
    if latest_arrival is None:
        raise RuntimeError("Expected at least one shipment per supplier.")
    return shipment_count, latest_arrival


def insert_actions_for_supplier(supplier_id: str, seed: SupplierSeed) -> int:
    if not seed.actions:
        return 0

    rows: list[dict[str, Any]] = []
    for action in seed.actions[:2]:
        rows.append(
            {
                "supplier_id": supplier_id,
                "action_type": action.action_type,
                "title": action.title,
                "issue_date": action.issue_date,
                "status": action.status,
                "description": action.description,
                "source_url": action.source_url,
                "raw_data": {
                    "seed_reference": action.unique_ref,
                    "seeded": True,
                },
            }
        )

    supabase.table("fda_actions").insert(rows).execute()
    return len(rows)


def upsert_dea_alerts() -> int:
    alerts = [
        {
            "compound_name": "Semaglutide",
            "alert_type": "scheduling_proposed",
            "description": "Semaglutide - Proposed analog scheduling review",
            "effective_date": "2026-02-01",
            "source_url": "https://www.deadiversion.usdoj.gov/",
        },
        {
            "compound_name": "BPC-157",
            "alert_type": "analog_concern",
            "description": "BPC-157 - Import alert consideration",
            "effective_date": "2026-01-15",
            "source_url": "https://www.deadiversion.usdoj.gov/",
        },
        {
            "compound_name": "Tirzepatide precursor",
            "alert_type": "scheduling_proposed",
            "description": "Tirzepatide precursor - DEA monitoring notice",
            "effective_date": "2026-03-10",
            "source_url": "https://www.deadiversion.usdoj.gov/",
        },
    ]

    inserted_or_updated = 0
    for alert in alerts:
        existing = (
            supabase.table("scheduling_alerts")
            .select("id")
            .eq("compound_name", alert["compound_name"])
            .eq("description", alert["description"])
            .limit(1)
            .execute()
        )
        if existing.data:
            alert_id = existing.data[0]["id"]
            supabase.table("scheduling_alerts").update(alert).eq("id", alert_id).execute()
            inserted_or_updated += 1
            continue

        supabase.table("scheduling_alerts").insert(alert).execute()
        inserted_or_updated += 1

    return inserted_or_updated


def refresh_active_action_counts(supplier_ids: list[str]) -> None:
    for supplier_id in supplier_ids:
        response = (
            supabase.table("fda_actions")
            .select("id", count="exact")
            .eq("supplier_id", supplier_id)
            .eq("status", "active")
            .execute()
        )
        count = response.count or 0
        supabase.table("suppliers").update({"active_fda_actions": count}).eq("id", supplier_id).execute()


def recalculate_scores_for_suppliers(supplier_ids: list[str]) -> list[dict[str, Any]]:
    today = date.today()
    scored_rows: list[dict[str, Any]] = []

    for supplier_id in supplier_ids:
        supplier_query = (
            supabase.table("suppliers")
            .select("id,name,country,fda_registered,last_shipment_date")
            .eq("id", supplier_id)
            .limit(1)
            .execute()
        )
        if not supplier_query.data:
            continue
        supplier = supplier_query.data[0]
        actions = fetch_supplier_actions(supplier_id)
        score = calculate_risk_score(supplier, actions, today)

        supabase.table("suppliers").update(
            {
                "risk_score": score,
                "risk_score_updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", supplier_id).execute()

        scored_rows.append(
            {
                "id": supplier_id,
                "name": supplier.get("name", supplier_id),
                "country": supplier.get("country"),
                "score": score,
                "tier": score_to_tier(score),
            }
        )

    return scored_rows


def print_seed_table(rows: list[dict[str, Any]]) -> None:
    table = Table(title="Seeded Supplier Risk Scores")
    table.add_column("Supplier", style="bold")
    table.add_column("Country")
    table.add_column("Score", justify="right")
    table.add_column("Tier", justify="center")

    styles = {"green": "green", "yellow": "yellow", "orange": "orange3", "red": "red"}
    for row in sorted(rows, key=lambda item: item["score"], reverse=True):
        tier = row["tier"]
        style = styles[tier]
        table.add_row(
            row["name"],
            row["country"] or "-",
            str(row["score"]),
            f"[{style}]{tier}[/{style}]",
        )
    console.print(table)


def main() -> None:
    args = parse_args()
    rng = random.Random(RANDOM_SEED)

    if args.reset:
        reset_non_auth_data()

    supplier_defs = seeded_suppliers()
    supplier_ids: list[str] = []
    total_shipments = 0
    total_actions = 0

    console.print("[bold]Seeding realistic supplier test data...[/bold]")

    for supplier_def in supplier_defs:
        supplier_id = upsert_supplier(supplier_def)
        supplier_ids.append(supplier_id)

        clear_supplier_dependent_data(supplier_id)

        shipment_count, latest_shipment = insert_shipments_for_supplier(supplier_id, supplier_def, rng)
        total_shipments += shipment_count

        action_count = insert_actions_for_supplier(supplier_id, supplier_def)
        total_actions += action_count

        supabase.table("suppliers").update(
            {
                "last_shipment_date": latest_shipment.isoformat(),
                "total_shipments": shipment_count,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", supplier_id).execute()

    dea_count = upsert_dea_alerts()
    refresh_active_action_counts(supplier_ids)

    scored_rows = recalculate_scores_for_suppliers(supplier_ids)

    print_seed_table(scored_rows)
    console.print("\n[bold green]Seed complete.[/bold green]")
    console.print(f"Suppliers seeded: [cyan]{len(supplier_ids)}[/cyan]")
    console.print(f"Shipments inserted: [cyan]{total_shipments}[/cyan]")
    console.print(f"FDA actions inserted: [cyan]{total_actions}[/cyan]")
    console.print(f"DEA alerts upserted: [cyan]{dea_count}[/cyan]")


if __name__ == "__main__":
    main()

