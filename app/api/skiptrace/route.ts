import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { getTeamOwnerId } from '@/lib/team'
import { skipTraceOwnerKey } from '@/lib/workspace'
import { SKIP_TRACE_PRICE_USD, isSkipTraceBillable } from '@/lib/billing'
import { isSkipTraceWaivedFor } from '@/lib/access'
import { ensureGreatPlainsMembership } from '@/lib/team-attach'
import {
  skipTracePaymentGate,
  stripeBillingConfigured,
} from '@/lib/skip-trace-gate'
import { readTeamCardStatus } from '@/lib/stripe-card'
import {
  hasSignedCurrentAgreement,
  isAgreementGateEnabled,
} from '@/lib/agreement'
import { queueSkipTraceReview } from '@/lib/skip-trace-review'
import {
  incrementSkipTraceUsage,
  readSkipTraceUsage,
} from '@/lib/skip-trace-usage'
import { enrichPersonTraceArgs } from '@/lib/skip-trace-name'
import {
  classifyOwner,
  runSkipTraceChain,
  skipTraceProvidersConfigured,
} from '@/lib/skip-trace-providers'

// undici ProxyAgent only works on the Node runtime. Edge `fetch` also
// strips `dispatcher`, so idiCORE would egress from a rotating Vercel IP
// and never reach the allow-listed search endpoint.
export const runtime = 'nodejs'

// Skip trace usage is still tracked in the skip_trace_usage table
// for internal accounting / abuse detection, but there is no monthly
// cap enforced on end users. Setting the limit to Number.MAX_SAFE_INTEGER
// keeps the response shape backwards-compatible with the older UI
// (`limit: N`) so nothing downstream has to change.
const MONTHLY_LIMIT = Number.MAX_SAFE_INTEGER

export async function POST(req: NextRequest) {
  const {
    firstName,
    lastName,
    address,
    city,
    state,
    zip,
    ownerName,
    county,
    tractAbstract,
    dealId,
  } = await req.json()

  const res = NextResponse.next()
  const supabaseAuth = createServerClient(
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
    }
  )
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = user.id
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
  if (isAgreementGateEnabled() && !hasSignedCurrentAgreement(metadata)) {
    return NextResponse.json(
      {
        error: 'agreement_required',
        message: 'Please accept the Terms of Service to continue.',
        redirect: '/legal/agreement/sign',
      },
      { status: 403 },
    )
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const ensured = await ensureGreatPlainsMembership(adminClient, user)

  // Workspace for usage rollups. Cache itself is intentionally global —
  // if Team A already paid to skip-trace this owner, Team B gets a hit.
  const { data: subRow } = await adminClient
    .from('subscriptions')
    .select('team_owner_id, status')
    .eq('user_id', userId)
    .maybeSingle()
  const workspaceId =
    ensured.ownerId ||
    getTeamOwnerId(
      metadata,
      (subRow as { team_owner_id?: string | null } | null)?.team_owner_id,
    ) || userId

  // Skip-trace is complimentary only for Mineral Map + Jordan's Great
  // Plains workspaces (members inherit from the team admin).
  let workspaceOwnerEmail = user.email ?? null
  if (workspaceId !== userId) {
    const { data: ownerUser } = await adminClient.auth.admin.getUserById(workspaceId)
    workspaceOwnerEmail = ownerUser?.user?.email ?? workspaceOwnerEmail
  }
  const skipTraceWaived = isSkipTraceWaivedFor({
    userEmail: user.email,
    workspaceOwnerEmail,
  })
  const teamCard = await readTeamCardStatus(adminClient, workspaceId)
  const canManageCard = workspaceId === userId
  const stripeConfigured = stripeBillingConfigured()

  const currentMonth = new Date().toISOString().slice(0, 7)
  let currentCount = 0
  let currentBillable = 0
  const cacheKey = skipTraceOwnerKey(ownerName)

  // 1) Shared cache first — any prior team's result counts. Cache hits
  // are FREE ($0) — no usage increment, no invoice line.
  if (cacheKey) {
    const { data: cachedRows, error: cacheError } = await adminClient
      .from('skip_trace_cache')
      .select('phones, emails')
      .eq('owner_name', cacheKey)
      .order('updated_at', { ascending: false })
      .limit(1)
    const cached = cachedRows?.[0] ?? null

    if (cacheError) {
      console.error('Skip trace cache lookup error:', cacheError)
    }

    if (cached) {
      const pastDueGate = skipTracePaymentGate({
        waived: skipTraceWaived,
        stripeConfigured,
        gateReady: teamCard.gateReady,
        hasCard: teamCard.has_card,
        pastDue: teamCard.skip_trace_past_due,
        liveLookup: false,
      })
      if (!pastDueGate.ok) {
        return NextResponse.json(
          {
            error: pastDueGate.error,
            message: pastDueGate.message,
            redirect: pastDueGate.redirect,
            can_manage_card: canManageCard,
          },
          { status: pastDueGate.status },
        )
      }
      const cachedPhones = (cached as { phones?: string[] }).phones ?? []
      const cachedEmails = (cached as { emails?: string[] }).emails ?? []
      let needsReview = false
      if (cachedPhones.length === 0) {
        needsReview = await queueSkipTraceReview(adminClient, {
          ownerName,
          firstName,
          lastName,
          address,
          city,
          state,
          zip,
          county,
          tractAbstract,
          dealId,
          teamOwnerId: workspaceId,
          requestedBy: userId,
          requestedByEmail: user.email ?? null,
          emails: cachedEmails,
        })
      }
      return NextResponse.json({
        success: true,
        phones: cachedPhones,
        emails: cachedEmails,
        cached: true,
        billable: false,
        unit_price_usd: 0,
        limit: MONTHLY_LIMIT,
        needs_review: needsReview,
      })
    }
  }

  const liveGate = skipTracePaymentGate({
    waived: skipTraceWaived,
    stripeConfigured,
    gateReady: teamCard.gateReady,
    hasCard: teamCard.has_card,
    pastDue: teamCard.skip_trace_past_due,
    liveLookup: true,
  })
  if (!liveGate.ok) {
    return NextResponse.json(
      {
        error: liveGate.error,
        message: liveGate.message,
        redirect: liveGate.redirect,
        can_manage_card: canManageCard,
      },
      { status: liveGate.status },
    )
  }

  // 2) Check monthly usage limit (cache misses / paid calls only)
  {
    try {
      const usage = await readSkipTraceUsage(adminClient, userId, currentMonth)
      currentCount = usage.count
      currentBillable = usage.billableCount
    } catch (usageError) {
      console.error('Skip trace usage lookup error:', usageError)
      return NextResponse.json({ error: 'Failed to read skip trace usage' }, { status: 500 })
    }

    if (currentCount >= MONTHLY_LIMIT) {
      return NextResponse.json(
        {
          error: 'monthly_limit_reached',
          message: `You have used all ${MONTHLY_LIMIT} skip traces for this month. Resets on the 1st.`,
          count: currentCount,
          limit: MONTHLY_LIMIT,
        },
        { status: 429 }
      )
    }
  }

  // 3) Provider chain (same for LLC / trust / estate / person):
  //      idiCORE first, then Accurate Append, BatchData backup, Tracerfy last-resort.
  if (!skipTraceProvidersConfigured()) {
    return NextResponse.json(
      {
        error:
          'Skip trace providers are not configured ' +
          '(ACCURATE_APPEND_API_KEY / IDICORE_SEARCH_URL / BATCHSKIPTRACING_API_KEY / TRACERFY_API_KEY)',
      },
      { status: 500 },
    )
  }

  const traceArgs = enrichPersonTraceArgs({
    firstName,
    lastName,
    ownerName,
    address,
    city,
    state,
    zip,
  })
  const ownerType = classifyOwner(traceArgs.ownerName, traceArgs.firstName, traceArgs.lastName)

  try {
    const chain = await runSkipTraceChain(traceArgs)
    const phones = chain.phones
    const emails = chain.emails
    const cacheSource = chain.source
    const tried = chain.tried

    // $1 only when a phone number comes back. Misses, email-only, cache
    // hits, and owner-team workspaces (Mineral Map / Great Plains) are not billed. Running total
    // lives on skip_trace_usage.billable_count (team invoice at month end).
    const billable = isSkipTraceBillable({
      cached: false,
      waived: skipTraceWaived,
      phoneCount: phones.length,
    })
    let nextCount = currentCount + 1
    let nextBillable = currentBillable
    try {
      const usage = await incrementSkipTraceUsage(adminClient, {
        userId,
        workspaceId,
        month: currentMonth,
        currentCount,
        currentBillable,
        billable,
      })
      nextCount = usage.nextCount
      nextBillable = usage.nextBillable
    } catch (usageUpdateError) {
      console.error('Skip trace usage update error:', usageUpdateError)
      return NextResponse.json({ error: 'Failed to update skip trace usage' }, { status: 500 })
    }

    // Save to SHARED cache — next team that skip-traces this owner
    // gets a free cache hit (no $1 charge).
    //
    // Delete-then-insert instead of upsert(onConflict:'owner_name'): the live
    // DB is missing the UNIQUE(owner_name) constraint, so onConflict upserts
    // fail (Postgres 42P10) and nothing ever cached. This keys on owner_name
    // without needing the constraint (the read path already looks up by it).
    if (cacheKey && (phones.length > 0 || emails.length > 0)) {
      await adminClient.from('skip_trace_cache').delete().eq('owner_name', cacheKey)
      const { error: cacheWriteError } = await adminClient.from('skip_trace_cache').insert({
        owner_name: cacheKey,
        mailing_address: address ?? '',
        phones,
        emails,
        source: cacheSource,
        updated_at: new Date().toISOString(),
      })
      if (cacheWriteError) {
        console.error('Skip trace cache write error:', cacheWriteError)
      }
    }

    let needsReview = false
    if (phones.length === 0) {
      needsReview = await queueSkipTraceReview(adminClient, {
        ownerName,
        firstName: traceArgs.firstName,
        lastName: traceArgs.lastName,
        address,
        city,
        state,
        zip,
        county,
        tractAbstract,
        dealId,
        teamOwnerId: workspaceId,
        requestedBy: userId,
        requestedByEmail: user.email ?? null,
        emails,
      })
    }

    return NextResponse.json({
      success: true,
      phones,
      emails,
      cached: false,
      billable,
      unit_price_usd: billable ? SKIP_TRACE_PRICE_USD : 0,
      waived: skipTraceWaived,
      source: cacheSource,
      tried,
      owner_type: ownerType,
      hit: phones.length > 0 || emails.length > 0,
      credits_deducted: 0,
      count: nextCount,
      billable_count: nextBillable,
      limit: MONTHLY_LIMIT,
      needs_review: needsReview,
    })
  } catch (err) {
    console.error('Skip trace error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
