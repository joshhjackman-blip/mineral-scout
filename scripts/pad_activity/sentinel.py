"""Sentinel-2 L2A chip pull via Element84 Earth Search STAC.

Phase 1: module is wired but OFF by default (`--enable-sentinel`).
Pulling every pad chip across 12 counties needs careful rate limiting
and local rasterio/stackstac deps; enable once those are pinned in CI.

Storage layout (Supabase Raw-Data bucket):
  pad-imagery/{county}/{api_or_lease}/{YYYY-MM-DD}.tif
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any, Iterable

from .config import (
    CHIP_SIZE_PX,
    MAX_CLOUD_COVER_PCT,
    PAD_BUFFER_M,
    STAC_API_URL,
    STAC_COLLECTION,
    STORAGE_PREFIX,
)


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


def storage_key(county: str, pad_id: str, imagery_date: dt.date) -> str:
    return f"{STORAGE_PREFIX}/{county}/{pad_id}/{imagery_date.isoformat()}.tif"


def pad_id(target: PadTarget) -> str:
    if target.api_number:
        return target.api_number.replace("/", "_")
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
    """Query Element84 STAC for Sentinel-2 L2A items covering a point.

    Returns a list of lightweight dicts (id, datetime, cloud_cover,
    hrefs). Requires `pystac-client` when actually invoked.
    """
    try:
        from pystac_client import Client  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "pystac-client is required for --enable-sentinel. "
            "pip install pystac-client"
        ) from exc

    catalog = Client.open(STAC_API_URL)
    search = catalog.search(
        collections=[STAC_COLLECTION],
        intersects={"type": "Point", "coordinates": [lon, lat]},
        datetime=f"{start.isoformat()}/{end.isoformat()}",
        query={"eo:cloud_cover": {"lt": max_cloud}},
        max_items=10,
    )
    items = list(search.items())
    out: list[dict[str, Any]] = []
    for item in items:
        out.append(
            {
                "id": item.id,
                "datetime": item.datetime.isoformat() if item.datetime else None,
                "cloud_cover": (item.properties or {}).get("eo:cloud_cover"),
                "assets": {
                    k: v.href
                    for k, v in (item.assets or {}).items()
                    if k in {"red", "green", "blue", "nir", "visual", "B04", "B03", "B02", "B08"}
                },
            }
        )
    return out


def crop_chip_stub(target: PadTarget, scene: dict[str, Any]) -> None:
    """Placeholder for rasterio windowed read + chip write.

    Full implementation needs rasterio + the COG asset hrefs from STAC.
    Kept as an explicit stub so CI can import the module without heavy
    geospatial wheels until Phase 2 enables Sentinel in the workflow.
    """
    raise NotImplementedError(
        f"Sentinel chip crop not enabled yet "
        f"(pad={pad_id(target)}, scene={scene.get('id')}, "
        f"buffer_m={PAD_BUFFER_M}, chip_px={CHIP_SIZE_PX}). "
        f"Use --enable-sentinel once rasterio crop is landed."
    )


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
