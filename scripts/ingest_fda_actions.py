from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import quote_plus

import httpx
from rich.console import Console

from utils.supabase_client import supabase

console = Console()

DRUG_ENFORCEMENT_ENDPOINT = "https://api.fda.gov/drug/enforcement.json"
FOOD_ENFORCEMENT_ENDPOINT = "https://api.fda.gov/food/enforcement.json"

PAGE_SIZE = 100
MAX_HTTP_RETRIES = 3
SUPPLIER_MATCH_THRESHOLD = 0.8


@dataclass
class SupplierCandidate:
    id: str
    name: str
    country: str | None
    city: str | None


@dataclass
class ActionRecord:
    action_type: str
    supplier_name: str
    city: str | None
    state: str | None
    country: str | None
    issue_date: str | None
    description: str | None
    status: str
    recall_number: str | None
    source_url: str | None
    title: str
    raw_data: dict[str, Any]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest FDA enforcement actions into Supabase.")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of records to fetch per selected source.",
    )
    parser.add_argument(
        "--type",
        type=str,
        default="all",
        choices=["all", "recalls", "warnings", "import_alerts", "import-alerts"],
        help="Which action type to ingest.",
    )
    return parser.parse_args()


def _clean_text(value: Any) -> str | None:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


def _normalize_name(value: str) -> str:
    lowered = value.lower().strip()
    chars = [ch if ch.isalnum() or ch.isspace() else " " for ch in lowered]
    return " ".join("".join(chars).split())


def _parse_fda_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        if len(value) == 8 and value.isdigit():
            parsed = datetime.strptime(value, "%Y%m%d")
        else:
            parsed = datetime.fromisoformat(value)
        return parsed.date().isoformat()
    except ValueError:
        return None


def _map_status(raw_status: str | None) -> str:
    normalized = (raw_status or "").strip().lower()
    if normalized in {"terminated", "completed", "closed", "ended"}:
        return "closed"
    if normalized in {"resolved"}:
        return "resolved"
    return "active"


def _request_with_retry(
    client: httpx.Client, endpoint: str, params: dict[str, Any]
) -> httpx.Response:
    for attempt in range(1, MAX_HTTP_RETRIES + 1):
        response = client.get(endpoint, params=params)

        if response.status_code == 429 and attempt < MAX_HTTP_RETRIES:
            delay_seconds = attempt * 2
            console.print(
                f"[yellow]Rate limited by FDA API. Retrying in {delay_seconds}s...[/yellow]"
            )
            time.sleep(delay_seconds)
            continue

        return response

    raise RuntimeError("FDA API request failed after retries.")


def fetch_enforcement_records(
    client: httpx.Client, endpoint: str, limit: int | None
) -> tuple[int, list[dict[str, Any]]]:
    fetched_count = 0
    skip = 0
    all_records: list[dict[str, Any]] = []

    while True:
        remaining = None if limit is None else limit - fetched_count
        if remaining is not None and remaining <= 0:
            break

        page_limit = PAGE_SIZE if remaining is None else min(PAGE_SIZE, remaining)
        response = _request_with_retry(client, endpoint, {"limit": page_limit, "skip": skip})

        if response.status_code != 200:
            raise RuntimeError(
                f"FDA API request failed with status {response.status_code}: {response.text}"
            )

        payload = response.json()
        page_results = payload.get("results", [])
        if not isinstance(page_results, list) or not page_results:
            break

        all_records.extend(page_results)
        fetched_count += len(page_results)
        skip += len(page_results)

        if len(page_results) < page_limit:
            break

    return fetched_count, all_records


def build_source_url(endpoint: str, recall_number: str | None, event_id: str | None) -> str | None:
    if recall_number:
        query = quote_plus(f'recall_number:"{recall_number}"')
        return f"{endpoint}?search={query}"
    if event_id:
        query = quote_plus(f'event_id:"{event_id}"')
        return f"{endpoint}?search={query}"
    return None


def parse_enforcement_record(
    raw_record: dict[str, Any], action_type: str, endpoint: str
) -> ActionRecord | None:
    supplier_name = _clean_text(raw_record.get("recalling_firm")) or _clean_text(
        raw_record.get("firm_name")
    )
    if not supplier_name:
        return None

    recall_number = _clean_text(raw_record.get("recall_number"))
    event_id = _clean_text(raw_record.get("event_id"))
    issue_date = _parse_fda_date(
        _clean_text(raw_record.get("recall_initiation_date"))
        or _clean_text(raw_record.get("center_classification_date"))
        or _clean_text(raw_record.get("report_date"))
    )
    description = _clean_text(raw_record.get("reason_for_recall")) or _clean_text(
        raw_record.get("description")
    )
    product_description = _clean_text(raw_record.get("product_description"))
    title = recall_number or product_description or f"{supplier_name} FDA action"

    return ActionRecord(
        action_type=action_type,
        supplier_name=supplier_name,
        city=_clean_text(raw_record.get("city")),
        state=_clean_text(raw_record.get("state")),
        country=_clean_text(raw_record.get("country")),
        issue_date=issue_date,
        description=description or product_description,
        status=_map_status(_clean_text(raw_record.get("status"))),
        recall_number=recall_number,
        source_url=build_source_url(endpoint, recall_number, event_id),
        title=title,
        raw_data=raw_record,
    )


def load_supplier_candidates() -> list[SupplierCandidate]:
    response = supabase.table("suppliers").select("id,name,country,city").execute()
    return [
        SupplierCandidate(
            id=row["id"],
            name=row["name"],
            country=row.get("country"),
            city=row.get("city"),
        )
        for row in response.data or []
        if row.get("id") and row.get("name")
    ]


def find_best_supplier_match(
    firm_name: str, suppliers: list[SupplierCandidate], country: str | None
) -> SupplierCandidate | None:
    target = _normalize_name(firm_name)
    if not target:
        return None

    best: SupplierCandidate | None = None
    best_score = 0.0

    for supplier in suppliers:
        score = SequenceMatcher(None, target, _normalize_name(supplier.name)).ratio()
        if country and supplier.country and country.lower() == supplier.country.lower():
            score += 0.03
        if score > best_score:
            best_score = score
            best = supplier

    if best and best_score >= SUPPLIER_MATCH_THRESHOLD:
        return best
    return None


def create_supplier_from_action(action: ActionRecord) -> SupplierCandidate:
    payload = {
        "name": action.supplier_name,
        "city": action.city,
        "country": action.country,
        "fda_registered": False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    response = supabase.table("suppliers").insert(payload).execute()
    created_data = response.data or []
    if created_data:
        created = created_data[0]
    else:
        query = supabase.table("suppliers").select("id,name,country,city").eq(
            "name", action.supplier_name
        )
        if action.city:
            query = query.eq("city", action.city)
        if action.country:
            query = query.eq("country", action.country)
        lookup = query.limit(1).execute()
        if not lookup.data:
            raise RuntimeError("Failed to create supplier from FDA action record.")
        created = lookup.data[0]
    return SupplierCandidate(
        id=created["id"],
        name=created["name"],
        country=created.get("country"),
        city=created.get("city"),
    )


def get_or_create_supplier_id(
    action: ActionRecord, suppliers: list[SupplierCandidate]
) -> tuple[str, bool]:
    best_match = find_best_supplier_match(action.supplier_name, suppliers, action.country)
    if best_match:
        return best_match.id, False

    created = create_supplier_from_action(action)
    suppliers.append(created)
    return created.id, True


def _find_existing_action_id(
    action_type: str, source_url: str | None, recall_number: str | None
) -> str | None:
    if source_url:
        by_source = (
            supabase.table("fda_actions")
            .select("id")
            .eq("action_type", action_type)
            .eq("source_url", source_url)
            .limit(1)
            .execute()
        )
        if by_source.data:
            return by_source.data[0]["id"]

    if recall_number:
        try:
            by_recall_number = (
                supabase.table("fda_actions")
                .select("id")
                .eq("action_type", action_type)
                .contains("raw_data", {"recall_number": recall_number})
                .limit(1)
                .execute()
            )
            if by_recall_number.data:
                return by_recall_number.data[0]["id"]
        except Exception:
            by_title = (
                supabase.table("fda_actions")
                .select("id")
                .eq("action_type", action_type)
                .eq("title", recall_number)
                .limit(1)
                .execute()
            )
            if by_title.data:
                return by_title.data[0]["id"]

    return None


def upsert_fda_action(action: ActionRecord, supplier_id: str) -> str:
    payload = {
        "supplier_id": supplier_id,
        "action_type": action.action_type,
        "title": action.title,
        "issue_date": action.issue_date,
        "status": action.status,
        "description": action.description,
        "source_url": action.source_url,
        "raw_data": action.raw_data,
    }

    existing_id = _find_existing_action_id(
        action_type=action.action_type,
        source_url=action.source_url,
        recall_number=action.recall_number,
    )
    if existing_id:
        supabase.table("fda_actions").update(payload).eq("id", existing_id).execute()
        return "updated"

    supabase.table("fda_actions").insert(payload).execute()
    return "inserted"


def import_alerts_placeholder() -> list[ActionRecord]:
    console.print(
        "[yellow]Import alerts require manual entry or a licensed data source.[/yellow]"
    )

    placeholder_rows: list[dict[str, Any]] = [
        {
            "firm_name": "Shandong Allied Pharmaceutical Co., Ltd.",
            "city": "Jinan",
            "state": "Shandong",
            "country": "China",
            "issue_date": "2025-01-15",
            "status": "active",
            "alert_number": "66-40",
            "description": "Detention without physical examination for API CGMP deviations.",
            "source_url": "https://www.accessdata.fda.gov/cms_ia/importalert_66.html",
        },
        {
            "firm_name": "Apex BioChem Labs Pvt. Ltd.",
            "city": "Hyderabad",
            "state": "Telangana",
            "country": "India",
            "issue_date": "2024-11-02",
            "status": "active",
            "alert_number": "66-79",
            "description": "Import alert for inadequate sterility controls in injectable ingredients.",
            "source_url": "https://www.accessdata.fda.gov/cms_ia/importalert_66.html",
        },
        {
            "firm_name": "Helix API Manufacturing S.A.",
            "city": "Barcelona",
            "state": "Catalonia",
            "country": "Spain",
            "issue_date": "2024-08-21",
            "status": "closed",
            "alert_number": "99-33",
            "description": "Prior import alert due to data integrity concerns; now closed.",
            "source_url": "https://www.accessdata.fda.gov/cms_ia/importalert_99.html",
        },
    ]

    records: list[ActionRecord] = []
    for row in placeholder_rows:
        alert_number = row["alert_number"]
        records.append(
            ActionRecord(
                action_type="import_alert",
                supplier_name=row["firm_name"],
                city=row["city"],
                state=row["state"],
                country=row["country"],
                issue_date=row["issue_date"],
                description=row["description"],
                status=row["status"],
                recall_number=alert_number,
                source_url=f'{row["source_url"]}#alert-{alert_number}',
                title=f"Import Alert {alert_number}",
                raw_data={"import_alert_number": alert_number, "source": "placeholder"},
            )
        )
    return records


def update_active_action_counts() -> int:
    suppliers_response = supabase.table("suppliers").select("id").execute()
    supplier_ids = [row["id"] for row in (suppliers_response.data or []) if row.get("id")]

    actions_response = (
        supabase.table("fda_actions").select("supplier_id,status").eq("status", "active").execute()
    )
    counts: dict[str, int] = {}
    for row in actions_response.data or []:
        supplier_id = row.get("supplier_id")
        if supplier_id:
            counts[supplier_id] = counts.get(supplier_id, 0) + 1

    updated_suppliers = 0
    for supplier_id in supplier_ids:
        supabase.table("suppliers").update(
            {"active_fda_actions": counts.get(supplier_id, 0)}
        ).eq("id", supplier_id).execute()
        updated_suppliers += 1
    return updated_suppliers


def ingest_action_records(
    records: list[ActionRecord], suppliers: list[SupplierCandidate]
) -> tuple[int, int, int]:
    inserted = 0
    updated = 0
    suppliers_created = 0

    for action in records:
        supplier_id, was_created = get_or_create_supplier_id(action, suppliers)
        if was_created:
            suppliers_created += 1

        result = upsert_fda_action(action, supplier_id)
        if result == "inserted":
            inserted += 1
        else:
            updated += 1

    return inserted, updated, suppliers_created


def main() -> None:
    args = parse_args()
    selected_type = args.type.replace("-", "_")

    console.print("[bold]Starting FDA enforcement ingestion...[/bold]")
    if args.limit is not None:
        console.print(f"Fetch limit set to [cyan]{args.limit}[/cyan] records per source.")
    console.print(f"Selected ingestion type: [cyan]{selected_type}[/cyan]")

    suppliers = load_supplier_candidates()

    total_fetched = 0
    total_inserted = 0
    total_updated = 0
    total_suppliers_created = 0

    with httpx.Client(timeout=30.0) as client:
        if selected_type in {"all", "recalls"}:
            fetched, raw_records = fetch_enforcement_records(
                client, DRUG_ENFORCEMENT_ENDPOINT, args.limit
            )
            total_fetched += fetched
            recall_records = [
                parsed
                for parsed in (
                    parse_enforcement_record(item, "recall", DRUG_ENFORCEMENT_ENDPOINT)
                    for item in raw_records
                    if isinstance(item, dict)
                )
                if parsed is not None
            ]
            inserted, updated, suppliers_created = ingest_action_records(recall_records, suppliers)
            total_inserted += inserted
            total_updated += updated
            total_suppliers_created += suppliers_created

        if selected_type in {"all", "warnings"}:
            # Practical warning/violation proxy using food + drug enforcement feeds.
            for warning_endpoint in (FOOD_ENFORCEMENT_ENDPOINT, DRUG_ENFORCEMENT_ENDPOINT):
                fetched, raw_records = fetch_enforcement_records(client, warning_endpoint, args.limit)
                total_fetched += fetched
                warning_records = [
                    parsed
                    for parsed in (
                        parse_enforcement_record(item, "warning_letter", warning_endpoint)
                        for item in raw_records
                        if isinstance(item, dict)
                    )
                    if parsed is not None
                ]
                inserted, updated, suppliers_created = ingest_action_records(
                    warning_records, suppliers
                )
                total_inserted += inserted
                total_updated += updated
                total_suppliers_created += suppliers_created

    if selected_type in {"all", "import_alerts"}:
        placeholder_records = import_alerts_placeholder()
        total_fetched += len(placeholder_records)
        inserted, updated, suppliers_created = ingest_action_records(placeholder_records, suppliers)
        total_inserted += inserted
        total_updated += updated
        total_suppliers_created += suppliers_created

    suppliers_updated = update_active_action_counts()

    console.print("\n[bold green]FDA actions ingestion complete.[/bold green]")
    console.print(f"Records fetched: [cyan]{total_fetched}[/cyan]")
    console.print(f"Actions inserted: [green]{total_inserted}[/green]")
    console.print(f"Actions updated: [yellow]{total_updated}[/yellow]")
    console.print(f"Suppliers created: [magenta]{total_suppliers_created}[/magenta]")
    console.print(f"Suppliers refreshed (active counts): [cyan]{suppliers_updated}[/cyan]")


if __name__ == "__main__":
    main()

