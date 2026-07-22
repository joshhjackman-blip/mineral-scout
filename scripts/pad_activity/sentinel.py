"""Sentinel-2 L2A chip pull via Element84 Earth Search STAC.

Storage layout (Supabase Raw-Data bucket):
  pad-imagery/{county}/{api_or_lease}/{YYYY-MM-DD}.png

PNG (not GeoTIFF) so the Pad Activity UI can render chips in <img>.
Change detection downloads the same PNGs and loads them as RGB arrays.
"""

from __future__ import annotations

import datetime as dt
import io
import time
from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np

from .config import (
    CHIP_SIZE_PX,
    MAX_CLOUD_COVER_PCT,
    PAD_BUFFER_M,
    STAC_API_URL,
    STAC_COLLECTION,
    STORAGE_BUCKET,
    STORAGE_PREFIX,
)

# Prefer the rendered visual COG; fall back to separate 10 m bands.
_RGB_ASSET_KEYS = ("visual", "red", "green", "blue", "B04", "B03", "B02")


@dataclass
class PadTarget:
    county_id: str
    api_number: str | None
    rrc_lease_id: str | None
    abstract_number: str | None
    latitude: float
    longitude: float
    lease_name: str | None = None
    operator_name: str | None = None


@dataclass
class ChipResult:
    storage_path: str
    imagery_date: dt.date
    cloud_cover: float | None
    scene_id: str
    width: int
    height: int
    skipped: bool = False
    reason: str | None = None
    rgb: np.ndarray | None = None


def storage_key(county: str, pad: str, imagery_date: dt.date) -> str:
    return f"{STORAGE_PREFIX}/{county}/{pad}/{imagery_date.isoformat()}.png"


def pad_id(target: PadTarget) -> str:
    if target.api_number:
        return target.api_number.replace("/", "_").replace(" ", "")
    if target.rrc_lease_id:
        return f"lease_{target.rrc_lease_id}"
    return f"abs_{target.abstract_number or 'unknown'}"


def search_scenes(
    lon: float,
    lat: float,
    *,
    start: dt.date,
    end: dt.date,
    max_cloud: float = MAX_CLOUD_COVER_PCT,
) -> list[dict[str, Any]]:
    """Query Element84 STAC for Sentinel-2 L2A items covering a point."""
    try:
        from pystac_client import Client  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "pystac-client is required for --enable-sentinel. "
            "pip install pystac-client"
        ) from exc

    catalog = Client.open(STAC_API_URL)
    search_kwargs: dict[str, Any] = {
        "collections": [STAC_COLLECTION],
        "intersects": {"type": "Point", "coordinates": [lon, lat]},
        "datetime": f"{start.isoformat()}/{end.isoformat()}",
        "query": {"eo:cloud_cover": {"lt": max_cloud}},
        "max_items": 12,
    }
    try:
        search = catalog.search(**search_kwargs)
        items = list(search.items())
    except Exception:
        # Some STAC deployments reject query/sort filters — retry bare.
        search = catalog.search(
            collections=[STAC_COLLECTION],
            intersects={"type": "Point", "coordinates": [lon, lat]},
            datetime=f"{start.isoformat()}/{end.isoformat()}",
            max_items=12,
        )
        items = [
            it
            for it in search.items()
            if float((it.properties or {}).get("eo:cloud_cover") or 0) < max_cloud
        ]
    out: list[dict[str, Any]] = []
    for item in items:
        assets: dict[str, str] = {}
        for key, asset in (item.assets or {}).items():
            if key in _RGB_ASSET_KEYS or key.lower() in {
                "visual",
                "red",
                "green",
                "blue",
                "b04",
                "b03",
                "b02",
            }:
                href = getattr(asset, "href", None)
                if href:
                    assets[key] = href
        out.append(
            {
                "id": item.id,
                "datetime": item.datetime.isoformat() if item.datetime else None,
                "cloud_cover": (item.properties or {}).get("eo:cloud_cover"),
                "assets": assets,
            }
        )
    # Least cloudy first, then newest.
    out.sort(
        key=lambda s: (
            float(s["cloud_cover"]) if s.get("cloud_cover") is not None else 999.0,
            -(
                dt.datetime.fromisoformat(s["datetime"].replace("Z", "+00:00")).timestamp()
                if s.get("datetime")
                else 0.0
            ),
        )
    )
    return out


def _scene_date(scene: dict[str, Any]) -> dt.date | None:
    raw = scene.get("datetime")
    if not raw:
        return None
    try:
        return dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _resolve_rgb_hrefs(assets: dict[str, str]) -> list[str]:
    """Return 1 href (visual) or 3 hrefs (R,G,B)."""
    lower = {k.lower(): v for k, v in assets.items()}
    if "visual" in lower:
        return [lower["visual"]]
    for keys in (("red", "green", "blue"), ("b04", "b03", "b02")):
        if all(k in lower for k in keys):
            return [lower[k] for k in keys]
    raise ValueError(f"No RGB assets in scene; have {sorted(assets)}")


def crop_chip(
    target: PadTarget,
    scene: dict[str, Any],
    *,
    chip_px: int = CHIP_SIZE_PX,
    buffer_m: float = PAD_BUFFER_M,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Windowed read of a Sentinel-2 COG around the pad; return HxWx3 uint8 + meta.

    Uses rasterio's HTTP COG range reads — no full-scene download.
    """
    try:
        import rasterio  # type: ignore
        from rasterio.enums import Resampling  # type: ignore
        from rasterio.transform import rowcol  # type: ignore
        from rasterio.warp import transform as warp_transform  # type: ignore
        from rasterio.windows import Window  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "rasterio is required for Sentinel chip crop. "
            "pip install rasterio"
        ) from exc

    hrefs = _resolve_rgb_hrefs(scene.get("assets") or {})
    # FOV: max(configured buffer*2, chip_px * 10 m Sentinel resolution)
    ground_m = max(float(buffer_m) * 2.0, float(chip_px) * 10.0)

    with rasterio.Env(AWS_NO_SIGN_REQUEST="YES", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open(hrefs[0]) as src:
            xs, ys = warp_transform("EPSG:4326", src.crs, [target.longitude], [target.latitude])
            row, col = rowcol(src.transform, xs[0], ys[0])
            res_x = abs(src.transform.a)
            res_y = abs(src.transform.e)
            half_px = max(1, int(round((ground_m / 2.0) / max(res_x, res_y))))
            # Read a square window then resample to chip_px.
            window = Window(
                int(col) - half_px,
                int(row) - half_px,
                half_px * 2,
                half_px * 2,
            )

            if len(hrefs) == 1:
                # visual COG — take first 3 bands
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
                elif data.shape[0] == 2:
                    data = np.vstack([data, data[0:1]])
            else:
                bands = []
                for href in hrefs:
                    with rasterio.open(href) as band_src:
                        bxs, bys = warp_transform(
                            "EPSG:4326", band_src.crs, [target.longitude], [target.latitude]
                        )
                        brow, bcol = rowcol(band_src.transform, bxs[0], bys[0])
                        bres = max(abs(band_src.transform.a), abs(band_src.transform.e))
                        bhalf = max(1, int(round((ground_m / 2.0) / bres)))
                        bwin = Window(
                            int(bcol) - bhalf,
                            int(brow) - bhalf,
                            bhalf * 2,
                            bhalf * 2,
                        )
                        band = band_src.read(
                            1,
                            window=bwin,
                            out_shape=(chip_px, chip_px),
                            resampling=Resampling.bilinear,
                            boundless=True,
                            fill_value=0,
                        )
                        bands.append(band)
                data = np.stack(bands, axis=0)

    # Normalize reflectance / DN into displayable uint8.
    # visual COGs are already uint8 RGB; spectral bands are uint16
    # reflectance * 10000.
    arr = np.asarray(data)
    if arr.dtype == np.uint8 or float(arr.max()) <= 255:
        arr = np.clip(arr.astype(np.float32), 0, 255)
    else:
        arr_f = arr.astype(np.float32)
        if arr_f.max() <= 1.5:
            arr = arr_f * 255.0
        else:
            # L2A reflectance scaled by 10000
            arr = np.clip(arr_f / 10000.0 * 255.0, 0, 255)
    rgb = np.transpose(arr[:3], (1, 2, 0)).astype(np.uint8)

    meta = {
        "scene_id": scene.get("id"),
        "cloud_cover": scene.get("cloud_cover"),
        "chip_px": chip_px,
        "buffer_m": buffer_m,
        "ground_m": ground_m,
    }
    return rgb, meta


def chip_to_png_bytes(rgb: np.ndarray) -> bytes:
    try:
        from PIL import Image  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Pillow is required to encode pad chips. pip install pillow"
        ) from exc

    if rgb.dtype != np.uint8:
        rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    if rgb.ndim != 3 or rgb.shape[2] < 3:
        raise ValueError(f"Expected HxWx3 chip, got {rgb.shape}")
    img = Image.fromarray(rgb[:, :, :3], mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def png_bytes_to_rgb(png_bytes: bytes) -> np.ndarray:
    try:
        from PIL import Image  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Pillow is required to decode pad chips. pip install pillow"
        ) from exc
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    return np.asarray(img, dtype=np.uint8)


def download_chip_rgb(client: Any, storage_path: str) -> np.ndarray:
    blob = client.storage.from_(STORAGE_BUCKET).download(storage_path)
    return png_bytes_to_rgb(blob)


def upload_chip(
    client: Any,
    *,
    storage_path: str,
    png_bytes: bytes,
    dry_run: bool = False,
) -> str:
    if dry_run:
        return storage_path
    # Upsert so re-runs are idempotent.
    try:
        client.storage.from_(STORAGE_BUCKET).upload(
            path=storage_path,
            file=png_bytes,
            file_options={
                "content-type": "image/png",
                "upsert": "true",
            },
        )
    except Exception as exc:
        # supabase-py versions disagree on upsert kw; try update-via-remove.
        message = str(exc).lower()
        if "exists" in message or "duplicate" in message or "already" in message:
            try:
                client.storage.from_(STORAGE_BUCKET).remove([storage_path])
            except Exception:
                pass
            client.storage.from_(STORAGE_BUCKET).upload(
                path=storage_path,
                file=png_bytes,
                file_options={"content-type": "image/png"},
            )
        else:
            raise
    return storage_path


def upsert_imagery_log(
    client: Any,
    *,
    target: PadTarget,
    imagery_date: dt.date,
    storage_path: str,
    cloud_cover: float | None,
    dry_run: bool = False,
) -> None:
    row = {
        "county_id": target.county_id,
        "rrc_lease_id": target.rrc_lease_id,
        "api_number": target.api_number,
        "abstract_number": target.abstract_number,
        "imagery_date": imagery_date.isoformat(),
        "cloud_cover": cloud_cover,
        "storage_path": storage_path,
        "source": "sentinel-2",
    }
    if dry_run:
        return
    # Delete matching chip then insert — unique index is expression-based
    # so PostgREST upsert-on-conflict is awkward.
    q = (
        client.table("pad_imagery_log")
        .delete()
        .eq("county_id", target.county_id)
        .eq("imagery_date", imagery_date.isoformat())
    )
    if target.api_number:
        q = q.eq("api_number", target.api_number)
    elif target.rrc_lease_id:
        q = q.eq("rrc_lease_id", target.rrc_lease_id)
    q.execute()
    client.table("pad_imagery_log").insert(row).execute()


def pick_best_scene(
    lon: float,
    lat: float,
    *,
    start: dt.date,
    end: dt.date,
) -> dict[str, Any] | None:
    scenes = search_scenes(lon, lat, start=start, end=end)
    return scenes[0] if scenes else None


def pull_chip_for_target(
    client: Any,
    target: PadTarget,
    *,
    week_end: dt.date,
    lookback_days: int = 14,
    dry_run: bool = False,
) -> ChipResult:
    """Search → crop → upload → log one pad chip for the week window."""
    start = week_end - dt.timedelta(days=max(1, lookback_days) - 1)
    scene = pick_best_scene(
        target.longitude, target.latitude, start=start, end=week_end
    )
    if not scene:
        return ChipResult(
            storage_path="",
            imagery_date=week_end,
            cloud_cover=None,
            scene_id="",
            width=0,
            height=0,
            skipped=True,
            reason="no_scene",
        )

    imagery_date = _scene_date(scene) or week_end
    path = storage_key(target.county_id, pad_id(target), imagery_date)

    rgb, meta = crop_chip(target, scene)
    png = chip_to_png_bytes(rgb)
    upload_chip(client, storage_path=path, png_bytes=png, dry_run=dry_run)
    upsert_imagery_log(
        client,
        target=target,
        imagery_date=imagery_date,
        storage_path=path,
        cloud_cover=float(meta["cloud_cover"])
        if meta.get("cloud_cover") is not None
        else None,
        dry_run=dry_run,
    )
    return ChipResult(
        storage_path=path,
        imagery_date=imagery_date,
        cloud_cover=float(meta["cloud_cover"])
        if meta.get("cloud_cover") is not None
        else None,
        scene_id=str(meta.get("scene_id") or scene.get("id") or ""),
        width=int(rgb.shape[1]),
        height=int(rgb.shape[0]),
        rgb=rgb,
    )


def pull_chips(
    client: Any,
    targets: Iterable[PadTarget],
    *,
    week_end: dt.date | None = None,
    lookback_days: int = 14,
    max_chips: int = 25,
    sleep_s: float = 0.35,
    dry_run: bool = False,
) -> dict[str, int]:
    """Pull chips for up to max_chips targets. Returns counters."""
    week_end = week_end or dt.date.today()
    stats = {
        "attempted": 0,
        "uploaded": 0,
        "skipped_no_scene": 0,
        "errors": 0,
    }
    for i, target in enumerate(targets):
        if i >= max_chips:
            break
        stats["attempted"] += 1
        try:
            result = pull_chip_for_target(
                client,
                target,
                week_end=week_end,
                lookback_days=lookback_days,
                dry_run=dry_run,
            )
            if result.skipped:
                stats["skipped_no_scene"] += 1
                print(
                    f"    skip {pad_id(target)}: {result.reason}",
                    flush=True,
                )
            else:
                stats["uploaded"] += 1
                print(
                    f"    ok {pad_id(target)} → {result.storage_path} "
                    f"(cloud={result.cloud_cover})",
                    flush=True,
                )
        except Exception as exc:
            stats["errors"] += 1
            print(f"    ERR {pad_id(target)}: {exc}", flush=True)
        if sleep_s > 0:
            time.sleep(sleep_s)
    return stats


def plan_weekly_pull(
    targets: Iterable[PadTarget],
    *,
    week_end: dt.date,
) -> list[dict[str, Any]]:
    """Dry-run planner: list which pads would be queried this week."""
    week_start = week_end - dt.timedelta(days=6)
    plan = []
    for t in targets:
        plan.append(
            {
                "county_id": t.county_id,
                "pad_id": pad_id(t),
                "lat": t.latitude,
                "lon": t.longitude,
                "window": [week_start.isoformat(), week_end.isoformat()],
                "storage_key": storage_key(t.county_id, pad_id(t), week_end),
            }
        )
    return plan


def crop_chip_stub(target: PadTarget, scene: dict[str, Any]) -> tuple[np.ndarray, dict[str, Any]]:
    """Deprecated alias for crop_chip()."""
    return crop_chip(target, scene)
