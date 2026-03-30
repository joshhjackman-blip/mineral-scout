#!/usr/bin/env python3
"""Download all files from a Supabase Storage bucket to local disk."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from supabase import Client, create_client


BUCKET_NAME = "Raw-Data"
PAGE_SIZE = 1000


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def list_bucket_files(client: Client, bucket_name: str) -> list[str]:
    """Recursively list every file path in a bucket."""
    file_paths: list[str] = []
    pending_prefixes = [""]

    while pending_prefixes:
        prefix = pending_prefixes.pop()
        offset = 0
        while True:
            entries: list[dict[str, Any]] = client.storage.from_(bucket_name).list(
                path=prefix,
                options={
                    "limit": PAGE_SIZE,
                    "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                },
            )

            if not entries:
                break

            for entry in entries:
                name = entry.get("name")
                if not name:
                    continue

                full_path = f"{prefix}/{name}" if prefix else name

                # Storage list returns folders without an object id.
                if entry.get("id") is None:
                    pending_prefixes.append(full_path)
                else:
                    file_paths.append(full_path)

            if len(entries) < PAGE_SIZE:
                break
            offset += PAGE_SIZE

    return sorted(file_paths)


def download_files(client: Client, bucket_name: str, file_paths: list[str]) -> list[Path]:
    data_dir = Path("data")
    data_dir.mkdir(parents=True, exist_ok=True)

    local_paths: list[Path] = []
    for file_path in file_paths:
        blob = client.storage.from_(bucket_name).download(file_path)
        if isinstance(blob, str):
            blob_bytes = blob.encode("utf-8")
        else:
            blob_bytes = bytes(blob)

        destination = (data_dir / file_path).resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(blob_bytes)
        local_paths.append(destination)

    return local_paths


def main() -> None:
    supabase_url = require_env("SUPABASE_URL")
    supabase_key = require_env("SUPABASE_KEY")

    client: Client = create_client(supabase_url, supabase_key)

    file_paths = list_bucket_files(client, BUCKET_NAME)
    print(f"Bucket '{BUCKET_NAME}' contains {len(file_paths)} file(s):")
    for path in file_paths:
        print(f"- {path}")

    local_paths = download_files(client, BUCKET_NAME, file_paths)
    print("Downloaded files:")
    for local_path in local_paths:
        print(f"- {local_path}")


if __name__ == "__main__":
    main()
