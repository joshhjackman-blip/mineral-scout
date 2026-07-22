import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'Raw-Data'

function normalizePath(raw: string | null): string | null {
  if (!raw) return null
  const path = raw.replace(/^\/+/, '').trim()
  if (!path || path.includes('..')) return null
  // Only pad chips — never expose arbitrary bucket objects via this route.
  if (!/^pad-imagery\/[A-Za-z0-9._\-\/]+$/.test(path)) return null
  if (!/\.(png|jpe?g|webp)$/i.test(path)) return null
  return path
}

/**
 * GET /api/pad-activity/image?path=pad-imagery/howard/…/2026-07-10.png
 *
 * Streams chip PNGs through the app so the UI never depends on Supabase
 * signed-URL JWTs (Next fetch cache was serving already-expired tokens).
 */
export async function GET(request: NextRequest) {
  const path = normalizePath(request.nextUrl.searchParams.get('path'))
  if (!path) {
    return NextResponse.json(
      { success: false, data: null, error: 'invalid path' },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()
  if (!supabase) {
    return NextResponse.json(
      { success: false, data: null, error: 'supabase env missing' },
      { status: 500 },
    )
  }

  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: error?.message || 'object missing in Storage',
      },
      { status: 404 },
    )
  }

  const bytes = new Uint8Array(await data.arrayBuffer())
  const lower = path.toLowerCase()
  const contentType = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
    ? 'image/jpeg'
    : lower.endsWith('.webp')
      ? 'image/webp'
      : 'image/png'

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, max-age=300, stale-while-revalidate=600',
    },
  })
}
