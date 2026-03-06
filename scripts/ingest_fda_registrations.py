from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from rich.console import Console

from utils.supabase_client import supabase

console = Console()

PRIMARY_REGISTRATION_ENDPOINT = "https://api.fda.gov/drug/registration.json"
FALLBACK_REGISTRATION_ENDPOINT = "https://api.fda.gov/device/registrationlisting.json"
PAGE_SIZE = 100
MAX_HTTP_RETRIES = 3

API_BUSINESS_KEYWORDS = (
    "api",
    "active pharmaceutical ingredient",
    "bulk drug substance",
    "drug substance",
    "active ingredient",
)

US_COUNTRY_VALUES = {
    "united states",
    "us",
    "usa",
    "united states of america",
}


@dataclass
class EstablishmentRecord:
    name: str
    country: str | None
    city: str | None
    registration_number: str | None
    business_type: str | None
    trade_name: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest FDA drug establishment registration records into suppliers."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of FDA records to fetch for testing.",
    )
    return parser.parse_args()


def _clean_text(value: Any) -> str | None:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


def _coerce_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        cleaned = _clean_text(value)
        return [cleaned] if cleaned else []
    if isinstance(value, list):
        output: list[str] = []
        for item in value:
            cleaned = _clean_text(item)
            if cleaned:
                output.append(cleaned)
        return output
    return []


def _first_non_empty(*values: Any) -> str | None:
    for value in values:
        cleaned = _clean_text(value)
        if cleaned:
            return cleaned
    return None


def _join_values(values: list[str]) -> str | None:
    if not values:
        return None
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        lowered = value.lower()
        if lowered not in seen:
            seen.add(lowered)
            deduped.append(value)
    return ", ".join(deduped)


def _extract_trade_name(record: dict[str, Any]) -> str | None:
    direct_trade_name = _coerce_list(record.get("proprietary_name"))
    if direct_trade_name:
        return direct_trade_name[0]

    products = record.get("products")
    if isinstance(products, list):
        for product in products:
            if not isinstance(product, dict):
                continue
            openfda = product.get("openfda")
            if isinstance(openfda, dict):
                brand_names = _coerce_list(openfda.get("brand_name"))
                if brand_names:
                    return brand_names[0]
            product_name = _first_non_empty(product.get("name"), product.get("product_name"))
            if product_name:
                return product_name
    return None


def parse_establishment_record(raw_record: dict[str, Any]) -> EstablishmentRecord | None:
    registration = raw_record.get("registration")
    registration_data = registration if isinstance(registration, dict) else {}

    owner_operator = registration_data.get("owner_operator")
    owner_operator_data = owner_operator if isinstance(owner_operator, dict) else {}

    contact_address = owner_operator_data.get("contact_address")
    contact_address_data = contact_address if isinstance(contact_address, dict) else {}

    name = _first_non_empty(
        registration_data.get("name"),
        raw_record.get("establishment_name"),
        raw_record.get("name"),
        owner_operator_data.get("firm_name"),
    )
    if not name:
        return None

    country = _first_non_empty(
        registration_data.get("country"),
        registration_data.get("country_name"),
        registration_data.get("iso_country_code"),
        raw_record.get("country"),
        contact_address_data.get("country"),
        contact_address_data.get("iso_country_code"),
    )

    city = _first_non_empty(
        registration_data.get("city"),
        raw_record.get("city"),
        contact_address_data.get("city"),
    )

    registration_number = _first_non_empty(
        registration_data.get("registration_number"),
        registration_data.get("fei_number"),
        raw_record.get("registration_number"),
        raw_record.get("fei_number"),
    )

    business_type_values = _coerce_list(raw_record.get("establishment_type"))
    business_type_values.extend(_coerce_list(raw_record.get("business_type")))
    business_type = _join_values(business_type_values)

    trade_name = _extract_trade_name(raw_record)

    return EstablishmentRecord(
        name=name,
        country=country,
        city=city,
        registration_number=registration_number,
        business_type=business_type,
        trade_name=trade_name,
    )


def _country_is_us(country: str | None) -> bool:
    if not country:
        return False
    normalized = country.strip().lower()
    return normalized in US_COUNTRY_VALUES


def _is_api_manufacturer(business_type: str | None) -> bool:
    if not business_type:
        return False
    normalized = business_type.lower()
    return any(keyword in normalized for keyword in API_BUSINESS_KEYWORDS)


def should_include_record(record: EstablishmentRecord) -> bool:
    return (not _country_is_us(record.country)) or _is_api_manufacturer(record.business_type)


def _request_with_retry(
    client: httpx.Client, endpoint: str, params: dict[str, int]
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


def resolve_endpoint(client: httpx.Client) -> str:
    for endpoint in (PRIMARY_REGISTRATION_ENDPOINT, FALLBACK_REGISTRATION_ENDPOINT):
        response = _request_with_retry(client, endpoint, {"limit": 1, "skip": 0})
        if response.status_code == 200:
            if endpoint == FALLBACK_REGISTRATION_ENDPOINT:
                console.print(
                    "[yellow]Drug registration endpoint unavailable. "
                    "Using device registrationlisting endpoint fallback.[/yellow]"
                )
            return endpoint
    raise RuntimeError(
        "No usable FDA registration endpoint found. "
        "Checked drug/registration.json and device/registrationlisting.json."
    )


def fetch_records(
    client: httpx.Client, endpoint: str, fetch_limit: int | None
) -> tuple[int, list[dict[str, Any]]]:
    fetched_count = 0
    skip = 0
    all_records: list[dict[str, Any]] = []

    while True:
        remaining = None if fetch_limit is None else fetch_limit - fetched_count
        if remaining is not None and remaining <= 0:
            break

        page_limit = PAGE_SIZE if remaining is None else min(PAGE_SIZE, remaining)
        response = _request_with_retry(client, endpoint, {"limit": page_limit, "skip": skip})

        if response.status_code != 200:
            raise RuntimeError(
                f"FDA API request failed with status {response.status_code}: {response.text}"
            )

        payload = response.json()
        page_records = payload.get("results", [])
        if not isinstance(page_records, list) or not page_records:
            break

        all_records.extend(page_records)
        fetched_count += len(page_records)
        skip += len(page_records)

        if len(page_records) < page_limit:
            break

    return fetched_count, all_records


def _build_supplier_payload(record: EstablishmentRecord) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": record.name,
        "fda_registered": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if record.country:
        payload["country"] = record.country
    if record.city:
        payload["city"] = record.city
    if record.registration_number:
        payload["fda_registration_number"] = record.registration_number
    return payload


def _find_existing_supplier(record: EstablishmentRecord) -> dict[str, Any] | None:
    if record.registration_number:
        by_registration = (
            supabase.table("suppliers")
            .select("id")
            .eq("fda_registration_number", record.registration_number)
            .limit(1)
            .execute()
        )
        if by_registration.data:
            return by_registration.data[0]

    if not record.country:
        return None

    by_name_country = (
        supabase.table("suppliers")
        .select("id")
        .eq("name", record.name)
        .eq("country", record.country)
        .limit(1)
        .execute()
    )
    if by_name_country.data:
        return by_name_country.data[0]
    return None


def upsert_supplier(record: EstablishmentRecord) -> str:
    existing = _find_existing_supplier(record)
    payload = _build_supplier_payload(record)

    if existing:
        supabase.table("suppliers").update(payload).eq("id", existing["id"]).execute()
        return "updated"

    if not record.registration_number and not record.country:
        # Without registration number or country, matching is too weak for idempotent writes.
        return "skipped"

    supabase.table("suppliers").insert(payload).execute()
    return "inserted"


def main() -> None:
    args = parse_args()

    console.print("[bold]Starting FDA registration ingestion...[/bold]")
    if args.limit is not None:
        console.print(f"Fetch limit set to [cyan]{args.limit}[/cyan] records.")

    with httpx.Client(timeout=30.0) as client:
        endpoint = resolve_endpoint(client)
        console.print(f"Using endpoint: [cyan]{endpoint}[/cyan]")
        fetched_count, raw_records = fetch_records(client, endpoint, args.limit)

    inserted_count = 0
    updated_count = 0
    skipped_count = 0

    for raw_record in raw_records:
        if not isinstance(raw_record, dict):
            skipped_count += 1
            continue

        parsed = parse_establishment_record(raw_record)
        if not parsed:
            skipped_count += 1
            continue

        if not should_include_record(parsed):
            skipped_count += 1
            continue

        result = upsert_supplier(parsed)
        if result == "inserted":
            inserted_count += 1
        elif result == "updated":
            updated_count += 1
        else:
            skipped_count += 1

    console.print("\n[bold green]Ingestion complete.[/bold green]")
    console.print(f"Records fetched: [cyan]{fetched_count}[/cyan]")
    console.print(f"New suppliers added: [green]{inserted_count}[/green]")
    console.print(f"Existing suppliers updated: [yellow]{updated_count}[/yellow]")
    console.print(f"Records skipped: [dim]{skipped_count}[/dim]")


if __name__ == "__main__":
    main()

