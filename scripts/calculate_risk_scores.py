from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from rich.console import Console
from rich.table import Table

from utils.supabase_client import supabase

console = Console()

WARNING_LETTER_POINTS = 35
IMPORT_ALERT_POINTS = 30
RECALL_POINTS = 25
NO_REGISTRATION_POINTS = 20
STALE_SHIPMENT_POINTS = 10
CHINA_POINTS = 5
INDIA_POINTS = 3

SCORE_CAP = 100
WARNING_WINDOW_DAYS = 365 * 3
SHIPMENT_STALENESS_DAYS = 365


@dataclass
class SupplierScoreResult:
    supplier_id: str
    supplier_name: str
    country: str | None
    score: int
    tier: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recalculate supplier risk scores from FDA actions and supplier metadata."
    )
    parser.add_argument(
        "--supplier-id",
        type=str,
        default=None,
        help="Recalculate score for a single supplier ID.",
    )
    return parser.parse_args()


def _parse_date(value: Any) -> date | None:
    if not value or not isinstance(value, str):
        return None

    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _is_active(action: dict[str, Any]) -> bool:
    status = str(action.get("status") or "").strip().lower()
    return status == "active"


def _has_active_warning_letter_within_3_years(
    actions: list[dict[str, Any]], threshold_date: date
) -> bool:
    for action in actions:
        if str(action.get("action_type") or "").strip().lower() != "warning_letter":
            continue
        if not _is_active(action):
            continue
        issue_date = _parse_date(action.get("issue_date"))
        if issue_date and issue_date >= threshold_date:
            return True
    return False


def _has_active_action(actions: list[dict[str, Any]], action_type: str) -> bool:
    for action in actions:
        if str(action.get("action_type") or "").strip().lower() != action_type:
            continue
        if _is_active(action):
            return True
    return False


def _country_modifier(country: str | None) -> int:
    normalized = (country or "").strip().lower()
    if normalized in {"china", "cn", "people's republic of china", "prc"}:
        return CHINA_POINTS
    if normalized in {"india", "in"}:
        return INDIA_POINTS
    return 0


def score_to_tier(score: int) -> str:
    if score <= 25:
        return "green"
    if score <= 50:
        return "yellow"
    if score <= 75:
        return "orange"
    return "red"


def calculate_risk_score(
    supplier: dict[str, Any],
    actions: list[dict[str, Any]],
    today: date,
) -> int:
    score = 0

    warning_threshold = today - timedelta(days=WARNING_WINDOW_DAYS)
    shipment_threshold = today - timedelta(days=SHIPMENT_STALENESS_DAYS)

    if _has_active_warning_letter_within_3_years(actions, warning_threshold):
        score += WARNING_LETTER_POINTS

    if _has_active_action(actions, "import_alert"):
        score += IMPORT_ALERT_POINTS

    if _has_active_action(actions, "recall"):
        score += RECALL_POINTS

    if not supplier.get("fda_registered"):
        score += NO_REGISTRATION_POINTS

    last_shipment_date = _parse_date(supplier.get("last_shipment_date"))
    if not last_shipment_date or last_shipment_date < shipment_threshold:
        score += STALE_SHIPMENT_POINTS

    score += _country_modifier(supplier.get("country"))

    return min(score, SCORE_CAP)


def fetch_suppliers(supplier_id: str | None) -> list[dict[str, Any]]:
    query = supabase.table("suppliers").select(
        "id,name,country,fda_registered,last_shipment_date"
    )
    if supplier_id:
        query = query.eq("id", supplier_id).limit(1)

    response = query.execute()
    return response.data or []


def fetch_supplier_actions(supplier_id: str) -> list[dict[str, Any]]:
    response = (
        supabase.table("fda_actions")
        .select("action_type,status,issue_date")
        .eq("supplier_id", supplier_id)
        .execute()
    )
    return response.data or []


def update_supplier_score(supplier_id: str, score: int) -> None:
    supabase.table("suppliers").update(
        {
            "risk_score": score,
            "risk_score_updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", supplier_id).execute()


def print_score_table(results: list[SupplierScoreResult]) -> None:
    table = Table(title="Supplier Risk Scores")
    table.add_column("Supplier", style="bold")
    table.add_column("Country")
    table.add_column("Score", justify="right")
    table.add_column("Tier", justify="center")

    tier_styles = {
        "green": "green",
        "yellow": "yellow",
        "orange": "orange3",
        "red": "red",
    }

    for result in sorted(results, key=lambda item: item.score, reverse=True):
        table.add_row(
            result.supplier_name,
            result.country or "-",
            str(result.score),
            f"[{tier_styles[result.tier]}]{result.tier}[/{tier_styles[result.tier]}]",
        )

    console.print(table)


def print_summary(results: list[SupplierScoreResult]) -> None:
    tier_counts = {"green": 0, "yellow": 0, "orange": 0, "red": 0}
    for result in results:
        tier_counts[result.tier] += 1

    console.print("\n[bold green]Risk score recalculation complete.[/bold green]")
    console.print(f"Suppliers scored: [cyan]{len(results)}[/cyan]")
    console.print(
        "Tier distribution: "
        f"[green]green={tier_counts['green']}[/green], "
        f"[yellow]yellow={tier_counts['yellow']}[/yellow], "
        f"[orange3]orange={tier_counts['orange']}[/orange3], "
        f"[red]red={tier_counts['red']}[/red]"
    )


def main() -> None:
    args = parse_args()
    suppliers = fetch_suppliers(args.supplier_id)

    if not suppliers:
        if args.supplier_id:
            console.print(
                f"[yellow]No supplier found for supplier_id={args.supplier_id}.[/yellow]"
            )
        else:
            console.print("[yellow]No suppliers found to score.[/yellow]")
        return

    today = date.today()
    results: list[SupplierScoreResult] = []

    for supplier in suppliers:
        supplier_id = supplier["id"]
        actions = fetch_supplier_actions(supplier_id)
        score = calculate_risk_score(supplier, actions, today)
        update_supplier_score(supplier_id, score)

        tier = score_to_tier(score)
        results.append(
            SupplierScoreResult(
                supplier_id=supplier_id,
                supplier_name=supplier.get("name") or supplier_id,
                country=supplier.get("country"),
                score=score,
                tier=tier,
            )
        )

    print_score_table(results)
    print_summary(results)


if __name__ == "__main__":
    main()

