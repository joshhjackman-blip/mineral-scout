import { NextRequest, NextResponse } from 'next/server'
import {
  buildTitilerCropUrl,
  isAllowedSentinelCog,
  PAD_CHIP_GROUND_M,
} from '@/lib/sentinel-latest'
import { requireApiUser } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ChipCache = { expires: number; bytes: Buffer; contentType: string }
const chipCache = new Map<string, ChipCache>()
const CHIP_TTL_MS = 6 * 60 * 60 * 1000

/**
 * GET /api/pad-activity/sentinel/chip?lat=&lon=&cog=&date=
 *
 * Streams a pad-centered JPEG crop (~1.3 km) from a Sentinel-2 visual COG
 * via TiTiler. Replaces the old full-tile preview.jpg that looked like
 * abstract color bands in the desk.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiUser(request)
  if (gate.error) return gate.error

  const { searchParams } = new URL(request.url)
  const lat = Number(searchParams.get('lat'))
  const lon = Number(searchParams.get('lon'))
  const cog = (searchParams.get('cog') || '').trim()
  const date = (searchParams.get('date') || '').trim()

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { success: false, data: null, error: 'lat and lon are required' },
      { status: 400 },
    )
  }
  if (!cog || !isAllowedSentinelCog(cog)) {
    return NextResponse.json(
      { success: false, data: null, error: 'valid Sentinel COG url required' },
      { status: 400 },
    )
  }

  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)},${cog},${date},${PAD_CHIP_GROUND_M}`
  const hit = chipCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) {
    return new NextResponse(new Uint8Array(hit.bytes), {
      status: 200,
      headers: {
        'Content-Type': hit.contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Pad-Chip-Cache': 'HIT',
      },
    })
  }

  const cropUrl = buildTitilerCropUrl(cog, lat, lon)
  try {
    const upstream = await fetch(cropUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'image/jpeg,image/*,*/*',
        'User-Agent': 'mineral-map-pad-ops',
      },
    })
    if (!upstream.ok) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: `Chip crop failed (${upstream.status})`,
        },
        { status: 502 },
      )
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) {
      return NextResponse.json(
        { success: false, data: null, error: 'Chip crop returned non-JPEG' },
        { status: 502 },
      )
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg'
    chipCache.set(cacheKey, {
      expires: Date.now() + CHIP_TTL_MS,
      bytes: buf,
      contentType,
    })
    // Bound memory — drop oldest when large.
    if (chipCache.size > 200) {
      const first = chipCache.keys().next().value
      if (first) chipCache.delete(first)
    }
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Pad-Chip-Cache': 'MISS',
        'X-Pad-Chip-Date': date || '',
      },
    })
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: err instanceof Error ? err.message : 'Chip crop failed',
      },
      { status: 502 },
    )
  }
}
