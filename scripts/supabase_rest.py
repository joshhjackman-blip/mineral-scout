"""PostgREST helpers that avoid supabase-py's PGRST125 path bug.

supabase-py 2.14 concatenates ``{url}/rest/v1`` without stripping a trailing
slash or an already-present ``/rest/v1``. Secrets stored as
``https://xxx.supabase.co/`` become ``https://xxx.supabase.co//rest/v1/``,
which PostgREST rejects with PGRST125. These helpers talk to
``{scheme}://{netloc}/rest/v1/{table}`` only.
"""

from __future__ import annotations

import math
import time
from datetime import date, datetime
from typing import Any, Iterable
from urllib.parse import urlparse

import httpx


def rest_base(url: str) -> str:
    raw = (url or "").strip()
    while raw.endswith("/"):
        raw = raw[:-1]
    if raw.lower().endswith("/rest/v1"):
        raw = raw[: -len("/rest/v1")]
        while raw.endswith("/"):
            raw = raw[:-1]
    parsed = urlparse(raw)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"Invalid SUPABASE_URL: {url!r}")
    return f"{parsed.scheme}://{parsed.netloc}"


def rest_headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): jsonable(val) for key, val in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(val) for val in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if hasattr(value, "item") and not isinstance(value, (bytes, str)):
        try:
            return jsonable(value.item())
        except Exception:
            return str(value)
    return value


def _request(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    retries: int = 5,
    **kwargs: Any,
) -> httpx.Response:
    last: httpx.Response | Exception | None = None
    for attempt in range(retries):
        try:
            response = client.request(method, url, **kwargs)
        except httpx.TransportError as exc:
            last = exc
            time.sleep(2 ** attempt)
            continue
        if response.status_code in {429, 500, 502, 503, 504} and attempt + 1 < retries:
            last = response
            time.sleep(2 ** attempt)
            continue
        return response
    if isinstance(last, httpx.Response):
        return last
    raise last  # type: ignore[misc]


def table_max_id(client: httpx.Client, base: str, table: str, headers: dict[str, str]) -> int:
    response = _request(
        client,
        "GET",
        f"{base}/rest/v1/{table}",
        params={"select": "id", "order": "id.desc", "limit": "1"},
        headers={**headers, "Prefer": "return=representation"},
    )
    if response.status_code >= 300:
        raise RuntimeError(f"max-id {table} failed ({response.status_code}): {response.text[:400]}")
    rows = response.json()
    if not isinstance(rows, list) or not rows:
        return 0
    return int(rows[0]["id"])


def table_count(client: httpx.Client, base: str, table: str, headers: dict[str, str]) -> int:
    response = _request(
        client,
        "GET",
        f"{base}/rest/v1/{table}",
        params={"select": "id", "limit": "1"},
        headers={**headers, "Prefer": "count=exact"},
    )
    if response.status_code >= 300:
        raise RuntimeError(f"count {table} failed ({response.status_code}): {response.text[:400]}")
    crange = response.headers.get("content-range") or ""
    if "/" in crange:
        total = crange.rsplit("/", 1)[-1]
        if total.isdigit():
            return int(total)
    rows = response.json()
    return len(rows) if isinstance(rows, list) else 0


def truncate_table(
    client: httpx.Client,
    base: str,
    table: str,
    headers: dict[str, str],
    *,
    batch: int = 1000,
) -> int:
    max_id = table_max_id(client, base, table, headers)
    if max_id <= 0:
        return 0
    cursor = 0
    while cursor <= max_id:
        response = _request(
            client,
            "DELETE",
            f"{base}/rest/v1/{table}",
            params=[("id", f"gte.{cursor}"), ("id", f"lt.{cursor + batch}")],
            headers=headers,
        )
        if response.status_code >= 300:
            raise RuntimeError(
                f"truncate {table} failed at id {cursor} "
                f"({response.status_code}): {response.text[:400]}"
            )
        cursor += batch
    return max_id


def insert_rows(
    client: httpx.Client,
    base: str,
    table: str,
    headers: dict[str, str],
    rows: Iterable[dict[str, Any]],
    *,
    batch_size: int = 500,
) -> int:
    payloads = [jsonable(row) for row in rows]
    total = len(payloads)
    if total == 0:
        return 0
    written = 0
    batches = max(1, math.ceil(total / batch_size))
    for index in range(batches):
        start = index * batch_size
        batch = payloads[start : start + batch_size]
        response = _request(
            client,
            "POST",
            f"{base}/rest/v1/{table}",
            headers=headers,
            json=batch,
        )
        if response.status_code >= 300:
            raise RuntimeError(
                f"insert {table} failed at batch {index + 1}/{batches} "
                f"({response.status_code}): {response.text[:400]}"
            )
        written += len(batch)
        if index == 0 or (index + 1) % 25 == 0 or index + 1 == batches:
            pct = (written / total) * 100
            print(
                f"  [{index + 1}/{batches}] inserted {written:,}/{total:,} ({pct:.1f}%)",
                flush=True,
            )
    return written
