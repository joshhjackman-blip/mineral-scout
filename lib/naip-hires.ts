/**
 * NAIP (~60 cm) hi-res pad chips via Microsoft Planetary Computer.
 * Used by POST /api/pad-activity/hires for Needs Review confirmation.
 *
 * Flow: STAC search → XYZ tiles around the pad → sharp mosaic → PNG bytes.
 * No paid Planet/Maxar key required; Texas NAIP is public on PC.
 */

import sharp from 'sharp'

const PC_STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1'
const PC_TILE =
  'https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad'

export type NaipChipResult = {
  png: Buffer
  imageryDate: string
  itemId: string
  zoom: number
  groundMApprox: number
}

function lonLatToTileFrac(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

/** Search Planetary Computer for the newest NAIP item covering a point. */
export async function searchNaipItem(
  lon: number,
  lat: number,
  startYear = 2018,
): Promise<{ id: string; datetime: string } | null> {
  const start = `${startYear}-01-01T00:00:00Z`
  const end = new Date().toISOString()
  const res = await fetch(`${PC_STAC}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json' },
    body: JSON.stringify({
      collections: ['naip'],
      intersects: { type: 'Point', coordinates: [lon, lat] },
      datetime: `${start}/${end}`,
      limit: 5,
      sortby: [{ field: 'datetime', direction: 'desc' }],
    }),
  })
  if (!res.ok) {
    throw new Error(`NAIP STAC search failed (${res.status})`)
  }
  const body = (await res.json()) as {
    features?: Array<{ id?: string; properties?: { datetime?: string } }>
  }
  const feature = body.features?.[0]
  if (!feature?.id) return null
  return {
    id: feature.id,
    datetime: feature.properties?.datetime || `${startYear}-01-01T00:00:00Z`,
  }
}

async function fetchTileJpeg(
  itemId: string,
  z: number,
  x: number,
  y: number,
): Promise<Buffer> {
  const url =
    `${PC_TILE}/${z}/${x}/${y}@1x` +
    `?collection=naip&item=${encodeURIComponent(itemId)}&assets=image`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`NAIP tile ${z}/${x}/${y} failed (${res.status})`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 100) {
    throw new Error(`NAIP tile ${z}/${x}/${y} empty/invalid`)
  }
  return buf
}

/**
 * Build a ~512² PNG chip centered on lon/lat from a 2×2 mosaic of
 * z=18 NAIP tiles (~60 cm GSD, ~250 m FOV).
 */
export async function pullNaipChip(
  lon: number,
  lat: number,
): Promise<NaipChipResult> {
  const item = await searchNaipItem(lon, lat)
  if (!item) {
    throw new Error('No NAIP scene found for this pad location')
  }

  const z = 18
  const { x: xf, y: yf } = lonLatToTileFrac(lon, lat, z)
  // Center a 2×2 block on the fractional tile position.
  const x0 = Math.floor(xf - 0.5)
  const y0 = Math.floor(yf - 0.5)

  const tiles = await Promise.all([
    fetchTileJpeg(item.id, z, x0, y0),
    fetchTileJpeg(item.id, z, x0 + 1, y0),
    fetchTileJpeg(item.id, z, x0, y0 + 1),
    fetchTileJpeg(item.id, z, x0 + 1, y0 + 1),
  ])

  const tileSize = 256
  const tileBufs = await Promise.all(
    tiles.map((t) => sharp(t).removeAlpha().toBuffer()),
  )
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

  // Crop the mosaic so the pad sits near center, then resize to 512.
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
  return {
    png,
    imageryDate,
    itemId: item.id,
    zoom: z,
    groundMApprox: 250,
  }
}

export function hiresStoragePath(
  countyId: string,
  padKey: string,
  imageryDate: string,
): string {
  const safePad = padKey.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `pad-imagery/${countyId}/${safePad}/${imageryDate}_hires.png`
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
