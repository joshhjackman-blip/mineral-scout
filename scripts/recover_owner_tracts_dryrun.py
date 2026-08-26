#!/usr/bin/env python3
"""DRY RUN: estimate how many orphaned (unattached) mineral owners could be
re-homed onto tracts, per county, via two methods:

  M1 — parse the abstract / block+section out of the owner's raw survey text
       (raw_record.survey), e.g. "T5S BLK 36 SEC 5 A- 441 T&P" -> A-441, and
       match it to an existing tract.
  M2 — rrc_lease_id -> wells (same lease) -> well geometry -> the tract the
       lease's wells physically fall on (reuses the wells-geometry matching).

Read-only. Samples null-abstract owners per county and extrapolates. Uses
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_* ) from the env.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from shapely.geometry import shape
from shapely.strtree import STRtree

COUNTIES = ["howard", "martin", "midland", "loving", "reagan", "upton", "ward"]
SAMPLE = 3000


def env(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v.strip()
    return ""


BASE = re.sub(r"/rest/v1/?$", "", env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").rstrip("/"))
KEY = env("SUPABASE_SERVICE_ROLE_KEY")


def _open(path: str, head: bool = False):
    req = urllib.request.Request(f"{BASE}/rest/v1/{path}")
    req.add_header("apikey", KEY)
    req.add_header("Authorization", f"Bearer {KEY}")
    if head:
        req.add_header("Prefer", "count=exact")
        req.get_method = lambda: "HEAD"  # type: ignore[method-assign]
    return urllib.request.urlopen(req)


def count(table: str, filt: str = "") -> int:
    q = "select=id" + (f"&{filt}" if filt else "")
    with _open(f"{table}?{q}&limit=1", head=True) as r:
        cr = r.headers.get("content-range", "")
    m = re.search(r"/(\d+)", cr)
    return int(m.group(1)) if m else -1


def fetch_all(table: str, select: str, filt: str = "", cap: int = 0) -> list[dict]:
    out: list[dict] = []
    page = 1000
    off = 0
    while True:
        q = f"select={select}&{filt}&limit={page}&offset={off}" if filt else f"select={select}&limit={page}&offset={off}"
        with _open(f"{table}?{q}") as r:
            batch = json.load(r)
        out.extend(batch)
        if len(batch) < page:
            break
        off += page
        if cap and off >= cap:
            break
    return out


def norm_lease(v) -> str:
    return str(v or "").split(".")[0].lstrip("0").strip()


ABS_RE = re.compile(r"A-?\s*(\d{1,4})")
BLKSEC_RE = re.compile(r"BLK\s*(\w+)\s*SEC\s*(\w+)", re.I)
SECBLK_RE = re.compile(r"SEC\s*(\w+)\s*BLK\s*(\w+)", re.I)


def load_tracts(county: str):
    path = Path(f"public/{county}_parcels_enriched.geojson")
    data = json.loads(path.read_text())
    tract_abs: set[str] = set()
    tract_grid: set[tuple[str, str]] = set()
    geoms = []
    labels: list[str] = []
    attached: set[tuple[str, str]] = set()
    for ft in data["features"]:
        p = ft["properties"]
        lab = str(p.get("ABSTRACT_L", ""))
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
        oj = p.get("owners_json")
        owners = oj if isinstance(oj, list) else (json.loads(oj) if isinstance(oj, str) and oj else [])
        for o in owners:
            attached.add((str(o.get("owner_name", "")).upper().strip(), norm_lease(o.get("rrc_lease_id"))))
    return tract_abs, tract_grid, geoms, labels, attached


def build_lease_to_tract(county: str, geoms, labels) -> dict[str, set[str]]:
    """api -> tract (geometry), then lease -> tract via wells table."""
    wpath = Path(f"public/{county}_wells.geojson")
    if not wpath.exists() or not geoms:
        return {}
    tree = STRtree(geoms)
    api_to_tract: dict[str, set[str]] = {}
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
                    api_to_tract.setdefault(api, set()).add(labels[i])
            except Exception:
                pass
    # api -> lease from the wells table
    rows = fetch_all(f"{county}_wells", "api_number,rrc_lease_id", "rrc_lease_id=not.is.null")
    lease_to_tract: dict[str, set[str]] = {}
    for w in rows:
        api = str(w.get("api_number") or "").strip()
        lease = norm_lease(w.get("rrc_lease_id"))
        if api in api_to_tract and lease:
            lease_to_tract.setdefault(lease, set()).update(api_to_tract[api])
    return lease_to_tract


def audit(county: str) -> None:
    try:
        tract_abs, tract_grid, geoms, labels, attached = load_tracts(county)
    except FileNotFoundError:
        print(f"{county:9s} (no enriched geojson)")
        return
    null_count = count(f"{county}_mineral_ownership", "abstract=is.null")
    lease_to_tract = build_lease_to_tract(county, geoms, labels)

    sample = fetch_all(
        f"{county}_mineral_ownership",
        "owner_name,rrc_lease_id,rawsurvey:raw_record->>survey",
        "abstract=is.null",
        cap=SAMPLE,
    )
    n = len(sample)
    unatt = m1 = m2 = union = 0
    for r in sample:
        name = str(r.get("owner_name", "")).upper().strip()
        lease = norm_lease(r.get("rrc_lease_id"))
        if (name, lease) in attached:
            continue  # already shown on a tract
        unatt += 1
        sv = str(r.get("rawsurvey") or "").upper()
        hit1 = False
        a = ABS_RE.search(sv)
        if a and a.group(1) in tract_abs:
            hit1 = True
        else:
            for rx in (BLKSEC_RE, SECBLK_RE):
                bs = rx.search(sv)
                if bs:
                    pair = (bs.group(1), bs.group(2)) if rx is BLKSEC_RE else (bs.group(2), bs.group(1))
                    if pair in tract_grid:
                        hit1 = True
                        break
        hit2 = lease in lease_to_tract
        if hit1:
            m1 += 1
        if hit2:
            m2 += 1
        if hit1 or hit2:
            union += 1
    if unatt == 0:
        print(f"{county:9s} null_abstract={null_count:>6,}  (no unattached in sample of {n})")
        return
    orphans_est = int(null_count * unatt / n)
    def pct(x):
        return f"{x*100/unatt:4.0f}%"
    def est(x):
        return f"{int(orphans_est * x / unatt):>6,}"
    print(
        f"{county:9s} null_abs={null_count:>6,}  orphans≈{orphans_est:>6,}  "
        f"M1(survey)={pct(m1)}→{est(m1)}  M2(lease→wells)={pct(m2)}→{est(m2)}  "
        f"either={pct(union)}→{est(union)}   [sample {n}, unattached {unatt}]"
    )


def main() -> None:
    if not BASE or not KEY:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)
    counties = sys.argv[1:] or COUNTIES
    print(f"Orphan-owner recovery DRY RUN ({BASE})\n")
    for c in counties:
        try:
            audit(c)
        except Exception as exc:  # noqa: BLE001
            print(f"{c:9s} error: {exc}")


if __name__ == "__main__":
    main()
