#!/usr/bin/env python3
"""Refresh ``<county>_permits`` spud dates + coordinates from the RRC
**Drilling Permit Master (plus latitudes/longitudes)** daily file.

Why this exists
---------------
The map's "Active rigs" overlay draws a dot for a permit that has lat/lon and a
recent ``spud_date`` with no ``completion_date``. Spud dates previously came from
a single static ``OG_WELLBORE_EWA_Report_<date>.csv`` snapshot (2026-03-03),
which went stale — Loving, for example, showed zero oil/gas rigs because its only
recently-spudded rows in that snapshot were saltwater-disposal wells.

The RRC publishes a *daily* Drilling Permit Master file (fixed-width, "Master and
Trailer - Daily File (Includes Latitudes and Longitudes)") through its public
Managed File Transfer portal. It carries the spud-in date per permit. This script
downloads that file, parses it, joins each permit to a surface lat/lon (from the
file's GIS records when present, else the county well shapefile in Supabase
Storage), and upserts ``spud_date`` + ``latitude`` / ``longitude`` into
``<county>_permits`` keyed on ``api_number``. Run daily, it keeps rig data
current for every county.

Record layout (calibrated against the OGA049M user's guide + live bytes; the
physical records are 510 bytes, the documented segment offsets sit 2 bytes ahead
of the physical bytes because of the record-type prefix):

  Record 01 (DA ROOT)   status# [2:9]  county [11:14]  lease [14:46]
                        operator [66:98]  status-flag [100]  permit# [112:119]
  Record 02 (DA PERMIT) status# [2:9]  issued [129:137]  spud [153:161]
                        well-status [169]  api (8-digit) [502:510]
  Record 14 (GIS surf.) "14: <lon>  <lat>"  (belongs to the preceding 01)

Usage:
  python3 scripts/scrape_rrc_drilling_permits.py --county loving,midland --dry-run
  python3 scripts/scrape_rrc_drilling_permits.py            # all counties, live
  python3 scripts/scrape_rrc_drilling_permits.py --file data/_rrc_fresh/daf420.dat
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parent.parent

# RRC public MFT "GoDrive" share for the daily drilling-permit master + lat/lon.
MFT_LINK = "https://mft.rrc.texas.gov/link/5f07cc72-2e79-4df8-ade1-9aeb792e03fc"
MFT_HOST = "https://mft.rrc.texas.gov"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

BUCKET_NAME = "Raw-Data"

COUNTY_FIPS = {
    "howard": "227", "martin": "317", "midland": "329", "loving": "301",
    "reagan": "383", "upton": "461", "ward": "475",
}
FIPS_TO_COUNTY = {v: k for k, v in COUNTY_FIPS.items()}

# RRC well shapefile SYMNUM codes we accept as a real surface location.
_TX_LAT = (25.0, 37.0)
_TX_LON = (-107.0, -93.0)


# --- shell/curl helper (the MFT host TLS-resets automated clients; retry) -----

def _curl(args: list[str], tries: int = 8) -> subprocess.CompletedProcess:
    last = None
    for i in range(tries):
        last = subprocess.run(
            ["curl", "-sS", "-m", "90", "-A", UA] + args, capture_output=True
        )
        if last.returncode == 0:
            return last
        time.sleep(3 + 2 * i)
    return last  # type: ignore[return-value]


def download_permit_file(dest: Path) -> Path:
    """Download today's daily drilling-permit master via the GoDrive JSF flow."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    work = dest.parent
    jar = work / "_gd_jar.txt"
    folder = work / "_gd_folder.html"
    r = _curl(["-c", str(jar), "-L", "-o", str(folder), "-w", "%{url_effective}", MFT_LINK])
    final = r.stdout.decode().strip() if r and r.returncode == 0 else MFT_LINK
    html = folder.read_text(encoding="utf-8", errors="ignore")
    vs_m = re.search(r'name="javax\.faces\.ViewState"[^>]*value="([^"]*)"', html)
    vs = vs_m.group(1) if vs_m else ""
    name_m = re.search(r"([A-Za-z0-9_\-]+\.dat)", html)
    file_m = re.search(re.escape(name_m.group(1)) if name_m else r"daf\d+\.dat", html)
    seg = html[max(0, (file_m.start() if file_m else 0) - 1800): (file_m.start() if file_m else 0) + 100]
    ids = re.findall(r'id="(fileTable:\d+:j_id_[0-9a-z]+)"', seg)
    cmd = ids[-1] if ids else "fileTable:0:j_id_2f"
    data: list[str] = []
    for k, v in [("fileList_SUBMIT", "1"), ("javax.faces.ViewState", vs),
                 ("fileList", "fileList"), (cmd, cmd)]:
        data += ["--data-urlencode", f"{k}={v}"]
    _curl(["-b", str(jar), "-c", str(jar), "-X", "POST", "-o", os.devnull] + data + [final])
    r2 = _curl(["-b", str(jar), "-c", str(jar), "-L", "-o", str(dest),
                "-w", "%{http_code}", f"{MFT_HOST}/link/godrivedownload"])
    code = r2.stdout.decode().strip() if r2 and r2.returncode == 0 else "ERR"
    if not dest.exists() or dest.stat().st_size < 10_000:
        raise RuntimeError(f"drilling-permit download failed (http={code})")
    print(f"  downloaded {dest} ({dest.stat().st_size:,} bytes)", flush=True)
    for tmp in (jar, folder):
        tmp.unlink(missing_ok=True)
    return dest


# --- fixed-width parse --------------------------------------------------------

def _date8(s: str) -> str | None:
    s = s.strip()
    if not (s.isdigit() and len(s) == 8):
        return None
    y, m, d = s[:4], s[4:6], s[6:8]
    if y < "1900" or y > "2100" or not ("01" <= m <= "12") or not ("01" <= d <= "31"):
        return None
    return f"{y}-{m}-{d}"


def parse_permit_file(path: Path) -> list[dict[str, Any]]:
    """Return one dict per permit that has a spud date, with coords when the GIS
    record is present in the file."""
    roots: dict[str, dict[str, Any]] = {}
    coords: dict[str, tuple[float, float]] = {}
    current: str | None = None
    with path.open(encoding="latin-1") as fh:
        for raw in fh:
            line = raw.rstrip("\r\n")
            rt = line[:2]
            if rt == "01":
                st = line[2:9]
                current = st
                roots[st] = {
                    "status_number": st,
                    "county_code": line[11:14],
                    "lease_name": line[14:46].strip() or None,
                    "operator_name": line[66:98].strip() or None,
                    "status_flag": line[100:101],
                    "permit_number": line[112:119].strip() or None,
                }
            elif rt == "02":
                st = line[2:9]
                r = roots.get(st)
                if r is not None:
                    r["approved_date"] = _date8(line[129:137])
                    r["spud_date"] = _date8(line[153:161])
                    well_status = line[169:170]
                    # 'W' = final completion → the well is done drilling, so
                    # stamp a completion_date and it drops out of the active-rig
                    # filter (spud recent + no completion). Its date lives right
                    # after the status flag.
                    r["completion_date"] = (
                        _date8(line[170:178]) if well_status == "W" else None
                    )
                    r["api_number"] = line[502:510].strip() or None
            elif rt == "14" and current:
                nums = re.findall(r"(-?\d{2,3}\.\d{3,})", line)
                if len(nums) >= 2:
                    coords[current] = (float(nums[1]), float(nums[0]))  # (lat, lon)
    out: list[dict[str, Any]] = []
    for st, r in roots.items():
        if not r.get("spud_date"):
            continue
        if st in coords:
            r["latitude"], r["longitude"] = coords[st]
        out.append(r)
    return out


# --- county well-shapefile lat/lon lookup ------------------------------------

def wells_latlon(fips: str, client: httpx.Client, base: str, headers: dict[str, str],
                 data_dir: Path) -> dict[str, tuple[float, float]]:
    """{8-digit API: (lat, lon)} from the county well surface shapefile."""
    import shapefile  # pyshp

    zp = data_dir / f"well{fips}.zip"
    if not zp.exists():
        print(f"  downloading {BUCKET_NAME}/well{fips}.zip ...", flush=True)
        r = client.get(f"{base}/storage/v1/object/{BUCKET_NAME}/well{fips}.zip",
                        headers=headers, timeout=120)
        r.raise_for_status()
        data_dir.mkdir(parents=True, exist_ok=True)
        zp.write_bytes(r.content)
    out: dict[str, tuple[float, float]] = {}
    with tempfile.TemporaryDirectory() as tmp:
        zipfile.ZipFile(zp).extractall(tmp)
        surface = next((p for p in Path(tmp).rglob("*.shp")
                        if p.stem.lower().endswith("s")), None)
        if surface is None:
            return out
        reader = shapefile.Reader(str(surface.with_suffix("")))
        fields = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
        ia = fields.index("API") if "API" in fields else None
        ilat = fields.index("LAT83") if "LAT83" in fields else None
        ilon = fields.index("LONG83") if "LONG83" in fields else None
        if ia is None or ilat is None or ilon is None:
            return out
        for rec in reader.iterRecords():
            api = re.sub(r"\D", "", str(rec[ia] or ""))
            if len(api) != 8:
                continue
            try:
                lat = float(rec[ilat]); lon = float(rec[ilon])
            except (TypeError, ValueError):
                continue
            if _TX_LAT[0] <= lat <= _TX_LAT[1] and _TX_LON[0] <= lon <= _TX_LON[1]:
                out.setdefault(api, (lat, lon))
    return out


# --- Supabase upsert ----------------------------------------------------------

def upsert_permit(client: httpx.Client, base: str, headers: dict[str, str],
                  table: str, row: dict[str, Any]) -> str:
    """Update existing api_number rows with fresh spud/coords; insert if absent.

    Returns 'updated' | 'inserted' | 'skip'."""
    api = row["api_number"]
    patch = {k: row[k] for k in ("spud_date", "latitude", "longitude",
                                 "operator_name", "lease_name", "approved_date",
                                 "permit_number", "completion_date")
             if row.get(k) is not None}
    r = client.patch(
        f"{base}/rest/v1/{table}",
        params={"api_number": f"eq.{api}"},
        headers={**headers, "Prefer": "return=representation"},
        json=patch, timeout=60,
    )
    if r.status_code < 300 and isinstance(r.json(), list) and len(r.json()) > 0:
        return "updated"
    insert = {
        "api_number": api, "county_code": row["county_code"],
        "permit_type": "Permit — drilling", "status": "APPROVED",
        **patch,
    }
    ri = client.post(f"{base}/rest/v1/{table}",
                     headers={**headers, "Prefer": "return=minimal"},
                     json=insert, timeout=60)
    return "inserted" if ri.status_code < 300 else f"skip({ri.status_code})"


def is_disposal(lease: str | None) -> bool:
    u = (lease or "").upper()
    return bool(re.search(r"(^|\s)SWD(\s|$)", u)) or "DISPOSAL" in u or "INJECTION" in u


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--county", default=",".join(COUNTY_FIPS),
                    help="comma-separated county ids (default: all configured)")
    ap.add_argument("--file", help="local drilling-permit .dat (skip download)")
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    counties = [c.strip() for c in args.county.split(",") if c.strip() in COUNTY_FIPS]
    wanted_fips = {COUNTY_FIPS[c] for c in counties}

    data_dir = Path(args.data_dir)
    if args.file:
        permit_path = Path(args.file)
    else:
        permit_path = download_permit_file(data_dir / "_rrc_fresh" / "drilling_permits.dat")

    print(f"Parsing {permit_path} ...", flush=True)
    permits = [p for p in parse_permit_file(permit_path)
               if p["county_code"] in wanted_fips]
    print(f"  spudded permits in target counties: {len(permits)}", flush=True)

    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    from urllib.parse import urlparse
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json"}

    with httpx.Client() as client:
        latlon_by_fips: dict[str, dict[str, tuple[float, float]]] = {}
        for fips in wanted_fips:
            latlon_by_fips[fips] = wells_latlon(fips, client, base, headers, data_dir)
            print(f"  well-shapefile coords for FIPS {fips}: "
                  f"{len(latlon_by_fips[fips])}", flush=True)

        counts: dict[str, int] = {}
        for row in permits:
            fips = row["county_code"]
            county = FIPS_TO_COUNTY[fips]
            table = f"{county}_permits"
            if row.get("latitude") is None:
                hit = latlon_by_fips[fips].get(row["api_number"])
                if hit:
                    row["latitude"], row["longitude"] = hit
            if row.get("latitude") is None:
                counts["no-coords"] = counts.get("no-coords", 0) + 1
                continue
            tag = "RIG" if not is_disposal(row["lease_name"]) else "swd"
            if args.dry_run:
                print(f"  [{county}] {tag} api={row['api_number']} spud={row['spud_date']} "
                      f"@({row['latitude']:.4f},{row['longitude']:.4f}) "
                      f"{(row['operator_name'] or '')[:22]} | {(row['lease_name'] or '')[:24]}",
                      flush=True)
                counts["dry"] = counts.get("dry", 0) + 1
            else:
                res = upsert_permit(client, base, headers, table, row)
                counts[res] = counts.get(res, 0) + 1

    print(f"Done: {counts}", flush=True)


if __name__ == "__main__":
    main()
