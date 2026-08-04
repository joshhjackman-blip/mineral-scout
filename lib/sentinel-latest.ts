/**
 * On-demand Sentinel-2 pad chip via Element84 Earth Search + COG crop.
 *
 * Returns a same-origin chip URL that crops ~1.3 km around the wellhead
 * from the scene's visual COG (same FOV idea as the weekly rasterio job).
 * Full-tile preview.jpg is only a last-resort fallback.
 */

export const STAC_API_URL = 'https://earth-search.aws.element84.com/v1/search'
export const STAC_COLLECTION = 'sentinel-2-l2a'

/** Match weekly CHIP_SIZE_PX * 10 m/px FOV (~1.28 km). */
export const PAD_CHIP_GROUND_M = 1280
export const PAD_CHIP_MAX_SIZE = 512

export type SentinelLatest = {
  url: string
  date: string
  cloudCover: number | null
  sceneId: string
  source: 'sentinel-2'
  /** Visual COG used for the pad crop (for the chip route). */
  cogUrl?: string
}

type CacheEntry = { expires: number; value: SentinelLatest | null }

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h

function cacheKey(lat: number, lon: number): string {
  // ~100 m buckets so nearby pads on the same tract share one STAC hit.
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

function stacDatetimeRange(lookbackDays: number): string {
  const end = new Date()
  const start = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
  return `${start.toISOString()}/${end.toISOString()}`
}

type StacFeature = {
  id?: string
  properties?: {
    datetime?: string
    'eo:cloud_cover'?: number
  }
  assets?: Record<string, { href?: string; type?: string }>
}

function pickBest(features: StacFeature[]): StacFeature | null {
  if (features.length === 0) return null
  const withVisual = features.filter((f) => f.assets?.visual?.href || f.assets?.thumbnail?.href)
  const pool = withVisual.length > 0 ? withVisual : features
  const lowCloud = pool.filter((f) => {
    const cloud = Number(f.properties?.['eo:cloud_cover'])
    return Number.isFinite(cloud) && cloud < 40
  })
  const ranked = (lowCloud.length > 0 ? lowCloud : pool).slice()
  ranked.sort((a, b) =>
    String(b.properties?.datetime || '').localeCompare(String(a.properties?.datetime || '')),
  )
  return ranked[0] || null
}

/** WGS84 bbox centered on the pad for a square ground FOV. */
export function padChipBbox(
  lat: number,
  lon: number,
  groundM: number = PAD_CHIP_GROUND_M,
): [number, number, number, number] {
  const half = groundM / 2
  const dLat = half / 111_320
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const dLon = half / (111_320 * Math.max(0.2, cosLat))
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
}

export function isAllowedSentinelCog(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    if (
      u.hostname !== 'sentinel-cogs.s3.us-west-2.amazonaws.com' &&
      u.hostname !== 'sentinel-cogs.s3.amazonaws.com'
    ) {
      return false
    }
    return /\.(tif|tiff)$/i.test(u.pathname)
  } catch {
    return false
  }
}

/** Public TiTiler crop of an Element84 visual COG around the pad. */
export function buildTitilerCropUrl(
  cogUrl: string,
  lat: number,
  lon: number,
  opts?: { groundM?: number; maxSize?: number },
): string {
  const [minx, miny, maxx, maxy] = padChipBbox(lat, lon, opts?.groundM ?? PAD_CHIP_GROUND_M)
  const maxSize = opts?.maxSize ?? PAD_CHIP_MAX_SIZE
  const path = `https://titiler.xyz/cog/bbox/${minx},${miny},${maxx},${maxy}.jpg`
  const url = new URL(path)
  url.searchParams.set('url', cogUrl)
  url.searchParams.set('max_size', String(maxSize))
  return url.toString()
}

export function buildPadChipApiPath(lat: number, lon: number, cogUrl: string, date: string): string {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    cog: cogUrl,
    date,
  })
  return `/api/pad-activity/sentinel/chip?${params.toString()}`
}

export async function fetchLatestSentinel(
  lat: number,
  lon: number,
  opts?: { lookbackDays?: number; maxCloud?: number },
): Promise<SentinelLatest | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null

  const key = cacheKey(lat, lon)
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value

  const lookbackDays = opts?.lookbackDays ?? 365
  const pad = 0.02
  const body = {
    collections: [STAC_COLLECTION],
    bbox: [lon - pad, lat - pad, lon + pad, lat + pad],
    datetime: stacDatetimeRange(lookbackDays),
    limit: 24,
  }

  const res = await fetch(STAC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/geo+json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!res.ok) {
    cache.set(key, { expires: Date.now() + 5 * 60 * 1000, value: null })
    return null
  }

  const json = (await res.json()) as { features?: StacFeature[] }
  const best = pickBest(json.features || [])
  if (!best) {
    cache.set(key, { expires: Date.now() + 30 * 60 * 1000, value: null })
    return null
  }

  const cloudRaw = best.properties?.['eo:cloud_cover']
  const date = String(best.properties?.datetime || '').slice(0, 10)
  const sceneId = String(best.id || '')
  const cogUrl = best.assets?.visual?.href
  const thumbUrl = best.assets?.thumbnail?.href

  let value: SentinelLatest | null = null
  if (cogUrl && isAllowedSentinelCog(cogUrl)) {
    value = {
      url: buildPadChipApiPath(lat, lon, cogUrl, date),
      date,
      cloudCover: cloudRaw == null || !Number.isFinite(Number(cloudRaw)) ? null : Number(cloudRaw),
      sceneId,
      source: 'sentinel-2',
      cogUrl,
    }
  } else if (thumbUrl) {
    // Last resort — full-tile preview (not pad-centered).
    value = {
      url: thumbUrl,
      date,
      cloudCover: cloudRaw == null || !Number.isFinite(Number(cloudRaw)) ? null : Number(cloudRaw),
      sceneId,
      source: 'sentinel-2',
    }
  }

  cache.set(key, {
    expires: Date.now() + (value ? CACHE_TTL_MS : 30 * 60 * 1000),
    value,
  })
  return value
}
