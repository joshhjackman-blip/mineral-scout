import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isPlatformAdmin, isPlatformOwner, isSkipTraceCompedTeam } from '@/lib/team'
import { estimateMonthlySkipTraceCost, SKIP_TRACE_PRICE_USD } from '@/lib/billing'
import { deriveSkipTraceHits } from '@/lib/skip-trace-usage'

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
  user_metadata?: Record<string, unknown>
}

type TeamMemberSpend = {
  user_id: string | null
  email: string
  role: 'admin' | 'member'
  skip_traces: number
  hits: number
  misses: number
}

type TeamSpend = {
  owner_id: string
  owner_email: string
  seat_count: number
  member_count: number
  skip_traces: number
  skip_trace_hits: number
  skip_trace_misses: number
  billable_skip_traces: number
  skip_trace_amount_usd: number
  stripe_customer_id: string | null
  billing_exempt: boolean
  skip_trace_waived: boolean
  has_card: boolean
  skip_trace_past_due: boolean
  invoice_status: string | null
  hosted_invoice_url: string | null
  call_clicks: number
  emails_sent: number
  closed_deal_count: number
  closed_deal_volume: number
  estimated_success_fee: number
  wrong_numbers: number
  members: TeamMemberSpend[]
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
    reviewsRes,
    wrongCallsRes,
    missReviewsRes,
    teamMembersRes,
  ] = await Promise.all([
    adminClient
      .from('skip_trace_usage')
      .select('user_id, count, billable_count, hit_count, team_owner_id')
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
      .select('user_id, team_owner_id, seat_count, status, stripe_customer_id, stripe_subscription_id, has_card, skip_trace_past_due'),
    adminClient
      .from('subscriptions')
      .select('user_id, seat_count, status, stripe_customer_id, stripe_subscription_id, has_card, skip_trace_past_due')
      .is('team_owner_id', null)
      .gte('seat_count', 1),
    adminClient
      .from('skip_trace_reviews')
      .select('team_owner_id, reason, status')
      .eq('status', 'open')
      .limit(5000),
    adminClient
      .from('deal_phone_calls')
      .select('team_owner_id')
      .eq('outcome', 'wrong_number')
      .gte('called_at', startIso)
      .lt('called_at', endIso)
      .limit(10000),
    adminClient
      .from('skip_trace_reviews')
      .select('requested_by, requested_by_email, team_owner_id, reason')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .limit(10000),
    adminClient
      .from('team_members')
      .select('owner_id, invite_email, status, member_id')
      .neq('status', 'revoked'),
  ])

  const warnings: string[] = []
  let skipRows = (skipTraceRes.data ?? []) as Array<{
    user_id?: string | null
    count?: number | null
    billable_count?: number | null
    hit_count?: number | null
    team_owner_id?: string | null
  }>
  if (skipTraceRes.error) {
    warnings.push(`skip_trace_usage: ${skipTraceRes.error.message}`)
    const withBillable = await adminClient
      .from('skip_trace_usage')
      .select('user_id, count, billable_count, team_owner_id')
      .eq('month', monthKey)
    if (!withBillable.error) {
      skipRows = (withBillable.data ?? []) as typeof skipRows
    } else {
      const fallback = await adminClient
        .from('skip_trace_usage')
        .select('user_id, count, team_owner_id')
        .eq('month', monthKey)
      if (!fallback.error) {
        skipRows = (fallback.data ?? []) as typeof skipRows
      }
    }
  }
  if (callsRes.error) warnings.push(`usage_events: ${callsRes.error.message}`)
  if (emailsRes.error) warnings.push(`email_send_log: ${emailsRes.error.message}`)
  if (reviewsRes.error) warnings.push(`skip_trace_reviews: ${reviewsRes.error.message}`)
  if (wrongCallsRes.error) warnings.push(`deal_phone_calls: ${wrongCallsRes.error.message}`)
  if (missReviewsRes.error) warnings.push(`skip_trace_reviews (month): ${missReviewsRes.error.message}`)
  if (teamMembersRes.error) warnings.push(`team_members: ${teamMembersRes.error.message}`)
  if (agreementsRes.error) {
    warnings.push(`platform_agreement_signatures: ${agreementsRes.error.message}`)
  }
  if (subsRes.error) {
    warnings.push(`subscriptions: ${subsRes.error.message}`)
    const fallbackSubs = await adminClient
      .from('subscriptions')
      .select('user_id, team_owner_id, seat_count, status, stripe_customer_id')
    if (!fallbackSubs.error) {
      ;(subsRes as { data: unknown }).data = fallbackSubs.data
    }
  }
  if (ownerSubsRes.error) {
    warnings.push(`owner subscriptions: ${ownerSubsRes.error.message}`)
    const fallbackOwners = await adminClient
      .from('subscriptions')
      .select('user_id, seat_count, status, stripe_customer_id')
      .is('team_owner_id', null)
      .gte('seat_count', 1)
    if (!fallbackOwners.error) {
      ;(ownerSubsRes as { data: unknown }).data = fallbackOwners.data
    }
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

  const skipTracesThisMonth = skipRows.reduce(
    (sum, row) => sum + Number(row.count ?? 0),
    0,
  )
  const billableSkipTracesThisMonth = skipRows.reduce(
    (sum, row) => sum + Number(row.billable_count ?? 0),
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
  const metaById = new Map(
    users.map((u) => [u.id, (u as { user_metadata?: Record<string, unknown> }).user_metadata ?? {}]),
  )

  const subsByUser = new Map<
    string,
    {
      team_owner_id: string | null
      stripe_customer_id: string | null
      has_card: boolean
      skip_trace_past_due: boolean
    }
  >()
  for (const row of (subsRes.data ?? []) as Array<{
    user_id: string
    team_owner_id: string | null
      stripe_customer_id?: string | null
      stripe_subscription_id?: string | null
      has_card?: boolean | null
      skip_trace_past_due?: boolean | null
  }>) {
    subsByUser.set(row.user_id, {
      team_owner_id: row.team_owner_id,
      stripe_customer_id: row.stripe_customer_id ?? null,
      has_card:
        Boolean(row.has_card) || Boolean(String(row.stripe_subscription_id ?? '').trim()),
      skip_trace_past_due: Boolean(row.skip_trace_past_due),
    })
  }

  const emptyTeam = (ownerId: string, email: string, seatCount: number): TeamSpend => ({
    owner_id: ownerId,
    owner_email: email,
    seat_count: seatCount,
    member_count: 0,
    skip_traces: 0,
    skip_trace_hits: 0,
    skip_trace_misses: 0,
    billable_skip_traces: 0,
    skip_trace_amount_usd: 0,
    stripe_customer_id: subsByUser.get(ownerId)?.stripe_customer_id ?? null,
    billing_exempt: false,
    skip_trace_waived: isSkipTraceCompedTeam(email),
    has_card: subsByUser.get(ownerId)?.has_card ?? false,
    skip_trace_past_due: subsByUser.get(ownerId)?.skip_trace_past_due ?? false,
    invoice_status: null,
    hosted_invoice_url: null,
    call_clicks: 0,
    emails_sent: 0,
    closed_deal_count: 0,
    closed_deal_volume: 0,
    estimated_success_fee: 0,
    wrong_numbers: 0,
    members: [],
  })

  const teamMap = new Map<string, TeamSpend>()

  for (const row of (ownerSubsRes.data ?? []) as Array<{
    user_id: string
    seat_count: number | null
    stripe_customer_id?: string | null
    has_card?: boolean | null
    skip_trace_past_due?: boolean | null
    stripe_subscription_id?: string | null
  }>) {
    const team = emptyTeam(
      row.user_id,
      emailById.get(row.user_id) || '(unknown)',
      Number(row.seat_count ?? 1),
    )
    team.stripe_customer_id = row.stripe_customer_id ?? team.stripe_customer_id
    if (row.has_card != null || row.stripe_subscription_id) {
      team.has_card =
        Boolean(row.has_card) || Boolean(String(row.stripe_subscription_id ?? '').trim())
    }
    if (row.skip_trace_past_due != null) team.skip_trace_past_due = Boolean(row.skip_trace_past_due)
    teamMap.set(row.user_id, team)
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
      team = emptyTeam(ownerId, emailById.get(ownerId) || '(unprovisioned)', 1)
      teamMap.set(ownerId, team)
    }
    return team
  }

  const skipByUser = new Map<
    string,
    { ownerId: string; count: number; billable: number; storedHits: number }
  >()
  for (const row of skipRows) {
    const uid = String(row.user_id ?? '').trim()
    if (!uid) continue
    const ownerId = String(row.team_owner_id ?? '').trim() || teamKeyForUser(uid, subsByUser)
    const team = ensureTeam(ownerId)
    const count = Number(row.count ?? 0)
    const billable = Number(row.billable_count ?? 0)
    const storedHits = Number(row.hit_count ?? 0)
    team.skip_traces += count
    team.billable_skip_traces += billable
    team.skip_trace_amount_usd = estimateMonthlySkipTraceCost(team.billable_skip_traces)
    const prev = skipByUser.get(uid) ?? { ownerId, count: 0, billable: 0, storedHits: 0 }
    prev.count += count
    prev.billable += billable
    prev.storedHits += storedHits
    skipByUser.set(uid, prev)
  }

  const missByUser = new Map<string, number>()
  for (const row of (missReviewsRes.data ?? []) as Array<{
    requested_by?: string | null
    reason?: string | null
  }>) {
    if (row.reason === 'wrong_number') continue
    const uid = String(row.requested_by ?? '').trim()
    if (!uid) continue
    missByUser.set(uid, (missByUser.get(uid) ?? 0) + 1)
  }

  const rosterByOwner = new Map<string, Array<{ userId: string | null; email: string }>>()
  const pushRoster = (ownerId: string, userId: string | null, email: string) => {
    const list = rosterByOwner.get(ownerId) ?? []
    const key = (userId || email).toLowerCase()
    if (list.some((m) => (m.userId || m.email).toLowerCase() === key)) {
      rosterByOwner.set(ownerId, list)
      return
    }
    list.push({ userId, email })
    rosterByOwner.set(ownerId, list)
  }
  for (const [ownerId, team] of Array.from(teamMap.entries())) {
    pushRoster(ownerId, ownerId, team.owner_email)
  }
  for (const row of (teamMembersRes.data ?? []) as Array<{
    owner_id?: string | null
    member_id?: string | null
    invite_email?: string | null
  }>) {
    const ownerId = String(row.owner_id ?? '').trim()
    if (!ownerId) continue
    ensureTeam(ownerId)
    const memberId = String(row.member_id ?? '').trim() || null
    const email =
      (memberId ? emailById.get(memberId) : null) ||
      String(row.invite_email ?? '').trim() ||
      '(member)'
    pushRoster(ownerId, memberId, email)
  }
  for (const [uid, stats] of Array.from(skipByUser.entries())) {
    pushRoster(stats.ownerId, uid, emailById.get(uid) || '(unknown)')
  }

  for (const [ownerId, roster] of Array.from(rosterByOwner.entries())) {
    const team = teamMap.get(ownerId)
    if (!team) continue
    const members: TeamMemberSpend[] = roster.map((person) => {
      const uid = person.userId ?? ''
      const stats = uid ? skipByUser.get(uid) : undefined
      const outcome = deriveSkipTraceHits(
        stats?.count ?? 0,
        stats?.storedHits ?? 0,
        uid ? missByUser.get(uid) ?? 0 : 0,
      )
      return {
        user_id: person.userId,
        email: person.email,
        role: person.userId === ownerId ? 'admin' : 'member',
        skip_traces: stats?.count ?? 0,
        hits: outcome.hits,
        misses: outcome.misses,
      }
    })
    members.sort(
      (a, b) =>
        b.skip_traces - a.skip_traces ||
        a.email.localeCompare(b.email),
    )
    team.members = members
    team.skip_trace_hits = members.reduce((sum, m) => sum + m.hits, 0)
    team.skip_trace_misses = members.reduce((sum, m) => sum + m.misses, 0)
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

  const { data: invoiceRows, error: invoiceError } = await adminClient
    .from('skip_trace_invoices')
    .select('team_owner_id, status, hosted_invoice_url')
    .eq('month', monthKey)
  if (invoiceError && !String(invoiceError.message).includes('does not exist')) {
    warnings.push(`skip_trace_invoices: ${invoiceError.message}`)
  }
  for (const row of (invoiceRows ?? []) as Array<{
    team_owner_id?: string | null
    status?: string | null
    hosted_invoice_url?: string | null
  }>) {
    const ownerId = String(row.team_owner_id ?? '').trim()
    if (!ownerId) continue
    const team = teamMap.get(ownerId)
    if (!team) continue
    team.invoice_status = row.status ?? null
    team.hosted_invoice_url = row.hosted_invoice_url ?? null
  }

  for (const team of Array.from(teamMap.values())) {
    if (isSkipTraceCompedTeam(team.owner_email)) {
      team.skip_trace_waived = true
      team.billable_skip_traces = 0
      team.skip_trace_amount_usd = 0
    }
  }

  let openWrongNumbers = 0
  for (const row of (reviewsRes.data ?? []) as Array<{
    team_owner_id?: string | null
    reason?: string | null
    status?: string | null
  }>) {
    if (row.status && row.status !== 'open') continue
    if (row.reason && row.reason !== 'wrong_number') continue
    openWrongNumbers += 1
    const ownerId = String(row.team_owner_id ?? '').trim()
    if (ownerId) ensureTeam(ownerId).wrong_numbers += 1
  }

  const teams = Array.from(teamMap.values()).sort(
    (a, b) => b.call_clicks - a.call_clicks || b.skip_traces - a.skip_traces,
  )
  const billableDue = teams.reduce((sum, t) => sum + t.billable_skip_traces, 0)
  const skipTraceHits = teams.reduce((sum, t) => sum + t.skip_trace_hits, 0)
  const skipTraceMisses = teams.reduce((sum, t) => sum + t.skip_trace_misses, 0)
  const wrongNumbersThisMonth = (wrongCallsRes.data ?? []).length

  return NextResponse.json({
    month: monthKey,
    callVolume: {
      callClicks: callClicksThisMonth,
      skipTraces: skipTracesThisMonth,
      skipTraceHits,
      skipTraceMisses,
      billableSkipTraces: billableDue,
      primary: callClicksThisMonth,
    },
    skipTraceBilling: {
      billableCount: billableDue,
      amountUsd: estimateMonthlySkipTraceCost(billableDue),
      unitPriceUsd: SKIP_TRACE_PRICE_USD,
    },
    wrongNumbers: {
      open: openWrongNumbers,
      thisMonth: wrongNumbersThisMonth,
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
