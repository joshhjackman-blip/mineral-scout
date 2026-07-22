/**
 * Hi-res pad chips for Needs Review confirmation.
 *
 * Primary: Mapbox Satellite static API (current composite imagery —
 * what you need to confirm a 2025/2026 completion crew).
 * Fallback: USDA NAIP via Planetary Computer (~60 cm, but Texas
 * flights are often 2–4 years old — labeled clearly when used).
 */

import sharp from 'sharp'

const PC_STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1'
const PC_TILE =
  'https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad'

export type HiresChipResult = {
  png: Buffer
  imageryDate: string
  source: 'mapbox-satellite' | 'naip'
  itemId: string
  /** Human label for the chip panel subtitle */
  label: string
  groundMApprox: number
  /** True when imagery is older than ~18 months (NAIP survey lag). */
  isStaleSurvey: boolean
}

function mapboxToken(): string | null {
  return (
    process.env.MAPBOX_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    null
  )
}

function lonLatToTileFrac(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

/** Current Mapbox Satellite static chip centered on the pad. */
export async function pullMapboxSatelliteChip(
  lon: number,
  lat: number,
): Promise<HiresChipResult> {
  const token = mapboxToken()
  if (!token) {
    throw new Error('MAPBOX_TOKEN / NEXT_PUBLIC_MAPBOX_TOKEN missing')
  }
  // z=17 ≈ pad + neighbors; @2x → 1024 then we downscale to 512 crisp.
  const zoom = 17
  const url =
    `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/` +
    `${lon.toFixed(6)},${lat.toFixed(6)},${zoom},0/512x512@2x` +
    `?access_token=${encodeURIComponent(token)}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Mapbox satellite failed (${res.status})`)
  }
  const raw = Buffer.from(await res.arrayBuffer())
  const png = await sharp(raw).resize(512, 512).png({ compressionLevel: 9 }).toBuffer()
  const imageryDate = new Date().toISOString().slice(0, 10)
  return {
    png,
    imageryDate,
    source: 'mapbox-satellite',
    itemId: `mapbox-satellite-${zoom}`,
    label: 'Mapbox Satellite · current',
    groundMApprox: 300,
    isStaleSurvey: false,
  }
}

async function searchNaipItem(
  lon: number,
  lat: number,
): Promise<{ id: string; datetime: string } | null> {
  const res = await fetch(`${PC_STAC}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json' },
    body: JSON.stringify({
      collections: ['naip'],
      intersects: { type: 'Point', coordinates: [lon, lat] },
      datetime: '2018-01-01T00:00:00Z/2030-12-31T23:59:59Z',
      limit: 12,
    }),
  })
  if (!res.ok) throw new Error(`NAIP STAC search failed (${res.status})`)
  const body = (await res.json()) as {
    features?: Array<{ id?: string; properties?: { datetime?: string } }>
  }
  const features = [...(body.features || [])].sort((a, b) => {
    const da = String(a.properties?.datetime || '')
    const db = String(b.properties?.datetime || '')
    return db.localeCompare(da)
  })
  const feature = features[0]
  if (!feature?.id) return null
  return {
    id: feature.id,
    datetime: feature.properties?.datetime || '2018-01-01T00:00:00Z',
  }
}

async function fetchTileJpeg(itemId: string, z: number, x: number, y: number): Promise<Buffer> {
  const url =
    `${PC_TILE}/${z}/${x}/${y}@1x` +
    `?collection=naip&item=${encodeURIComponent(itemId)}&assets=image`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`NAIP tile ${z}/${x}/${y} failed (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 100) throw new Error(`NAIP tile ${z}/${x}/${y} empty`)
  return buf
}

/** Fallback: latest NAIP survey tile mosaic (often 2–4 years old in TX). */
export async function pullNaipChip(lon: number, lat: number): Promise<HiresChipResult> {
  const item = await searchNaipItem(lon, lat)
  if (!item) throw new Error('No NAIP scene found for this pad location')

  const z = 18
  const { x: xf, y: yf } = lonLatToTileFrac(lon, lat, z)
  const x0 = Math.floor(xf - 0.5)
  const y0 = Math.floor(yf - 0.5)
  const tiles = await Promise.all([
    fetchTileJpeg(item.id, z, x0, y0),
    fetchTileJpeg(item.id, z, x0 + 1, y0),
    fetchTileJpeg(item.id, z, x0, y0 + 1),
    fetchTileJpeg(item.id, z, x0 + 1, y0 + 1),
  ])
  const tileSize = 256
  const tileBufs = await Promise.all(tiles.map((t) => sharp(t).removeAlpha().toBuffer()))
  const mosaic = await sharp({
    create: {
      width: tileSize * 2,
      height: tileSize * 2,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: tileBufs[0], left: 0, top: 0 },
      { input: tileBufs[1], left: tileSize, top: 0 },
      { input: tileBufs[2], left: 0, top: tileSize },
      { input: tileBufs[3], left: tileSize, top: tileSize },
    ])
    .png()
    .toBuffer()

  const padPxX = (xf - x0) * tileSize
  const padPxY = (yf - y0) * tileSize
  const crop = 420
  const left = Math.max(0, Math.min(tileSize * 2 - crop, Math.round(padPxX - crop / 2)))
  const top = Math.max(0, Math.min(tileSize * 2 - crop, Math.round(padPxY - crop / 2)))
  const png = await sharp(mosaic)
    .extract({ left, top, width: crop, height: crop })
    .resize(512, 512, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer()

  const imageryDate = item.datetime.slice(0, 10)
  const ageMs = Date.now() - Date.parse(imageryDate)
  const isStaleSurvey = !Number.isFinite(ageMs) || ageMs > 18 * 30 * 24 * 60 * 60 * 1000
  return {
    png,
    imageryDate,
    source: 'naip',
    itemId: item.id,
    label: `NAIP survey · ${imageryDate.slice(0, 4)} (latest flight)`,
    groundMApprox: 250,
    isStaleSurvey,
  }
}

/** Prefer current Mapbox satellite; fall back to NAIP survey. */
export async function pullHiresChip(lon: number, lat: number): Promise<HiresChipResult> {
  try {
    return await pullMapboxSatelliteChip(lon, lat)
  } catch (mapboxErr) {
    try {
      return await pullNaipChip(lon, lat)
    } catch {
      throw mapboxErr instanceof Error
        ? mapboxErr
        : new Error('Hi-res imagery pull failed')
    }
  }
}

export function hiresStoragePath(
  countyId: string,
  padKey: string,
  imageryDate: string,
  source: string,
): string {
  const safePad = padKey.replace(/[^a-zA-Z0-9._-]/g, '_')
  const safeSource = source.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `pad-imagery/${countyId}/${safePad}/${imageryDate}_${safeSource}.png`
}

export function padKeyFromEvent(ev: {
  api_number?: string | null
  rrc_lease_id?: string | null
  abstract_number?: string | null
}): string {
  if (ev.api_number) return String(ev.api_number).replace(/\//g, '_').replace(/\s/g, '')
  if (ev.rrc_lease_id) return `lease_${ev.rrc_lease_id}`
  return `abs_${ev.abstract_number || 'unknown'}`
}
