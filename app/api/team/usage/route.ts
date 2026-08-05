import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { resolveTeamRole } from '@/lib/team'

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

/**
 * GET /api/team/usage
 * Team-admin dashboard metrics for the caller's own workspace only.
 */
export async function GET(_req: NextRequest) {
  const cookieStore = cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {},
      },
    },
  )

  const {
    data: { session },
  } = await supabaseAuth.auth.getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: sub } = await adminClient
    .from('subscriptions')
    .select('status, seat_count, team_owner_id')
    .eq('user_id', session.user.id)
    .maybeSingle()

  const role = resolveTeamRole({
    metadata: session.user.user_metadata as Record<string, unknown>,
    email: session.user.email,
    subscription: sub,
  })

  // Team admins only. Platform owner uses /admin for the portfolio view.
  if (role !== 'team_admin') {
    return NextResponse.json(
      { error: 'Only team admins can view this dashboard.' },
      { status: 403 },
    )
  }

  const ownerId = session.user.id
  const seatCount = Number(sub?.seat_count ?? 1)
  const { monthKey, startIso, endIso } = monthBounds()

  const { data: memberRows } = await adminClient
    .from('team_members')
    .select('invite_email, status, member_id')
    .eq('owner_id', ownerId)
    .neq('status', 'revoked')

  const members = (memberRows ?? []) as Array<{
    invite_email: string
    status: string
    member_id: string | null
  }>

  const teamUserIds = [
    ownerId,
    ...members.map((m) => m.member_id).filter((id): id is string => Boolean(id)),
  ]

  const [
    skipTraceRes,
    callsRes,
    emailsRes,
    closedDealsRes,
  ] = await Promise.all([
    adminClient
      .from('skip_trace_usage')
      .select('user_id, count')
      .eq('month', monthKey)
      .in('user_id', teamUserIds),
    adminClient
      .from('usage_events')
      .select('user_id')
      .eq('event_type', 'call_clicked')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .in('user_id', teamUserIds)
      .limit(10000),
    adminClient
      .from('email_send_log')
      .select('user_id, kind')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .in('user_id', teamUserIds)
      .limit(5000),
    adminClient
      .from('deals')
      .select('id, offer_amount, user_id')
      .eq('tag', 'closed')
      .gte('updated_at', startIso)
      .lt('updated_at', endIso)
      .in('user_id', teamUserIds),
  ])

  const warnings: string[] = []
  if (skipTraceRes.error) warnings.push(`skip_trace_usage: ${skipTraceRes.error.message}`)
  if (callsRes.error) warnings.push(`usage_events: ${callsRes.error.message}`)
  if (emailsRes.error) warnings.push(`email_send_log: ${emailsRes.error.message}`)

  let dealRows = (closedDealsRes.data ?? []) as Array<{
    offer_amount?: number | null
    user_id?: string | null
  }>
  if (closedDealsRes.error) {
    warnings.push('deals.user_id unavailable — deal attribution limited')
    dealRows = []
  }

  const skipByUser = new Map<string, number>()
  for (const row of (skipTraceRes.data ?? []) as Array<{
    user_id?: string | null
    count?: number | null
  }>) {
    const uid = String(row.user_id ?? '')
    if (!uid) continue
    skipByUser.set(uid, (skipByUser.get(uid) ?? 0) + Number(row.count ?? 0))
  }

  const callsByUser = new Map<string, number>()
  for (const row of (callsRes.data ?? []) as Array<{ user_id?: string | null }>) {
    const uid = String(row.user_id ?? '')
    if (!uid) continue
    callsByUser.set(uid, (callsByUser.get(uid) ?? 0) + 1)
  }

  const emailsByUser = new Map<string, number>()
  for (const row of (emailsRes.data ?? []) as Array<{ user_id?: string | null }>) {
    const uid = String(row.user_id ?? '')
    if (!uid) continue
    emailsByUser.set(uid, (emailsByUser.get(uid) ?? 0) + 1)
  }

  const dealsByUser = new Map<string, { count: number; volume: number }>()
  for (const row of dealRows) {
    const uid = String(row.user_id ?? '')
    if (!uid) continue
    const prev = dealsByUser.get(uid) ?? { count: 0, volume: 0 }
    prev.count += 1
    prev.volume += Number(row.offer_amount) || 0
    dealsByUser.set(uid, prev)
  }

  const memberBreakdown = [
    {
      user_id: ownerId,
      email: session.user.email ?? '',
      role: 'admin' as const,
      status: 'active',
      skip_traces: skipByUser.get(ownerId) ?? 0,
      call_clicks: callsByUser.get(ownerId) ?? 0,
      emails_sent: emailsByUser.get(ownerId) ?? 0,
      closed_deal_count: dealsByUser.get(ownerId)?.count ?? 0,
      closed_deal_volume: dealsByUser.get(ownerId)?.volume ?? 0,
    },
    ...members.map((m) => {
      const uid = m.member_id ?? ''
      return {
        user_id: uid || null,
        email: m.invite_email,
        role: 'member' as const,
        status: m.status,
        skip_traces: uid ? skipByUser.get(uid) ?? 0 : 0,
        call_clicks: uid ? callsByUser.get(uid) ?? 0 : 0,
        emails_sent: uid ? emailsByUser.get(uid) ?? 0 : 0,
        closed_deal_count: uid ? dealsByUser.get(uid)?.count ?? 0 : 0,
        closed_deal_volume: uid ? dealsByUser.get(uid)?.volume ?? 0 : 0,
      }
    }),
  ]

  const skipTraces = Array.from(skipByUser.values()).reduce((a, b) => a + b, 0)
  const callClicks = Array.from(callsByUser.values()).reduce((a, b) => a + b, 0)
  const emailsSent = Array.from(emailsByUser.values()).reduce((a, b) => a + b, 0)
  const closedDealVolume = dealRows.reduce(
    (sum, d) => sum + (Number(d.offer_amount) || 0),
    0,
  )
  const estimatedSuccessFee = Math.round(closedDealVolume * SUCCESS_FEE_RATE)

  return NextResponse.json({
    month: monthKey,
    team: {
      owner_id: ownerId,
      owner_email: session.user.email ?? '',
      seat_count: seatCount,
      seats_used: 1 + members.length,
    },
    totals: {
      call_clicks: callClicks,
      skip_traces: skipTraces,
      emails_sent: emailsSent,
      closed_deal_count: dealRows.length,
      closed_deal_volume: closedDealVolume,
      estimated_success_fee: estimatedSuccessFee,
      success_fee_rate: SUCCESS_FEE_RATE,
    },
    members: memberBreakdown,
    warnings,
  })
}
