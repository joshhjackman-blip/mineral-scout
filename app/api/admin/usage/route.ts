import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const SUCCESS_FEE_RATE = 0.1

function monthBounds(d = new Date()) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  return {
    monthKey: d.toISOString().slice(0, 7),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll().map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
          }))
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value)
            res.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.user?.user_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { monthKey, startIso, endIso } = monthBounds()

  const [
    skipTraceRes,
    callsRes,
    emailsRes,
    closedDealsRes,
    agreementsRes,
  ] = await Promise.all([
    adminClient
      .from('skip_trace_usage')
      .select('user_id, count')
      .eq('month', monthKey),
    adminClient
      .from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'call_clicked')
      .gte('created_at', startIso)
      .lt('created_at', endIso),
    adminClient
      .from('email_send_log')
      .select('kind')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .limit(10000),
    adminClient
      .from('deals')
      .select('id, offer_amount, tag, updated_at')
      .eq('tag', 'closed')
      .gte('updated_at', startIso)
      .lt('updated_at', endIso),
    adminClient
      .from('platform_agreement_signatures')
      .select('id', { count: 'exact', head: true })
      .gte('signed_at', startIso)
      .lt('signed_at', endIso),
  ])

  const skipTracesThisMonth = (skipTraceRes.data ?? []).reduce(
    (sum, row) => sum + Number((row as { count?: number | null }).count ?? 0),
    0,
  )
  const callClicksThisMonth = callsRes.count ?? 0

  const emailsByKind: Record<string, number> = {}
  for (const row of (emailsRes.data ?? []) as Array<{ kind?: string }>) {
    const kind = row.kind || 'other'
    emailsByKind[kind] = (emailsByKind[kind] ?? 0) + 1
  }
  const emailsSentThisMonth = Object.values(emailsByKind).reduce((a, b) => a + b, 0)

  const closedDeals = (closedDealsRes.data ?? []) as Array<{
    offer_amount?: number | null
  }>
  const closedDealVolume = closedDeals.reduce(
    (sum, d) => sum + (Number(d.offer_amount) || 0),
    0,
  )
  const estimatedSuccessFee = Math.round(closedDealVolume * SUCCESS_FEE_RATE)
  const closedDealCount = closedDeals.length
  const agreementsSignedThisMonth = agreementsRes.count ?? 0

  // Soft-fail individual missing tables so a fresh env still loads.
  const warnings: string[] = []
  if (skipTraceRes.error) warnings.push(`skip_trace_usage: ${skipTraceRes.error.message}`)
  if (callsRes.error) warnings.push(`usage_events: ${callsRes.error.message}`)
  if (emailsRes.error) warnings.push(`email_send_log: ${emailsRes.error.message}`)
  if (closedDealsRes.error) warnings.push(`deals: ${closedDealsRes.error.message}`)
  if (agreementsRes.error) {
    warnings.push(`platform_agreement_signatures: ${agreementsRes.error.message}`)
  }

  return NextResponse.json({
    month: monthKey,
    callVolume: {
      callClicks: callClicksThisMonth,
      skipTraces: skipTracesThisMonth,
      // Primary dial proxy until a real dialer exists.
      primary: callClicksThisMonth,
    },
    monthlyDollars: {
      closedDealCount,
      closedDealVolume,
      estimatedSuccessFee,
      successFeeRate: SUCCESS_FEE_RATE,
      agreementsSigned: agreementsSignedThisMonth,
    },
    email: {
      sent: emailsSentThisMonth,
      byKind: emailsByKind,
    },
    warnings,
  })
}
