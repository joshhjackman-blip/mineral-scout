import { NextRequest, NextResponse } from 'next/server'
import { fetchLatestSentinel } from '@/lib/sentinel-latest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function proxiedUrl(request: NextRequest, remoteUrl: string): string {
  const proxy = new URL('/api/pad-activity/sentinel/proxy', request.nextUrl.origin)
  proxy.searchParams.set('url', remoteUrl)
  return proxy.toString()
}

/**
 * GET /api/pad-activity/sentinel?lat=32.31&lon=-101.51
 *
 * Returns the most recent low-cloud Sentinel-2 preview for a pad point.
 * Used when RRC events have no before/after storage paths yet.
 * Image URL is same-origin proxied so the browser always gets a chip.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const lat = Number(searchParams.get('lat'))
  const lon = Number(searchParams.get('lon'))

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { success: false, data: null, error: 'lat and lon are required' },
      { status: 400 },
    )
  }

  try {
    const chip = await fetchLatestSentinel(lat, lon)
    if (!chip) {
      return NextResponse.json({
        success: true,
        data: null,
        error: 'No recent Sentinel-2 scene found for this point',
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
        error: err instanceof Error ? err.message : 'Sentinel lookup failed',
      },
      { status: 502 },
    )
  }
}
