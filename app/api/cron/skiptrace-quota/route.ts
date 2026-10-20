import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireCronSecret } from '@/lib/api-auth'
import { processQuotaBurnTick } from '@/lib/skip-trace-quota'

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

  const admin = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const start = Date.now()
  try {
    const result = await processQuotaBurnTick(admin)
    const processed = result.jobs.reduce((sum, job) => sum + job.processed, 0)
    const hits = result.jobs.reduce((sum, job) => sum + job.hits, 0)
    const misses = result.jobs.reduce((sum, job) => sum + job.misses, 0)
    const skipped = result.jobs.reduce((sum, job) => sum + job.skipped, 0)
    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - start,
      ran: result.ran,
      processed,
      hits,
      misses,
      skipped,
      jobs: result.jobs,
    })
  } catch (err) {
    console.error('Skip-trace quota cron failed:', err)
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
