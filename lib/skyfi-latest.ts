/**
 * On-demand SkyFi archive preview for pad chips.
 *
 * Uses POST /archives (catalog search) and returns a free thumbnail URL —
 * no paid order is placed. Full-resolution download / order-archive can be
 * gated behind a broker paywall later; for now this is open for testing
 * whenever SKYFI_API_KEY is set.
 *
 * Auth: X-Skyfi-Api-Key
 * Docs: https://app.skyfi.com/platform-api/redoc
 */

export const SKYFI_API_BASE = 'https://app.skyfi.com/platform-api'

export type SkyfiLatest = {
  url: string
  date: string
  cloudCover: number | null
  sceneId: string
  source: 'skyfi'
  provider?: string | null
  constellation?: string | null
  resolution?: string | null
  gsdCm?: number | null
}

type CacheEntry = { expires: number; value: SkyfiLatest | null }

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

type ArchiveRow = {
  archiveId?: string
  provider?: string
  constellation?: string
  resolution?: string
  captureTimestamp?: string
  cloudCoveragePercent?: number | null
  platformResolution?: number | null
  gsd?: number | null
  thumbnailUrls?: Record<string, string> | null
  openData?: boolean
}

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

function padAoiWkt(lat: number, lon: number, halfDeg = 0.004): string {
  // ~400–450 m half-side around the wellhead — enough for a pad chip.
  const w = lon - halfDeg
  const e = lon + halfDeg
  const s = lat - halfDeg
  const n = lat + halfDeg
  return `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`
}

function bestThumbnail(urls: Record<string, string> | null | undefined): string | null {
  if (!urls) return null
  const entries = Object.entries(urls).filter(([, href]) => Boolean(href))
  if (entries.length === 0) return null
  const scored = entries.map(([key, href]) => {
    const m = key.match(/(\d+)\s*[xX×]\s*(\d+)/)
    const area = m ? Number(m[1]) * Number(m[2]) : 0
    return { href, area, key }
  })
  scored.sort((a, b) => b.area - a.area)
  return scored[0]?.href || null
}

const RESOLUTION_RANK: Record<string, number> = {
  'ULTRA HIGH': 70,
  'SUPER HIGH': 60,
  'VERY HIGH': 50,
  'CM 30': 55,
  'CM 50': 45,
  HIGH: 40,
  MEDIUM: 30,
  LOW: 10,
}

function pickBestArchive(rows: ArchiveRow[]): ArchiveRow | null {
  const withThumb = rows.filter((r) => bestThumbnail(r.thumbnailUrls))
  const pool = withThumb.length > 0 ? withThumb : rows
  if (pool.length === 0) return null

  const scored = pool.map((row) => {
    const cloud = Number(row.cloudCoveragePercent)
    const cloudScore = Number.isFinite(cloud) ? cloud : 50
    const resRank = RESOLUTION_RANK[String(row.resolution || '').toUpperCase()] ?? 20
    const ts = Date.parse(String(row.captureTimestamp || '')) || 0
    // Prefer sharper + clearer + newer.
    const score = resRank * 1000 - cloudScore * 5 + ts / 1e12
    return { row, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.row || null
}

export function skyfiApiKey(): string | null {
  const key = (process.env.SKYFI_API_KEY || '').trim()
  return key || null
}

/**
 * Paywall stub — always allow while testing.
 * Flip SKYFI_PAYWALL_ENABLED=true later and implement seat/credit checks here.
 */
export function skyfiAccessAllowed(_userId?: string | null): boolean {
  const paywallOn = String(process.env.SKYFI_PAYWALL_ENABLED || '').toLowerCase() === 'true'
  if (!paywallOn) return true
  // TODO: require active SkyFi add-on / credit balance when paywall is enabled.
  return false
}

export async function fetchLatestSkyfi(
  lat: number,
  lon: number,
  opts?: { lookbackDays?: number; maxCloud?: number },
): Promise<SkyfiLatest | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const apiKey = skyfiApiKey()
  if (!apiKey) return null
  if (!skyfiAccessAllowed()) return null

  const key = cacheKey(lat, lon)
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value

  const lookbackDays = opts?.lookbackDays ?? 365
  const maxCloud = opts?.maxCloud ?? 40
  const end = new Date()
  const start = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

  const body = {
    aoi: padAoiWkt(lat, lon),
    fromDate: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    toDate: end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    maxCloudCoveragePercent: maxCloud,
    productTypes: ['DAY'],
    // Prefer commercial hi-res; still accept MEDIUM if that's all nearby.
    resolutions: ['ULTRA HIGH', 'SUPER HIGH', 'VERY HIGH', 'HIGH', 'MEDIUM', 'CM 30', 'CM 50'],
  }

  let res: Response
  try {
    res = await fetch(`${SKYFI_API_BASE}/archives`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Skyfi-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    cache.set(key, { expires: Date.now() + 5 * 60 * 1000, value: null })
    return null
  }

  if (!res.ok) {
    // Don't hammer a bad key — short negative cache.
    cache.set(key, { expires: Date.now() + 5 * 60 * 1000, value: null })
    return null
  }

  const json = (await res.json()) as { archives?: ArchiveRow[] }
  const best = pickBestArchive(json.archives || [])
  const url = bestThumbnail(best?.thumbnailUrls)
  if (!best || !url) {
    cache.set(key, { expires: Date.now() + 30 * 60 * 1000, value: null })
    return null
  }

  const cloudRaw = best.cloudCoveragePercent
  const value: SkyfiLatest = {
    url,
    date: String(best.captureTimestamp || '').slice(0, 10),
    cloudCover:
      cloudRaw == null || !Number.isFinite(Number(cloudRaw)) ? null : Number(cloudRaw),
    sceneId: String(best.archiveId || ''),
    source: 'skyfi',
    provider: best.provider ?? null,
    constellation: best.constellation ?? null,
    resolution: best.resolution ?? null,
    gsdCm:
      best.platformResolution != null && Number.isFinite(Number(best.platformResolution))
        ? Number(best.platformResolution)
        : best.gsd != null && Number.isFinite(Number(best.gsd))
          ? Number(best.gsd)
          : null,
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value })
  return value
}
