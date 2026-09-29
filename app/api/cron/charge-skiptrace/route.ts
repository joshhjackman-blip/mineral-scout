import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireCronSecret } from '@/lib/api-auth'
import { previousBillingMonthKey } from '@/lib/billing'
import { stripeBillingConfigured } from '@/lib/skip-trace-gate'
import {
  chargeTeamSkipTraceMonth,
  listTeamsWithBillableUsage,
} from '@/lib/skip-trace-charge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 1st-of-month cron: charge each team's card for the previous calendar
 * month's skip-trace phone hits. Idempotent — already-paid invoices skip.
 */
async function run(request: Request) {
  const cronGate = requireCronSecret(request)
  if (cronGate) return cronGate

  if (!stripeBillingConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'STRIPE_SECRET_KEY not configured' },
      { status: 500 },
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ ok: false, error: 'supabase env missing' }, { status: 500 })
  }

  const url = new URL(request.url)
  const month =
    url.searchParams.get('month')?.trim() || previousBillingMonthKey()
  const admin = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const start = Date.now()
  const teamIds = await listTeamsWithBillableUsage(admin, month)
  const results: Array<{
    teamOwnerId: string
    status: string
    amountUsd?: number
    skipped?: boolean
    error?: string
  }> = []

  for (const teamOwnerId of teamIds) {
    try {
      const charged = await chargeTeamSkipTraceMonth(admin, {
        teamOwnerId,
        month,
      })
      results.push({
        teamOwnerId,
        status: charged.status,
        amountUsd: charged.amountUsd,
        skipped: charged.skipped,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('charge-skiptrace team failed:', teamOwnerId, message)
      results.push({ teamOwnerId, status: 'failed', error: message })
    }
  }

  const paid = results.filter((r) => r.status === 'paid' && !r.skipped).length
  const failed = results.filter((r) => r.status === 'failed' || r.error).length
  const skipped = results.filter((r) => r.skipped).length

  return NextResponse.json({
    ok: failed === 0,
    month,
    elapsedMs: Date.now() - start,
    teams: teamIds.length,
    paid,
    failed,
    skipped,
    results,
  })
}

export async function GET(request: Request) {
  return run(request)
}

export async function POST(request: Request) {
  return run(request)
}
