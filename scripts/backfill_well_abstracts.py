#!/usr/bin/env python3
"""Backfill <county>_wells.abstract from the owner roll via rrc_lease_id.

The RRC wells scraper populates status/operator/lease but not location
(abstract + lat/lon are null), so compute_development_status can't place
producing wells on tracts and everything stays FRONTIER. The owner roll
(<county>_mineral_ownership) carries BOTH rrc_lease_id and the resolved
abstract, so we can map each well's lease to its dominant abstract and write
that onto the well. compute_development_status then assigns the well to that
tract by its declared abstract (no lat/lon needed) -> producing => PDP.

Usage: backfill_well_abstracts.py <county> [<county> ...]
"""
from __future__ import annotations

import os
import sys
from collections import Counter, defaultdict
from urllib.parse import urlparse

import httpx

RAW = os.environ["SUPABASE_URL"]
p = urlparse(RAW)
BASE = f"{p.scheme}://{p.netloc}"
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def norm_lease(v) -> str:
    s = str(v or "").strip()
    if not s:
        return ""
    try:
        return str(int(float(s)))
    except ValueError:
        return s.upper()


def paginate(client: httpx.Client, table: str, select: str, extra: dict | None = None):
    """Keyset pagination by id (indexed) — avoids offset degradation on the
    440k-row Midland roll."""
    # PostgREST caps a response at 1000 rows, so page in 1000s and keep going
    # while a page comes back full.
    out, last_id, size = [], 0, 1000
    sel = select if "id" in [c.strip() for c in select.split(",")] else f"id,{select}"
    while True:
        params = {"select": sel, "order": "id.asc", "limit": str(size),
                  "id": f"gt.{last_id}"}
        if extra:
            params.update(extra)
        r = client.get(f"{BASE}/rest/v1/{table}", params=params, headers=H)
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        out.extend(page)
        last_id = page[-1]["id"]
        if len(page) < size:
            break
    return out


def backfill(county: str) -> None:
    table_own = f"{county}_mineral_ownership"
    table_wells = f"{county}_wells"
    print(f"\n=== {county} ===", flush=True)
    with httpx.Client(timeout=120) as x:
        # lease -> dominant abstract from the owner roll
        own = paginate(x, table_own, "rrc_lease_id,abstract",
                       {"rrc_lease_id": "not.is.null", "abstract": "not.is.null"})
        votes: dict[str, Counter] = defaultdict(Counter)
        for row in own:
            lid = norm_lease(row.get("rrc_lease_id"))
            ab = str(row.get("abstract") or "").strip()
            if lid and ab:
                votes[lid][ab] += 1
        lease_dom = {lid: c.most_common(1)[0][0] for lid, c in votes.items()}
        print(f"  leases with an abstract: {len(lease_dom):,}", flush=True)

        # wells -> group ids by target abstract
        wells = paginate(x, table_wells, "id,rrc_lease_id")
        by_abs: dict[str, list] = defaultdict(list)
        mapped = 0
        for w in wells:
            dom = lease_dom.get(norm_lease(w.get("rrc_lease_id")))
            if dom:
                by_abs[dom].append(w["id"])
                mapped += 1
        print(f"  wells: {len(wells):,}; mappable to an abstract: {mapped:,}", flush=True)

        # PATCH wells.abstract in id batches per target abstract
        patched = 0
        for ab, ids in by_abs.items():
            for i in range(0, len(ids), 500):
                chunk = ids[i:i + 500]
                idlist = ",".join(str(v) for v in chunk)
                r = x.patch(
                    f"{BASE}/rest/v1/{table_wells}",
                    params={"id": f"in.({idlist})"},
                    headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"},
                    json={"abstract": ab},
                )
                if r.status_code >= 300:
                    raise SystemExit(f"PATCH failed {r.status_code}: {r.text[:200]}")
                patched += len(chunk)
        print(f"  wrote abstract on {patched:,} wells", flush=True)


def main() -> None:
    counties = sys.argv[1:]
    if not counties:
        raise SystemExit("usage: backfill_well_abstracts.py <county> [<county> ...]")
    for c in counties:
        backfill(c)
    print("\nBACKFILL_DONE", flush=True)


if __name__ == "__main__":
    main()
