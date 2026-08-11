import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_HOSTS = new Set([
  'sentinel-cogs.s3.us-west-2.amazonaws.com',
  'sentinel-cogs.s3.amazonaws.com',
  'earth-search.aws.element84.com',
])

/**
 * Same-origin proxy for Sentinel preview JPEGs.
 * Avoids browser hotlink / CSP surprises when rendering Element84 S3 thumbs.
 *
 * GET /api/pad-activity/sentinel/proxy?url=<encoded https url>
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiUser(request)
  if (gate.error) return gate.error

  const raw = request.nextUrl.searchParams.get('url') || ''
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: 'Invalid url' },
      { status: 400 },
    )
  }

  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return NextResponse.json(
      { success: false, data: null, error: 'Host not allowed' },
      { status: 400 },
    )
  }

  try {
    const upstream = await fetch(target.toString(), {
      cache: 'force-cache',
      headers: { Accept: 'image/*,*/*' },
    })
    if (!upstream.ok) {
      return NextResponse.json(
        { success: false, data: null, error: `Upstream ${upstream.status}` },
        { status: 502 },
      )
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    const contentType = upstream.headers.get('content-type') || 'image/jpeg'
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    })
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: err instanceof Error ? err.message : 'Proxy failed',
      },
      { status: 502 },
    )
  }
}
