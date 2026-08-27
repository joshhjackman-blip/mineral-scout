#!/usr/bin/env python3
"""Recover orphaned mineral owners onto tracts by backfilling their
`abstract` (the tract key the app + /api/tract-owners match on).

For every owner row whose `abstract` is NULL, resolve a target tract via:
  M1 — abstract / block+section parsed from raw_record.survey text
       ("T5S BLK 36 SEC 5 A- 441 T&P" -> A-441). Authoritative legal ref.
  M2 — rrc_lease_id -> wells (same lease) -> well geometry -> the tract the
       lease's wells most fall on ("single best tract per lease").

The resolved value written is exactly what /api/tract-owners matches:
  - abstract tracts  "A-441"  -> "441"
  - grid tracts      "B10--S5" -> "B10--S5"

Default is a DRY RUN (compute + validate + report). Pass --apply to PATCH the
rows. Only NULL-abstract rows are touched (we fill blanks, never overwrite),
so it is safe + idempotent (a re-run resolves fewer each time).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

from shapely.geometry import shape
from shapely.strtree import STRtree

COUNTIES = ["howard", "martin", "midland", "loving", "reagan", "upton", "ward"]


def env(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v.strip()
    return ""


BASE = re.sub(r"/rest/v1/?$", "", env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").rstrip("/"))
KEY = env("SUPABASE_SERVICE_ROLE_KEY")
HDRS = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def _open(path: str, *, method: str = "GET", head: bool = False, body: bytes | None = None, extra: dict | None = None):
    req = urllib.request.Request(f"{BASE}/rest/v1/{path}", data=body)
    for k, v in HDRS.items():
        req.add_header(k, v)
    if extra:
        for k, v in extra.items():
            req.add_header(k, v)
    if head:
        req.add_header("Prefer", "count=exact")
        req.get_method = lambda: "HEAD"  # type: ignore[method-assign]
    elif method != "GET":
        req.get_method = lambda: method  # type: ignore[method-assign]
    return urllib.request.urlopen(req)


def count(table: str, filt: str = "") -> int:
    q = "select=id" + (f"&{filt}" if filt else "")
    with _open(f"{table}?{q}&limit=1", head=True) as r:
        cr = r.headers.get("content-range", "")
    m = re.search(r"/(\d+)", cr)
    return int(m.group(1)) if m else -1


def fetch_all(table: str, select: str, filt: str = "") -> list[dict]:
    out: list[dict] = []
    page, off = 1000, 0
    while True:
        q = f"select={select}&limit={page}&offset={off}"
        if filt:
            q += f"&{filt}"
        with _open(f"{table}?{q}") as r:
            batch = json.load(r)
        out.extend(batch)
        if len(batch) < page:
            break
        off += page
    return out


def patch(table: str, ids: list[int], abstract: str) -> None:
    for i in range(0, len(ids), 80):
        chunk = ids[i : i + 80]
        idlist = ",".join(str(x) for x in chunk)
        body = json.dumps({"abstract": abstract}).encode()
        last_err: Exception | None = None
        for attempt in range(5):
            try:
                with _open(
                    f"{table}?id=in.({idlist})",
                    method="PATCH",
                    body=body,
                    extra={"Content-Type": "application/json", "Prefer": "return=minimal"},
                ) as r:
                    status = getattr(r, "status", r.getcode())
                    r.read()
                if status in (200, 204):
                    break
                last_err = RuntimeError(f"status {status}")
            except Exception as exc:  # noqa: BLE001 — retry transient errors
                last_err = exc
            time.sleep(1.0 * (attempt + 1))
        else:
            raise RuntimeError(f"PATCH failed for {table} chunk after retries: {last_err}")


def norm_lease(v) -> str:
    return str(v or "").split(".")[0].lstrip("0").strip()


def tract_key(label: str) -> str:
    m = re.match(r"A-\s*(\d+)", label)
    return m.group(1) if m else label


ABS_RE = re.compile(r"A-?\s*(\d{1,4})")
BLKSEC_RE = re.compile(r"BLK\s*(\w+)\s*SEC\s*(\w+)", re.I)
SECBLK_RE = re.compile(r"SEC\s*(\w+)\s*BLK\s*(\w+)", re.I)


def load_tracts(county: str):
    data = json.loads(Path(f"public/{county}_parcels_enriched.geojson").read_text())
    tract_abs: set[str] = set()
    tract_grid: set[tuple[str, str]] = set()
    geoms, labels = [], []
    for ft in data["features"]:
        lab = str(ft["properties"].get("ABSTRACT_L", ""))
        m = re.match(r"A-\s*(\d+)", lab)
        if m:
            tract_abs.add(m.group(1))
        g = re.match(r"B(\d+)--S(\d+)", lab)
        if g:
            tract_grid.add((g.group(1), g.group(2)))
        try:
            geoms.append(shape(ft["geometry"]))
            labels.append(lab)
        except Exception:
            pass
    return tract_abs, tract_grid, geoms, labels


def lease_best_tract(county: str, geoms, labels) -> dict[str, str]:
    """rrc_lease_id -> single best tract label (max well overlap)."""
    wpath = Path(f"public/{county}_wells.geojson")
    if not wpath.exists() or not geoms:
        return {}
    tree = STRtree(geoms)
    api_tracts: dict[str, list[str]] = defaultdict(list)
    wells = json.loads(wpath.read_text())
    for f in wells.get("features", []):
        g = f.get("geometry")
        api = str((f.get("properties") or {}).get("api") or "").strip()
        if not g or not api:
            continue
        try:
            wg = shape(g)
        except Exception:
            continue
        for i in tree.query(wg):
            try:
                if geoms[i].intersects(wg):
                    api_tracts[api].append(labels[i])
            except Exception:
                pass
    lease_tracts: dict[str, Counter] = defaultdict(Counter)
    for w in fetch_all(f"{county}_wells", "api_number,rrc_lease_id", "rrc_lease_id=not.is.null"):
        api = str(w.get("api_number") or "").strip()
        lease = norm_lease(w.get("rrc_lease_id"))
        if api in api_tracts and lease:
            lease_tracts[lease].update(api_tracts[api])
    return {lease: c.most_common(1)[0][0] for lease, c in lease_tracts.items() if c}


def resolve_survey(sv: str, tract_abs: set[str], tract_grid: set[tuple[str, str]]) -> str | None:
    sv = sv.upper()
    a = ABS_RE.search(sv)
    if a and a.group(1) in tract_abs:
        return a.group(1)
    for rx in (BLKSEC_RE, SECBLK_RE):
        bs = rx.search(sv)
        if bs:
            pair = (bs.group(1), bs.group(2)) if rx is BLKSEC_RE else (bs.group(2), bs.group(1))
            if pair in tract_grid:
                return f"B{pair[0]}--S{pair[1]}"
    return None


def recover_county(county: str, apply: bool) -> None:
    try:
        tract_abs, tract_grid, geoms, labels = load_tracts(county)
    except FileNotFoundError:
        print(f"{county:9s} (no enriched geojson)")
        return
    lease_map = lease_best_tract(county, geoms, labels)

    rows = fetch_all(
        f"{county}_mineral_ownership",
        "id,rrc_lease_id,rawsurvey:raw_record->>survey",
        "abstract=is.null",
    )
    by_key: dict[str, list[int]] = defaultdict(list)
    m1 = m2 = 0
    samples: list[str] = []
    for r in rows:
        key = resolve_survey(str(r.get("rawsurvey") or ""), tract_abs, tract_grid)
        via = "M1"
        if not key:
            lease = norm_lease(r.get("rrc_lease_id"))
            best = lease_map.get(lease)
            if best:
                key = tract_key(best)
                via = "M2"
        if not key:
            continue
        if via == "M1":
            m1 += 1
        else:
            m2 += 1
        by_key[key].append(int(r["id"]))
        if len(samples) < 6:
            samples.append(f"      id={r['id']} lease={r.get('rrc_lease_id')} survey={str(r.get('rawsurvey') or '')[:34]!r} -> abstract={key} ({via})")

    resolved = m1 + m2
    total_null = len(rows)
    print(
        f"{county:9s} null_abstract={total_null:>6,}  resolved={resolved:>6,} "
        f"(M1 survey {m1:,} / M2 lease {m2:,})  distinct target tracts={len(by_key):,}"
    )
    for s in samples:
        print(s)

    if apply and by_key:
        table = f"{county}_mineral_ownership"
        for key, ids in by_key.items():
            patch(table, ids, key)
        print(f"      applied: backfilled abstract on {resolved:,} rows")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the backfill (default: dry run)")
    ap.add_argument("counties", nargs="*", default=[])
    args = ap.parse_args()
    if not BASE or not KEY:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)
    counties = args.counties or COUNTIES
    print(f"Owner->tract recovery {'APPLY' if args.apply else 'DRY RUN'} ({BASE})\n")
    for c in counties:
        try:
            recover_county(c, args.apply)
        except Exception as exc:  # noqa: BLE001
            print(f"{c:9s} error: {exc}")


if __name__ == "__main__":
    main()
