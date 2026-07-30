/**
 * On-demand latest Sentinel-2 preview via Element84 Earth Search.
 *
 * Free fallback when pad_activity_events has no before_path/after_path and
 * SkyFi is unavailable (missing SKYFI_API_KEY or no archive hit). Prefer
 * lib/pad-imagery.ts in app routes so SkyFi is tried first.
 */

export const STAC_API_URL = 'https://earth-search.aws.element84.com/v1/search'
export const STAC_COLLECTION = 'sentinel-2-l2a'

export type SentinelLatest = {
  url: string
  date: string
  cloudCover: number | null
  sceneId: string
  source: 'sentinel-2'
}

type CacheEntry = { expires: number; value: SentinelLatest | null }

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h — scenes don't change often

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
  const withThumb = features.filter((f) => f.assets?.thumbnail?.href)
  const pool = withThumb.length > 0 ? withThumb : features
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
  const href = best?.assets?.thumbnail?.href
  if (!best || !href) {
    cache.set(key, { expires: Date.now() + 30 * 60 * 1000, value: null })
    return null
  }

  const cloudRaw = best.properties?.['eo:cloud_cover']
  const value: SentinelLatest = {
    url: href,
    date: String(best.properties?.datetime || '').slice(0, 10),
    cloudCover: cloudRaw == null || !Number.isFinite(Number(cloudRaw)) ? null : Number(cloudRaw),
    sceneId: String(best.id || ''),
    source: 'sentinel-2',
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value })
  return value
}
