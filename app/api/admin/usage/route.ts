import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isPlatformAdmin, isPlatformOwner } from '@/lib/team'

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

type AuthUser = {
  id: string
  email?: string | null
}

type TeamSpend = {
  owner_id: string
  owner_email: string
  seat_count: number
  member_count: number
  skip_traces: number
  call_clicks: number
  emails_sent: number
  closed_deal_count: number
  closed_deal_volume: number
  estimated_success_fee: number
}

async function listAllUsers(adminClient: SupabaseClient): Promise<AuthUser[]> {
  const users: AuthUser[] = []
  let page = 1
  const perPage = 1000
  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const batch = (data?.users ?? []) as AuthUser[]
    users.push(...batch)
    if (batch.length < perPage) break
    page += 1
  }
  return users
}

/** Resolve which team workspace a user belongs to (owner id). */
function teamKeyForUser(
  userId: string,
  subsByUser: Map<string, { team_owner_id: string | null }>,
): string {
  const sub = subsByUser.get(userId)
  const owner = String(sub?.team_owner_id ?? '').trim()
  return owner || userId
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

  if (
    !session?.user ||
    !isPlatformAdmin(
      session.user.user_metadata as Record<string, unknown>,
      session.user.email,
    )
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Keep allowlisted owner/admin metadata in sync so JWT clients stay consistent.
  if (!session.user.user_metadata?.is_admin) {
    try {
      await adminClient.auth.admin.updateUserById(session.user.id, {
        user_metadata: {
          ...(session.user.user_metadata ?? {}),
          is_admin: true,
          team_role: isPlatformOwner(session.user.email)
            ? 'platform_owner'
            : 'platform_admin',
        },
      })
    } catch {
      // Non-fatal — allowlist still grants access.
    }
  }

  const { monthKey, startIso, endIso } = monthBounds()

  const [
    skipTraceRes,
    callsRes,
    emailsRes,
    closedDealsRes,
    agreementsRes,
    subsRes,
    ownerSubsRes,
  ] = await Promise.all([
    adminClient
      .from('skip_trace_usage')
      .select('user_id, count')
      .eq('month', monthKey),
    adminClient
      .from('usage_events')
      .select('user_id')
      .eq('event_type', 'call_clicked')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .limit(20000),
    adminClient
      .from('email_send_log')
      .select('kind, user_id')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .limit(10000),
    adminClient
      .from('deals')
      .select('id, offer_amount, tag, updated_at, user_id')
      .eq('tag', 'closed')
      .gte('updated_at', startIso)
      .lt('updated_at', endIso),
    adminClient
      .from('platform_agreement_signatures')
      .select('id', { count: 'exact', head: true })
      .gte('signed_at', startIso)
      .lt('signed_at', endIso),
    adminClient
      .from('subscriptions')
      .select('user_id, team_owner_id, seat_count, status'),
    adminClient
      .from('subscriptions')
      .select('user_id, seat_count, status')
      .is('team_owner_id', null)
      .gte('seat_count', 1),
  ])

  const warnings: string[] = []
  if (skipTraceRes.error) warnings.push(`skip_trace_usage: ${skipTraceRes.error.message}`)
  if (callsRes.error) warnings.push(`usage_events: ${callsRes.error.message}`)
  if (emailsRes.error) warnings.push(`email_send_log: ${emailsRes.error.message}`)
  if (agreementsRes.error) {
    warnings.push(`platform_agreement_signatures: ${agreementsRes.error.message}`)
  }

  let dealRows: Array<{ offer_amount?: number | null; user_id?: string | null }> =
    (closedDealsRes.data ?? []) as Array<{
      offer_amount?: number | null
      user_id?: string | null
    }>

  if (closedDealsRes.error) {
    const retry = await adminClient
      .from('deals')
      .select('id, offer_amount, tag, updated_at')
      .eq('tag', 'closed')
      .gte('updated_at', startIso)
      .lt('updated_at', endIso)
    if (retry.error) {
      warnings.push(`deals: ${closedDealsRes.error.message}`)
      dealRows = []
    } else {
      warnings.push('deals.user_id unavailable — team spend attribution limited')
      dealRows = (retry.data ?? []) as Array<{ offer_amount?: number | null }>
    }
  }

  const skipTracesThisMonth = (skipTraceRes.data ?? []).reduce(
    (sum, row) => sum + Number((row as { count?: number | null }).count ?? 0),
    0,
  )
  const callRows = (callsRes.data ?? []) as Array<{ user_id?: string | null }>
  const callClicksThisMonth = callRows.length

  const emailsByKind: Record<string, number> = {}
  for (const row of (emailsRes.data ?? []) as Array<{ kind?: string }>) {
    const kind = row.kind || 'other'
    emailsByKind[kind] = (emailsByKind[kind] ?? 0) + 1
  }
  const emailsSentThisMonth = Object.values(emailsByKind).reduce((a, b) => a + b, 0)

  const closedDealVolume = dealRows.reduce(
    (sum, d) => sum + (Number(d.offer_amount) || 0),
    0,
  )
  const estimatedSuccessFee = Math.round(closedDealVolume * SUCCESS_FEE_RATE)
  const closedDealCount = dealRows.length
  const agreementsSignedThisMonth = agreementsRes.count ?? 0

  // ── Per-team spending breakdown ──────────────────────────────────────────
  const users = await listAllUsers(adminClient)
  const emailById = new Map(users.map((u) => [u.id, u.email ?? '']))

  const subsByUser = new Map<string, { team_owner_id: string | null }>()
  for (const row of (subsRes.data ?? []) as Array<{
    user_id: string
    team_owner_id: string | null
  }>) {
    subsByUser.set(row.user_id, { team_owner_id: row.team_owner_id })
  }

  const teamMap = new Map<string, TeamSpend>()

  for (const row of (ownerSubsRes.data ?? []) as Array<{
    user_id: string
    seat_count: number | null
  }>) {
    teamMap.set(row.user_id, {
      owner_id: row.user_id,
      owner_email: emailById.get(row.user_id) || '(unknown)',
      seat_count: Number(row.seat_count ?? 1),
      member_count: 0,
      skip_traces: 0,
      call_clicks: 0,
      emails_sent: 0,
      closed_deal_count: 0,
      closed_deal_volume: 0,
      estimated_success_fee: 0,
    })
  }

  Array.from(subsByUser.entries()).forEach(([userId, sub]) => {
    const ownerId = String(sub.team_owner_id ?? '').trim()
    if (!ownerId) return
    const team = teamMap.get(ownerId)
    if (team && userId !== ownerId) team.member_count += 1
  })

  const ensureTeam = (ownerId: string) => {
    let team = teamMap.get(ownerId)
    if (!team) {
      team = {
        owner_id: ownerId,
        owner_email: emailById.get(ownerId) || '(unprovisioned)',
        seat_count: 1,
        member_count: 0,
        skip_traces: 0,
        call_clicks: 0,
        emails_sent: 0,
        closed_deal_count: 0,
        closed_deal_volume: 0,
        estimated_success_fee: 0,
      }
      teamMap.set(ownerId, team)
    }
    return team
  }

  for (const row of (skipTraceRes.data ?? []) as Array<{
    user_id?: string | null
    count?: number | null
  }>) {
    const uid = String(row.user_id ?? '').trim()
    if (!uid) continue
    ensureTeam(teamKeyForUser(uid, subsByUser)).skip_traces += Number(row.count ?? 0)
  }

  for (const row of callRows) {
    const uid = String(row.user_id ?? '').trim()
    if (!uid) continue
    ensureTeam(teamKeyForUser(uid, subsByUser)).call_clicks += 1
  }

  for (const row of (emailsRes.data ?? []) as Array<{ user_id?: string | null }>) {
    const uid = String(row.user_id ?? '').trim()
    if (!uid) continue
    ensureTeam(teamKeyForUser(uid, subsByUser)).emails_sent += 1
  }

  for (const row of dealRows) {
    const uid = String(row.user_id ?? '').trim()
    if (!uid) continue
    const team = ensureTeam(teamKeyForUser(uid, subsByUser))
    const amount = Number(row.offer_amount) || 0
    team.closed_deal_count += 1
    team.closed_deal_volume += amount
    team.estimated_success_fee = Math.round(team.closed_deal_volume * SUCCESS_FEE_RATE)
  }

  const teams = Array.from(teamMap.values()).sort(
    (a, b) => b.estimated_success_fee - a.estimated_success_fee,
  )

  return NextResponse.json({
    month: monthKey,
    callVolume: {
      callClicks: callClicksThisMonth,
      skipTraces: skipTracesThisMonth,
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
    teams,
    warnings,
  })
}
