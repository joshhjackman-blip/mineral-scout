from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
load_dotenv(SCRIPTS_DIR / ".env")
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in scripts/.env.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def test_connection() -> int:
    response = supabase.table("suppliers").select("id", count="exact").limit(1).execute()
    count = response.count or 0
    print(f"Connected to Supabase. suppliers count: {count}")
    return count


if __name__ == "__main__":
    test_connection()
