import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireCronSecret } from '@/lib/api-auth'
import { researchOpenSkipTraceReviews } from '@/lib/skip-trace-research'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function run(request: Request) {
  const cronGate = requireCronSecret(request)
  if (cronGate) return cronGate

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ ok: false, error: 'supabase env missing' }, { status: 500 })
  }

  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get('limit') || '6')
  const limit = Number.isFinite(limitParam) ? limitParam : 6
  const ownerName = url.searchParams.get('owner') || url.searchParams.get('ownerName')

  const admin = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const start = Date.now()
  try {
    const { processed, results } = await researchOpenSkipTraceReviews(admin, {
      limit,
      ownerName,
    })
    const hits = results.filter((r) => r.status === 'hit' || r.status === 'cached').length
    const misses = results.filter((r) => r.status === 'miss').length
    const skipped = results.filter((r) => r.status === 'skipped').length
    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - start,
      processed,
      hits,
      misses,
      skipped,
      results,
    })
  } catch (err) {
    console.error('Skip-trace research cron failed:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  return run(request)
}

export async function POST(request: Request) {
  return run(request)
}
