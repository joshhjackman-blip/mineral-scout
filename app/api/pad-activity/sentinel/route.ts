import { NextRequest, NextResponse } from 'next/server'
import { fetchLatestPadImagery } from '@/lib/pad-imagery'
import { skyfiApiKey } from '@/lib/skyfi-latest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function proxiedUrl(request: NextRequest, remoteUrl: string): string {
  // Only proxy public Sentinel COG thumbs; SkyFi URLs are already CDN-ready.
  try {
    const host = new URL(remoteUrl).hostname
    if (
      host === 'sentinel-cogs.s3.us-west-2.amazonaws.com' ||
      host === 'sentinel-cogs.s3.amazonaws.com'
    ) {
      const proxy = new URL('/api/pad-activity/sentinel/proxy', request.nextUrl.origin)
      proxy.searchParams.set('url', remoteUrl)
      return proxy.toString()
    }
  } catch {
    // fall through
  }
  return remoteUrl
}

/**
 * GET /api/pad-activity/sentinel?lat=32.31&lon=-101.51
 *
 * Latest pad preview for brokers:
 *  1. SkyFi archive thumbnail when SKYFI_API_KEY is set (no paid order)
 *  2. Else free Sentinel-2 preview via Element84 Earth Search
 *
 * Sentinel image URLs are same-origin proxied so the browser always gets a chip.
 * Paywall: not enforced yet. Set SKYFI_PAYWALL_ENABLED=true later and
 * implement credit/seat checks in skyfiAccessAllowed().
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const lat = Number(searchParams.get('lat'))
  const lon = Number(searchParams.get('lon'))
  const prefer = (searchParams.get('prefer') || '').trim().toLowerCase()

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { success: false, data: null, error: 'lat and lon are required' },
      { status: 400 },
    )
  }

  try {
    // Optional force: prefer=sentinel skips SkyFi (useful for A/B while testing).
    let chip = null
    if (prefer === 'sentinel') {
      const { fetchLatestSentinel } = await import('@/lib/sentinel-latest')
      const sentinel = await fetchLatestSentinel(lat, lon)
      chip = sentinel
        ? {
            url: sentinel.url,
            date: sentinel.date,
            cloudCover: sentinel.cloudCover,
            sceneId: sentinel.sceneId,
            source: 'sentinel-2' as const,
          }
        : null
    } else {
      chip = await fetchLatestPadImagery(lat, lon)
    }

    if (!chip) {
      return NextResponse.json({
        success: true,
        data: null,
        error: skyfiApiKey()
          ? 'No recent SkyFi or Sentinel scene found for this point'
          : 'No recent Sentinel-2 scene found (set SKYFI_API_KEY for hi-res)',
      })
    }
    return NextResponse.json({
      success: true,
      data: {
        ...chip,
        url: proxiedUrl(request, chip.url),
        remoteUrl: chip.url,
      },
      error: null,
    })
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: err instanceof Error ? err.message : 'Imagery lookup failed',
      },
      { status: 502 },
    )
  }
}
