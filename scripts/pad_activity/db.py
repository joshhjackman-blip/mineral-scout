"""Supabase client helpers for pad-activity scripts."""

from __future__ import annotations

import os
from typing import Any

from supabase import Client, create_client


def normalize_supabase_url(raw: str) -> str:
    url = (raw or "").strip()
    while url.endswith("/"):
        url = url[:-1]
    if url.lower().endswith("/rest/v1"):
        url = url[: -len("/rest/v1")]
        while url.endswith("/"):
            url = url[:-1]
    return url


def require_env(name: str, aliases: tuple[str, ...] = ()) -> str:
    value = os.getenv(name)
    if value:
        return value
    for alt in aliases:
        v = os.getenv(alt)
        if v:
            return v
    raise ValueError(f"Missing env: {name}")


def make_client() -> Client:
    url = normalize_supabase_url(
        require_env("SUPABASE_URL", ("NEXT_PUBLIC_SUPABASE_URL",))
    )
    key = require_env("SUPABASE_KEY", ("SUPABASE_SERVICE_ROLE_KEY",))
    return create_client(url, key)


def paginate_table(
    client: Client,
    table: str,
    columns: str,
    *,
    page_size: int = 1000,
    max_rows: int = 100_000,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while offset < max_rows:
        try:
            result = (
                client.table(table)
                .select(columns)
                .range(offset, offset + page_size - 1)
                .execute()
            )
        except Exception as exc:
            message = str(exc).lower()
            if "not find" in message or "does not exist" in message:
                return rows
            raise
        page = result.data or []
        if not page:
            break
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows
