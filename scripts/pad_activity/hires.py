"""Phase 2c — NAIP (~60 cm) hi-res confirmation chips.

Pulls USDA NAIP aerial imagery from Microsoft Planetary Computer for
pads that landed as AMBIGUOUS (Needs Review). Same storage layout as
Sentinel chips, with a `_hires.png` suffix and source=`naip`.

  python -m scripts.pad_activity.hires --county howard --event-id 123
  # or from weekly: --enable-hires
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from typing import Any

import numpy as np

from .config import (
    HIRES_CHIP_SIZE_PX,
    HIRES_PAD_BUFFER_M,
    HIRES_STAC_API_URL,
    HIRES_STAC_COLLECTION,
)
from .db import make_client
from .sentinel import (
    PadTarget,
    chip_to_png_bytes,
    pad_id,
    upload_chip,
)


def hires_storage_key(county: str, pad: str, imagery_date: dt.date) -> str:
    return f"pad-imagery/{county}/{pad}/{imagery_date.isoformat()}_hires.png"


def search_naip(
    lon: float,
    lat: float,
    *,
    start: dt.date | None = None,
    end: dt.date | None = None,
) -> dict[str, Any] | None:
    try:
        from pystac_client import Client  # type: ignore
        import planetary_computer as pc  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "pystac-client and planetary-computer are required for hi-res NAIP. "
            "pip install pystac-client planetary-computer"
        ) from exc

    start = start or dt.date(2018, 1, 1)
    end = end or dt.date.today()
    catalog = Client.open(HIRES_STAC_API_URL, modifier=pc.sign_inplace)
    search = catalog.search(
        collections=[HIRES_STAC_COLLECTION],
        intersects={"type": "Point", "coordinates": [lon, lat]},
        datetime=f"{start.isoformat()}/{end.isoformat()}",
        max_items=5,
    )
    items = sorted(
        list(search.items()),
        key=lambda it: it.datetime or dt.datetime.min.replace(tzinfo=dt.timezone.utc),
        reverse=True,
    )
    if not items:
        return None
    item = items[0]
    asset = (item.assets or {}).get("image")
    if not asset or not getattr(asset, "href", None):
        return None
    return {
        "id": item.id,
        "datetime": item.datetime.isoformat() if item.datetime else None,
        "href": asset.href,
    }


def crop_naip_chip(
    lon: float,
    lat: float,
    href: str,
    *,
    chip_px: int = HIRES_CHIP_SIZE_PX,
    buffer_m: float = HIRES_PAD_BUFFER_M,
) -> np.ndarray:
    try:
        import rasterio  # type: ignore
        from rasterio.enums import Resampling  # type: ignore
        from rasterio.transform import rowcol  # type: ignore
        from rasterio.warp import transform as warp_transform  # type: ignore
        from rasterio.windows import Window  # type: ignore
    except ImportError as exc:
        raise RuntimeError("rasterio is required for NAIP crop") from exc

    ground_m = max(float(buffer_m) * 2.0, 200.0)
    with rasterio.Env():
        with rasterio.open(href) as src:
            xs, ys = warp_transform("EPSG:4326", src.crs, [lon], [lat])
            row, col = rowcol(src.transform, xs[0], ys[0])
            res = max(abs(src.transform.a), abs(src.transform.e))
            half = max(1, int(round((ground_m / 2.0) / res)))
            window = Window(int(col) - half, int(row) - half, half * 2, half * 2)
            count = min(3, src.count)
            data = src.read(
                indexes=list(range(1, count + 1)),
                window=window,
                out_shape=(count, chip_px, chip_px),
                resampling=Resampling.bilinear,
                boundless=True,
                fill_value=0,
            )
            if data.shape[0] == 1:
                data = np.repeat(data, 3, axis=0)
    arr = np.asarray(data)
    if arr.dtype != np.uint8 and float(arr.max()) > 255:
        arr = np.clip(arr.astype(np.float32) / max(float(arr.max()), 1.0) * 255.0, 0, 255)
    else:
        arr = np.clip(arr.astype(np.float32), 0, 255)
    return np.transpose(arr[:3], (1, 2, 0)).astype(np.uint8)


def pull_hires_for_target(
    client: Any,
    target: PadTarget,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    scene = search_naip(target.longitude, target.latitude)
    if not scene:
        return {"ok": False, "reason": "no_naip_scene"}
    raw_dt = scene.get("datetime") or ""
    try:
        imagery_date = dt.datetime.fromisoformat(
            str(raw_dt).replace("Z", "+00:00")
        ).date()
    except ValueError:
        imagery_date = dt.date.today()

    rgb = crop_naip_chip(target.longitude, target.latitude, scene["href"])
    png = chip_to_png_bytes(rgb)
    path = hires_storage_key(target.county_id, pad_id(target), imagery_date)
    upload_chip(client, storage_path=path, png_bytes=png, dry_run=dry_run)

    if not dry_run:
        row = {
            "county_id": target.county_id,
            "rrc_lease_id": target.rrc_lease_id,
            "api_number": target.api_number,
            "abstract_number": target.abstract_number,
            "imagery_date": imagery_date.isoformat(),
            "cloud_cover": None,
            "storage_path": path,
            "source": "naip",
        }
        q = (
            client.table("pad_imagery_log")
            .delete()
            .eq("county_id", target.county_id)
            .eq("imagery_date", imagery_date.isoformat())
            .eq("source", "naip")
        )
        if target.api_number:
            q = q.eq("api_number", target.api_number)
        elif target.rrc_lease_id:
            q = q.eq("rrc_lease_id", target.rrc_lease_id)
        q.execute()
        client.table("pad_imagery_log").insert(row).execute()

    return {
        "ok": True,
        "storage_path": path,
        "imagery_date": imagery_date.isoformat(),
        "item_id": scene["id"],
        "source": "naip",
    }


def stamp_event_hires(
    client: Any,
    *,
    event_id: int,
    result: dict[str, Any],
    lat: float,
    lon: float,
) -> int:
    seed = (
        client.table("pad_activity_events")
        .select("id,county_id,api_number,rrc_lease_id,week_start,source,raw")
        .eq("id", event_id)
        .limit(1)
        .execute()
        .data
        or [None]
    )[0]
    if not seed:
        return 0
    meta = {
        "hires_path": result["storage_path"],
        "hires_date": result["imagery_date"],
        "hires_source": "naip",
        "hires_item_id": result.get("item_id"),
        "hires_requested_at": dt.datetime.utcnow().isoformat() + "Z",
        "hires_from_event_id": event_id,
        "latitude": lat,
        "longitude": lon,
    }
    q = (
        client.table("pad_activity_events")
        .select("id,raw")
        .eq("county_id", seed["county_id"])
        .eq("week_start", seed["week_start"])
        .eq("source", seed["source"])
    )
    if seed.get("api_number"):
        q = q.eq("api_number", seed["api_number"])
    elif seed.get("rrc_lease_id"):
        q = q.eq("rrc_lease_id", seed["rrc_lease_id"])
    else:
        q = q.eq("id", event_id)
    siblings = q.execute().data or []
    updated = 0
    for row in siblings:
        prior = dict(row.get("raw") or {})
        prior.update(meta)
        client.table("pad_activity_events").update({"raw": prior}).eq("id", row["id"]).execute()
        updated += 1
    return updated


def pull_hires_for_ambiguous(
    client: Any,
    *,
    county_id: str,
    max_pads: int = 10,
    dry_run: bool = False,
) -> dict[str, int]:
    """Auto-pull NAIP for recent AMBIGUOUS events missing hires_path."""
    rows = (
        client.table("pad_activity_events")
        .select(
            "id,county_id,api_number,rrc_lease_id,abstract_number,raw,signature"
        )
        .eq("county_id", county_id)
        .eq("signature", "AMBIGUOUS")
        .order("created_at", desc=True)
        .limit(200)
        .execute()
        .data
        or []
    )
    stats = {"attempted": 0, "ok": 0, "skipped": 0, "failed": 0}
    seen: set[str] = set()
    for row in rows:
        raw = row.get("raw") or {}
        if raw.get("hires_path"):
            stats["skipped"] += 1
            continue
        lat = raw.get("latitude")
        lon = raw.get("longitude")
        if lat is None or lon is None:
            stats["skipped"] += 1
            continue
        key = f"{row.get('api_number') or ''}|{row.get('rrc_lease_id') or ''}"
        if key in seen:
            continue
        seen.add(key)
        if stats["attempted"] >= max_pads:
            break
        stats["attempted"] += 1
        target = PadTarget(
            county_id=county_id,
            api_number=row.get("api_number"),
            rrc_lease_id=row.get("rrc_lease_id"),
            abstract_number=row.get("abstract_number"),
            latitude=float(lat),
            longitude=float(lon),
        )
        try:
            result = pull_hires_for_target(client, target, dry_run=dry_run)
            if not result.get("ok"):
                stats["failed"] += 1
                continue
            if not dry_run:
                stamp_event_hires(
                    client,
                    event_id=int(row["id"]),
                    result=result,
                    lat=float(lat),
                    lon=float(lon),
                )
            stats["ok"] += 1
        except Exception as exc:
            print(f"  hires fail pad={key}: {exc}", flush=True)
            stats["failed"] += 1
    return stats


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Pull NAIP hi-res chips for pad review")
    p.add_argument("--county", required=True)
    p.add_argument("--event-id", type=int, default=None)
    p.add_argument("--max-pads", type=int, default=10)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)

    client = make_client()
    if args.event_id:
        seed = (
            client.table("pad_activity_events")
            .select("*")
            .eq("id", args.event_id)
            .limit(1)
            .execute()
            .data
            or [None]
        )[0]
        if not seed:
            print("event not found", file=sys.stderr)
            return 1
        raw = seed.get("raw") or {}
        lat = float(raw["latitude"])
        lon = float(raw["longitude"])
        target = PadTarget(
            county_id=seed["county_id"],
            api_number=seed.get("api_number"),
            rrc_lease_id=seed.get("rrc_lease_id"),
            abstract_number=seed.get("abstract_number"),
            latitude=lat,
            longitude=lon,
        )
        result = pull_hires_for_target(client, target, dry_run=args.dry_run)
        print(result)
        if result.get("ok") and not args.dry_run:
            n = stamp_event_hires(
                client, event_id=args.event_id, result=result, lat=lat, lon=lon
            )
            print(f"stamped {n} sibling events")
        return 0 if result.get("ok") else 2

    stats = pull_hires_for_ambiguous(
        client,
        county_id=args.county,
        max_pads=args.max_pads,
        dry_run=args.dry_run,
    )
    print(stats)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
