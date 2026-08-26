#!/usr/bin/env python3
"""Audit owner -> tract attachment coverage per county.

For each county it reports:
  - total owner rows in <county>_mineral_ownership
  - owners attached to a tract (sum of owner_count in the enriched GeoJSON)
  - attachment rate
  - tracts with 0 owners / total tracts
  - null-abstract owner rows
  - a sampled estimate of how many *orphaned* (null-abstract) owners are
    recoverable, i.e. their block+section maps to an existing tract label
    ("B{block}--S{section}") even though their `abstract` column is blank.

Read-only. Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or the NEXT_PUBLIC_*
equivalents) from the environment / .env.local.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

COUNTIES = ["howard", "martin", "midland", "loving", "reagan", "upton", "ward"]


def env(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v.strip()
    return ""


BASE = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").rstrip("/")
# SUPABASE_URL is sometimes exported with a trailing /rest/v1 — strip it so we
# don't double-path to /rest/v1/rest/v1.
BASE = re.sub(r"/rest/v1/?$", "", BASE)
KEY = env("SUPABASE_SERVICE_ROLE_KEY")


def _req(path: str, *, head: bool = False) -> tuple[dict[str, str], bytes]:
    req = urllib.request.Request(f"{BASE}/rest/v1/{path}")
    req.add_header("apikey", KEY)
    req.add_header("Authorization", f"Bearer {KEY}")
    if head:
        req.add_header("Prefer", "count=exact")
        req.get_method = lambda: "HEAD"  # type: ignore[method-assign]
    with urllib.request.urlopen(req) as resp:
        return dict(resp.headers), resp.read()


def count(table: str, filt: str = "") -> int:
    q = "select=id"
    if filt:
        q += f"&{filt}"
    headers, _ = _req(f"{table}?{q}&limit=1", head=True)
    cr = headers.get("content-range") or headers.get("Content-Range") or ""
    # format: 0-0/1234  (or */1234)
    m = re.search(r"/(\d+)", cr)
    return int(m.group(1)) if m else -1


def sample(table: str, cols: str, filt: str, limit: int = 500) -> list[dict]:
    q = f"select={cols}&{filt}&limit={limit}"
    _, body = _req(q if False else f"{table}?{q}")
    return json.loads(body)


def tract_keys(county: str) -> tuple[set[str], int, int]:
    """Return (set of tract ABSTRACT_N keys, total tracts, zero-owner tracts)."""
    path = Path(f"public/{county}_parcels_enriched.geojson")
    if not path.exists():
        return set(), 0, 0
    data = json.loads(path.read_text())
    keys: set[str] = set()
    total = 0
    zero = 0
    attached = 0
    for ft in data.get("features", []):
        p = ft.get("properties", {})
        total += 1
        oc = int(p.get("owner_count") or 0)
        attached += oc
        if oc == 0:
            zero += 1
        for k in (p.get("ABSTRACT_N"), p.get("CODE"), p.get("ABSTRACT_L")):
            if k:
                keys.add(str(k).strip().upper())
                keys.add(str(k).strip().upper().replace("A-", ""))
    return keys, total, zero, attached  # type: ignore[return-value]


def norm(v) -> str:
    return str(v or "").strip().upper()


def audit_county(county: str) -> None:
    table = f"{county}_mineral_ownership"
    try:
        total = count(table)
    except Exception as exc:  # noqa: BLE001
        print(f"{county:9s}  (skipped: {exc})")
        return
    keys, tracts, zero, attached = tract_keys(county)
    null_abs = count(table, "abstract=is.null")

    # Recoverability sample: null-abstract owners whose block+section maps to a
    # grid tract label already in the layer.
    rec = 0
    seen = 0
    has_bs = 0
    try:
        rows = sample(table, "block,section,survey", "abstract=is.null", limit=500)
        for r in rows:
            seen += 1
            blk = norm(r.get("block"))
            sec = norm(r.get("section"))
            if blk and sec and re.fullmatch(r"\d+[A-Z]?", blk) and re.fullmatch(r"\d+[A-Z]?", sec):
                has_bs += 1
                if f"B{blk}--S{sec}" in keys:
                    rec += 1
    except Exception:
        pass

    rate = (attached / total * 100) if total else 0
    rec_pct = (rec / seen * 100) if seen else 0
    print(
        f"{county:9s} owners={total:>7,}  attached={attached:>7,} ({rate:5.1f}%)  "
        f"tracts={tracts:>5,} zero_owner={zero:>5,}  null_abstract={null_abs:>6,}  "
        f"null-abs sample: {has_bs}/{seen} have block+section, {rec} ({rec_pct:.0f}%) map to an existing grid tract"
    )


def main() -> None:
    if not BASE or not KEY:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)
    counties = sys.argv[1:] or COUNTIES
    print(f"Owner->tract coverage audit ({BASE})\n")
    for c in counties:
        audit_county(c)


if __name__ == "__main__":
    main()
