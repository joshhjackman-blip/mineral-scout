#!/usr/bin/env python3
"""Load + enrich Howard 2026, Glasscock, Reeves, and Pecos.

Expected inputs (gitignored), from the Raw-Data bucket or dropped in data/:

  data/owners_2026_Howard.csv
  data/owners_2026_Glasscock.csv
  data/owners_2026_Reeves.csv
  data/owners_2026_Pecos.csv

Well layers and StratMap parcels are public and fetched automatically when
missing:

  RRC well{FIPS}.zip via mft.rrc.texas.gov (Well Layers by County)
  TNRIS StratMap land parcels (data.geographic.texas.gov)

Howard already has data/howard/Abstracts.shp, so the 2026 roll is a switch:
truncate howard_mineral_ownership, reload owners_2026_Howard.csv, re-enrich.

Usage:
  python3 scripts/onboard_2026_counties.py --dry-run
  python3 scripts/onboard_2026_counties.py --county howard
  python3 scripts/onboard_2026_counties.py
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parent.parent

COUNTIES = {
    "howard": {
        "fips": "227",
        "state_fips": "48227",
        "roll": "owners_2026_Howard.csv",
        "load_wells_table": False,  # already live; do not truncate
    },
    "glasscock": {
        "fips": "173",
        "state_fips": "48173",
        "roll": "owners_2026_Glasscock.csv",
        "load_wells_table": True,
    },
    "reeves": {
        "fips": "389",
        "state_fips": "48389",
        "roll": "owners_2026_Reeves.csv",
        "load_wells_table": True,
    },
    "pecos": {
        "fips": "371",
        "state_fips": "48371",
        "roll": "owners_2026_Pecos.csv",
        "load_wells_table": True,
    },
}

TNRIS_LP = (
    "https://data.geographic.texas.gov/"
    "0fa04328-872e-481c-b453-126a74777593/resources/"
    "stratmap25-landparcels_{state_fips}_lp.zip"
)
RRC_WELLS_MFT = "https://mft.rrc.texas.gov/link/d551fb20-442e-4b67-84fa-ac3f23ecabb4"
MFT_HOST = "https://mft.rrc.texas.gov"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def run(cmd: list[str], dry: bool) -> None:
    print("+", " ".join(cmd), flush=True)
    if dry:
        return
    subprocess.check_call(cmd, cwd=ROOT)


def curl(args: list[str], tries: int = 8) -> subprocess.CompletedProcess:
    last = None
    for i in range(tries):
        last = subprocess.run(
            ["curl", "-sS", "-m", "300", "-A", UA] + args,
            capture_output=True,
        )
        if last.returncode == 0:
            return last
        import time
        time.sleep(3 + 2 * i)
    return last  # type: ignore[return-value]


def roll_path(county: str, cfg: dict[str, str]) -> Path:
    primary = ROOT / "data" / cfg["roll"]
    if primary.exists():
        return primary
    fallback = cfg.get("roll_fallback")
    if fallback:
        alt = ROOT / "data" / fallback
        if alt.exists() and county != "howard":
            return alt
        # Howard fallback is the 2025 roll — only use it when the 2026 file
        # is absent AND the caller explicitly wants a rebuild of current data.
        if fallback and county == "howard":
            return primary
        if fallback:
            return alt
    return primary


def _storage_creds() -> tuple[str, str] | None:
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key_env = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key_env or "example.supabase.co" in url:
        return None
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}", key_env


def download_storage_object(key: str, dest: Path) -> bool:
    creds = _storage_creds()
    if not creds:
        return False
    base, key_env = creds
    dest.parent.mkdir(parents=True, exist_ok=True)
    encoded = quote(key, safe="/")
    print(f"  storage GET Raw-Data/{key} -> {dest}", flush=True)
    r = curl([
        "-H", f"apikey: {key_env}",
        "-H", f"Authorization: Bearer {key_env}",
        "-o", str(dest),
        "-w", "%{http_code}",
        f"{base}/storage/v1/object/Raw-Data/{encoded}",
    ])
    code = r.stdout.decode().strip() if r and r.returncode == 0 else "ERR"
    if dest.exists() and dest.stat().st_size > 100 and code.startswith("2"):
        print(f"  downloaded {dest} ({dest.stat().st_size:,} bytes)", flush=True)
        return True
    dest.unlink(missing_ok=True)
    print(f"  storage miss Raw-Data/{key} (http={code})", flush=True)
    return False


_RAW_DATA_LIST: list[str] | None = None


def list_raw_data() -> list[str]:
    """List every object key in Raw-Data. Needs the service role."""
    global _RAW_DATA_LIST
    if _RAW_DATA_LIST is not None:
        return _RAW_DATA_LIST
    creds = _storage_creds()
    if not creds:
        return []
    base, key_env = creds
    try:
        from supabase import create_client
        client = create_client(base, key_env)
    except Exception as exc:
        print(f"  storage list skipped: {exc}", flush=True)
        return []
    paths: list[str] = []
    pending = [""]
    while pending:
        prefix = pending.pop()
        offset = 0
        while True:
            entries = client.storage.from_("Raw-Data").list(
                path=prefix,
                options={"limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
            )
            if not entries:
                break
            for entry in entries:
                name = entry.get("name")
                if not name:
                    continue
                full = f"{prefix}/{name}" if prefix else name
                if entry.get("id") is None:
                    pending.append(full)
                else:
                    paths.append(full)
            if len(entries) < 1000:
                break
            offset += 1000
    print(f"  Raw-Data has {len(paths)} objects", flush=True)
    for p in paths:
        print(f"    {p}", flush=True)
    _RAW_DATA_LIST = paths
    return paths


def _extract_roll(archive: Path, dest: Path) -> bool:
    if not zipfile.is_zipfile(archive):
        if archive != dest:
            dest.write_bytes(archive.read_bytes())
        return dest.exists() and dest.stat().st_size > 100
    with zipfile.ZipFile(archive) as zf:
        names = [
            n for n in zf.namelist()
            if not n.endswith("/")
            and not n.startswith("__")
            and Path(n).suffix.lower() in {".csv", ".xlsx", ".xls"}
        ]
        if not names:
            print(f"  zip {archive.name} has no csv/xlsx", flush=True)
            return False
        names.sort(key=lambda n: (0 if n.lower().endswith(".csv") else 1, len(n)))
        chosen = names[0]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(zf.read(chosen))
        head = dest.read_bytes()[:80]
        print(
            f"  extracted {chosen} -> {dest} ({dest.stat().st_size:,} bytes) "
            f"head={head[:40]!r}",
            flush=True,
        )
        return dest.stat().st_size > 100


def pull_roll_from_storage(county: str, dest: Path) -> bool:
    """Find a 2026 roll for this county in Raw-Data (csv or zip)."""
    if dest.exists() and dest.stat().st_size > 100:
        return True
    keys = list_raw_data() if _storage_creds() else []
    needle = county.lower()
    year_hits = [
        k for k in keys
        if needle in k.lower()
        and "2026" in k
        and k.lower().endswith((".csv", ".xlsx", ".xls", ".zip"))
        and "owner" in k.lower()
    ]
    year_hits.sort(key=lambda k: (0 if k.lower().endswith((".csv", ".xlsx", ".xls")) else 1, len(k)))
    staged = dest.with_suffix(dest.suffix + ".download")
    for key in year_hits + [
        f"data/owners__2026_{county.title()}.zip",
        f"data/owners_2026_{county.title()}.csv",
        f"owners_2026_{county.title()}.csv",
    ]:
        if not download_storage_object(key, staged):
            continue
        if _extract_roll(staged, dest):
            staged.unlink(missing_ok=True)
            return True
        staged.unlink(missing_ok=True)
    return False


def download_tnris_parcels(county: str, cfg: dict[str, str]) -> Path | None:
    src_dir = ROOT / "data" / f"_src_{county}"
    existing = list(src_dir.rglob("*.shp")) + list(src_dir.rglob("*.gdb"))
    if existing:
        return existing[0] if existing[0].suffix == ".shp" else existing[0]
    zpath = src_dir / "lp.zip"
    src_dir.mkdir(parents=True, exist_ok=True)
    url = TNRIS_LP.format(state_fips=cfg["state_fips"])
    print(f"  TNRIS GET {url}", flush=True)
    r = curl([
        "-L", "-f",
        "-H", "Referer: https://data.geographic.texas.gov/",
        "-o", str(zpath),
        url,
    ])
    if r.returncode != 0 or not zpath.exists() or zpath.stat().st_size < 1000:
        print(f"  TNRIS miss for {county}", flush=True)
        return None
    with zipfile.ZipFile(zpath) as zf:
        zf.extractall(src_dir)
    gdbs = list(src_dir.rglob("*.gdb"))
    shps = [p for p in src_dir.rglob("*.shp") if "abstract" not in p.name.lower()]
    if gdbs:
        return gdbs[0]
    if shps:
        return shps[0]
    return None


def download_rrc_well_zip(fips: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 10_000:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    work = dest.parent
    jar = work / f"_gd_jar_{fips}.txt"
    folder = work / f"_gd_folder_{fips}.html"
    print(f"  RRC MFT listing for well{fips}.zip", flush=True)
    r = curl(["-c", str(jar), "-L", "-o", str(folder), "-w", "%{url_effective}", RRC_WELLS_MFT])
    final = r.stdout.decode().strip() if r and r.returncode == 0 else RRC_WELLS_MFT
    html = folder.read_text(encoding="utf-8", errors="ignore") if folder.exists() else ""
    vs_m = re.search(r'name="javax\.faces\.ViewState"[^>]*value="([^"]*)"', html)
    vs = vs_m.group(1) if vs_m else ""
    name = f"well{fips}.zip"
    file_m = re.search(re.escape(name), html)
    if not file_m:
        print(f"  MFT listing has no {name}", flush=True)
        return False
    seg = html[max(0, file_m.start() - 400): file_m.start() + 80]
    ids = re.findall(r'id="(fileTable:\d+:j_id_[0-9a-z]+)"', seg)
    cmd = ids[-1] if ids else ""
    if not cmd:
        print(f"  MFT row id missing for {name}", flush=True)
        return False
    data: list[str] = []
    for k, v in [
        ("fileList_SUBMIT", "1"),
        ("javax.faces.ViewState", vs),
        ("fileList", "fileList"),
        (cmd, cmd),
    ]:
        data += ["--data-urlencode", f"{k}={v}"]
    curl(["-b", str(jar), "-c", str(jar), "-X", "POST", "-o", os.devnull] + data + [final])
    r2 = curl([
        "-b", str(jar), "-c", str(jar), "-L",
        "-o", str(dest),
        "-w", "%{http_code}",
        f"{MFT_HOST}/link/godrivedownload",
    ])
    code = r2.stdout.decode().strip() if r2 and r2.returncode == 0 else "ERR"
    for tmp in (jar, folder):
        tmp.unlink(missing_ok=True)
    if dest.exists() and dest.stat().st_size > 10_000:
        print(f"  downloaded {dest} ({dest.stat().st_size:,} bytes, http={code})", flush=True)
        return True
    dest.unlink(missing_ok=True)
    print(f"  RRC well zip failed for {fips} (http={code})", flush=True)
    return False


def emit_baseline_parcels(county: str, abstracts: Path) -> None:
    """Write an empty-owner enriched GeoJSON so the county paints on the map."""
    import geopandas as gpd

    g = gpd.read_file(abstracts)
    if g.crs is None:
        g = g.set_crs("EPSG:4326")
    else:
        g = g.to_crs("EPSG:4326")
    g["owner_count"] = 0
    g["owners_json"] = "[]"
    g["top_operator"] = ""
    g["top_owner"] = ""
    g["max_propensity_score"] = 0
    g["field_name"] = "Unknown"
    g["production_status"] = "none"
    g["pdp_well_count"] = 0
    g["pud_well_count"] = 0
    g["well_count"] = 0
    g["permit_count"] = 0
    out_data = ROOT / "data" / f"{county}_parcels_enriched.geojson"
    out_pub = ROOT / "public" / f"{county}_parcels_enriched.geojson"
    out_data.parent.mkdir(parents=True, exist_ok=True)
    g.to_file(out_data, driver="GeoJSON")
    out_pub.write_text(out_data.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"  wrote baseline {out_pub} ({len(g)} tracts, 0 owners)", flush=True)


def upload_map_asset(name: str, path: Path) -> None:
    creds = _storage_creds()
    if not creds or not path.exists():
        return
    base, key_env = creds
    print(f"  upload map-data/{name}", flush=True)
    r = curl([
        "-H", f"apikey: {key_env}",
        "-H", f"Authorization: Bearer {key_env}",
        "-H", "Content-Type: application/json",
        "-H", "x-upsert: true",
        "-H", "cache-control: max-age=300",
        "--data-binary", f"@{path}",
        "-w", "%{http_code}",
        "-o", os.devnull,
        "-X", "POST",
        f"{base}/storage/v1/object/map-data/{name}",
    ])
    code = r.stdout.decode().strip() if r and r.returncode == 0 else "ERR"
    print(f"  upload {name} http={code}", flush=True)


def find_src(county: str) -> Path | None:
    src_dir = ROOT / "data" / f"_src_{county}"
    gdbs = list(src_dir.rglob("*.gdb"))
    if gdbs:
        return gdbs[0]
    shps = [p for p in src_dir.rglob("*.shp") if p.is_file()]
    return shps[0] if shps else None


def onboard(county: str, dry: bool) -> None:
    cfg = COUNTIES[county]
    roll = roll_path(county, cfg)
    abstracts = ROOT / "data" / county / "Abstracts.shp"
    wells_zip = ROOT / "data" / f"well{cfg['fips']}.zip"
    print(f"\n=== {county} ===", flush=True)

    if not roll.exists() and not dry:
        pull_roll_from_storage(county, roll)
    if not wells_zip.exists() and not dry:
        if not download_storage_object(f"well{cfg['fips']}.zip", wells_zip):
            download_rrc_well_zip(cfg["fips"], wells_zip)

    src = find_src(county)
    if not abstracts.exists() and src is None and not dry:
        src = download_tnris_parcels(county, cfg)

    print(f"roll={roll} exists={roll.exists()}", flush=True)
    print(f"abstracts={abstracts} exists={abstracts.exists()}", flush=True)
    print(f"wells={wells_zip} exists={wells_zip.exists()}", flush=True)
    print(f"src={src}", flush=True)

    if not abstracts.exists() and src is not None:
        cmd = [
            sys.executable, "scripts/build_county_tracts.py",
            "--county", county, "--src", str(src),
        ]
        if roll.exists():
            cmd += ["--roll", str(roll)]
        run(cmd, dry)

    has_db = bool(
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    )
    if roll.exists() and has_db:
        load = [
            sys.executable, "scripts/load_county_mineral_records.py",
            "--county", county, "--input", str(roll),
        ]
        if county == "howard":
            load.append("--truncate")
        try:
            run(load, dry)
        except subprocess.CalledProcessError as exc:
            print(f"owners table load failed ({exc.returncode}); continuing with rematch", flush=True)

    # enrich_county_parcels must not abort the remaining counties.
    elif roll.exists():
        print("skip owners load: no SUPABASE_SERVICE_ROLE_KEY", flush=True)
    else:
        print(f"skip owners load: missing {cfg['roll']}", flush=True)

    if (
        cfg.get("load_wells_table")
        and wells_zip.exists()
        and abstracts.exists()
        and has_db
    ):
        wcmd = [
            sys.executable, "scripts/load_county_wells_shapefile.py",
            "--county", county, "--zip", str(wells_zip),
            "--abstracts", str(abstracts),
        ]
        if roll.exists():
            wcmd += ["--cad-roll", str(roll)]
        try:
            run(wcmd, dry)
        except subprocess.CalledProcessError as exc:
            print(f"wells table load failed ({exc.returncode}); continuing", flush=True)
    else:
        print("skip wells table load (new empty counties only)", flush=True)

    if abstracts.exists() and roll.exists():
        enrich = [
            sys.executable, "scripts/enrich_county_parcels.py",
            "--county", county,
            "--input-parcels", str(abstracts),
            "--owners-csv", str(roll),
        ]
        try:
            run(enrich, dry)
            run([sys.executable, "scripts/build_map_geojson.py", "--county", county], dry)
        except subprocess.CalledProcessError as exc:
            print(f"enrich failed ({exc.returncode}); continuing", flush=True)
    elif abstracts.exists() and not dry:
        print("no owner roll: writing baseline tract GeoJSON", flush=True)
        emit_baseline_parcels(county, abstracts)
        run([sys.executable, "scripts/build_map_geojson.py", "--county", county], dry)
    else:
        print("skip enrich: need Abstracts.shp", flush=True)

    if wells_zip.exists():
        wgeo = [sys.executable, "scripts/build_wells_geojson.py", "--county", county]
        if os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY"):
            wgeo.append("--upload")
        run(wgeo, dry)
    else:
        print("skip wells geojson: missing well zip", flush=True)

    if not dry:
        for kind in ("parcels_enriched", "parcels_map", "wells"):
            upload_map_asset(
                f"{county}_{kind}.geojson",
                ROOT / "public" / f"{county}_{kind}.geojson",
            )


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--county", choices=["all", *COUNTIES], default="all")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    names = list(COUNTIES) if args.county == "all" else [args.county]
    for name in names:
        onboard(name, args.dry_run)


if __name__ == "__main__":
    main()
