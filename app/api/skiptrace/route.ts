import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { getTeamOwnerId } from '@/lib/team'
import { skipTraceOwnerKey } from '@/lib/workspace'
import { SKIP_TRACE_PRICE_USD } from '@/lib/billing'
import { isBillingExempt } from '@/lib/access'
import {
  hasSignedCurrentAgreement,
  isAgreementGateEnabled,
} from '@/lib/agreement'
import { reportSkipTraceMeterEvent } from '@/lib/stripe-meter'

// Skip trace usage is still tracked in the skip_trace_usage table
// for internal accounting / abuse detection, but there is no monthly
// cap enforced on end users. Setting the limit to Number.MAX_SAFE_INTEGER
// keeps the response shape backwards-compatible with the older UI
// (`limit: N`) so nothing downstream has to change.
const MONTHLY_LIMIT = Number.MAX_SAFE_INTEGER

const pushUniquePhone = (phones: string[], value: unknown) => {
  if (typeof value !== 'string') return
  const normalized = value.trim()
  if (!normalized) return
  if (!phones.includes(normalized)) phones.push(normalized)
}

const pushUniqueEmail = (emails: string[], value: unknown) => {
  if (typeof value !== 'string') return
  const normalized = value.trim()
  if (!normalized) return
  if (!emails.includes(normalized)) emails.push(normalized)
}

const extractContactsFromPayload = (
  payload: unknown,
  phones: string[],
  emails: string[]
) => {
  if (!payload || typeof payload !== 'object') return

  const root = payload as Record<string, unknown>

  const addPhonesFromArray = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (typeof item === 'string') {
        pushUniquePhone(phones, item)
        continue
      }
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      pushUniquePhone(phones, obj.number ?? obj.phone ?? obj.phoneNumber ?? obj.mobile)
    }
  }

  const addEmailsFromArray = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (typeof item === 'string') {
        pushUniqueEmail(emails, item)
        continue
      }
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      pushUniqueEmail(emails, obj.email ?? obj.address ?? obj.emailAddress)
    }
  }

  addPhonesFromArray(root.phones)
  addPhonesFromArray(root.phone_numbers)
  addPhonesFromArray(root.phoneNumbers)
  addEmailsFromArray(root.emails)
  addEmailsFromArray(root.email_addresses)
  addEmailsFromArray(root.emailAddresses)

  pushUniquePhone(phones, root.phone ?? root.phoneNumber ?? root.mobile)
  pushUniqueEmail(emails, root.email ?? root.emailAddress)

  const nestedCollections = [root.persons, root.results, root.data, root.skips]
  for (const collection of nestedCollections) {
    if (!Array.isArray(collection)) continue
    for (const item of collection) {
      extractContactsFromPayload(item, phones, emails)
    }
  }
}

type TraceArgs = {
  firstName?: string
  lastName?: string
  ownerName?: string
  address?: string
  city?: string
  state?: string
  zip?: string
}
type TraceResult = { phones: string[]; emails: string[] }

// Owner-name tokens that mark a non-individual (LLC / trust / estate / other
// business or fiduciary). Mineral tax rolls abbreviate heavily — "TR" (trust),
// "EST" (estate), "CO" — so those are included as whole-word matches. "ET AL"/
// "ET UX" mark individuals-with-others and are intentionally NOT here.
const ENTITY_RE = new RegExp(
  '\\b(' +
  'LLC|L\\.?L\\.?C\\.?|LP|L\\.?P\\.?|LLP|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|' +
  'TRUST|TR|ESTATE|EST|MINERALS?|ROYALT(?:Y|IES)|PARTNERS?|PARTNERSHIP|HOLDINGS?|' +
  'PROPERT(?:Y|IES)|RESOURCES?|ENERGY|OPERATING|FUND|LTD|LIMITED|FOUNDATION|CHURCH|' +
  'BANK|ASSN|ASSOCIATION|INTERESTS?|VENTURES?|GROUP|ENTERPRISES?|EXPLORATION|' +
  'PRODUCTION|PETROLEUM|REVOCABLE|IRREVOCABLE' +
  ')\\b',
  'i',
)

/** Route entities (LLC/trust/estate/…) to BatchData, individuals to IDICORE. */
function classifyOwner(ownerName?: string, firstName?: string, lastName?: string): 'entity' | 'person' {
  const s = `${ownerName ?? ''} ${firstName ?? ''} ${lastName ?? ''}`.toUpperCase()
  return ENTITY_RE.test(s) ? 'entity' : 'person'
}

/** BatchData property skip-trace — primary for entities. */
async function traceBatchData(apiKey: string, a: TraceArgs): Promise<TraceResult> {
  const phones: string[] = []
  const emails: string[] = []
  const body = {
    requests: [
      {
        // BatchData accepts a business/entity name via `name`; individuals via
        // first/last. Send whatever we have so both cases resolve.
        name: a.ownerName || '',
        firstName: a.firstName || '',
        lastName: a.lastName || '',
        address: a.address || '',
        city: a.city || '',
        state: a.state || '',
        zip: a.zip || '',
      },
    ],
  }
  const res = await fetch('https://api.batchdata.com/api/v1/property/skip-trace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { phones, emails }
  const data = JSON.parse(await res.text()) as Record<string, unknown>
  const persons =
    ((data?.results as Record<string, unknown> | undefined)?.persons as Array<Record<string, unknown>>) ?? []
  for (const person of persons) {
    for (const p of (person?.phoneNumbers as Array<Record<string, unknown>>) ?? []) {
      const num = String(p?.phoneNumber ?? p?.number ?? '').trim()
      if (num && !phones.includes(num)) phones.push(num)
    }
    for (const e of (person?.emails as Array<Record<string, unknown>>) ?? []) {
      const addr = String(e?.email ?? e?.address ?? '').trim()
      if (addr && !emails.includes(addr)) emails.push(addr)
    }
  }
  // Defensive: pick up any other shapes BatchData returns.
  extractContactsFromPayload(data, phones, emails)
  return { phones, emails }
}

/** idiCORE (IDI) skip-trace — primary for individuals.
 *
 * Activated once IDICORE_API_URL + IDICORE_API_KEY are set; until then this
 * no-ops and the person chain falls through to Tracerfy. The request/response
 * mapping is intentionally generic (defensive contact extraction) — finalize
 * the body/field names against idiCORE's API contract when wiring the key. */
async function traceIdicore(apiKey: string, a: TraceArgs): Promise<TraceResult> {
  const phones: string[] = []
  const emails: string[] = []
  const url = process.env.IDICORE_API_URL?.trim()
  if (!url) return { phones, emails }
  const body = {
    firstName: a.firstName || '',
    lastName: a.lastName || '',
    name: a.ownerName || '',
    address: a.address || '',
    city: a.city || '',
    state: a.state || '',
    zip: a.zip || '',
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { phones, emails }
  const data = JSON.parse(await res.text()) as Record<string, unknown>
  extractContactsFromPayload(data, phones, emails)
  return { phones, emails }
}

/** Tracerfy Instant Trace — shared last-resort backstop. Needs an address. */
async function traceTracerfy(apiKey: string, a: TraceArgs): Promise<TraceResult> {
  const phones: string[] = []
  const emails: string[] = []
  if (!(a.address?.trim() && a.city?.trim() && a.state?.trim())) return { phones, emails }
  const body: Record<string, unknown> = {
    find_owner: false,
    first_name: a.firstName,
    last_name: a.lastName,
    address: a.address,
    city: a.city,
    state: a.state,
  }
  if (a.zip?.trim()) body.zip = a.zip
  const res = await fetch('https://tracerfy.com/v1/api/trace/lookup/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { phones, emails }
  const data = JSON.parse(await res.text()) as Record<string, unknown>
  for (const person of (data.persons as Array<Record<string, unknown>>) ?? []) {
    for (const p of (person?.phones as Array<Record<string, unknown>>) ?? []) {
      const num = p?.number
      if (typeof num === 'string' && num && !phones.includes(num)) phones.push(num)
    }
    for (const e of (person?.emails as Array<Record<string, unknown>>) ?? []) {
      const addr = e?.email
      if (typeof addr === 'string' && addr && !emails.includes(addr)) emails.push(addr)
    }
  }
  extractContactsFromPayload(data, phones, emails)
  return { phones, emails }
}

export async function POST(req: NextRequest) {
  const { firstName, lastName, address, city, state, zip, ownerName } = await req.json()

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
        message: 'Please sign the Platform Services Agreement to continue.',
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

  // Workspace for usage rollups. Cache itself is intentionally global —
  // if Team A already paid to skip-trace this owner, Team B gets a hit.
  const { data: subRow } = await adminClient
    .from('subscriptions')
    .select('team_owner_id, stripe_customer_id, status')
    .eq('user_id', userId)
    .maybeSingle()
  const workspaceId =
    getTeamOwnerId(
      metadata,
      (subRow as { team_owner_id?: string | null } | null)?.team_owner_id,
    ) || userId

  // Stripe customer lives on the workspace owner's subscription row
  // (invited members don't have their own customer id).
  let stripeCustomerId =
    (subRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ??
    null
  if (!stripeCustomerId || workspaceId !== userId) {
    const { data: ownerSub } = await adminClient
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', workspaceId)
      .maybeSingle()
    stripeCustomerId =
      (ownerSub as { stripe_customer_id?: string | null } | null)
        ?.stripe_customer_id ?? stripeCustomerId
  }

  // Grandfathered / complimentary accounts: no $0.50 charge (no Stripe meter).
  // Also waive when the workspace owner is exempt (invited members inherit).
  let skipTraceWaived = isBillingExempt(metadata)
  if (!skipTraceWaived && workspaceId !== userId) {
    const { data: ownerUser } = await adminClient.auth.admin.getUserById(workspaceId)
    skipTraceWaived = isBillingExempt(
      (ownerUser?.user?.user_metadata ?? {}) as Record<string, unknown>,
    )
  }

  const currentMonth = new Date().toISOString().slice(0, 7)
  let currentCount = 0
  const cacheKey = skipTraceOwnerKey(ownerName)

  // 1) Shared cache first — any prior team's result counts. Cache hits
  // are FREE ($0) — no usage increment, no Stripe meter event.
  if (cacheKey) {
    const { data: cached, error: cacheError } = await adminClient
      .from('skip_trace_cache')
      .select('phones, emails')
      .eq('owner_name', cacheKey)
      .maybeSingle()

    if (cacheError) {
      console.error('Skip trace cache lookup error:', cacheError)
    }

    if (cached) {
      return NextResponse.json({
        success: true,
        phones: (cached as { phones?: string[] }).phones ?? [],
        emails: (cached as { emails?: string[] }).emails ?? [],
        cached: true,
        billable: false,
        unit_price_usd: 0,
        limit: MONTHLY_LIMIT,
      })
    }
  }

  // 2) Check monthly usage limit (cache misses / paid calls only)
  {
    const { data: usage, error: usageError } = await adminClient
      .from('skip_trace_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('month', currentMonth)
      .maybeSingle()

    if (usageError) {
      console.error('Skip trace usage lookup error:', usageError)
      return NextResponse.json({ error: 'Failed to read skip trace usage' }, { status: 500 })
    }

    currentCount = Number((usage as { count?: number } | null)?.count ?? 0)

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

  // 3) Provider chain, ordered by owner type:
  //      entity (LLC / trust / estate / …) -> BatchData first
  //      person (individual)               -> IDICORE first
  //    Tracerfy is the shared last-resort backstop for both.
  const tracerfyKey = process.env.TRACERFY_API_KEY?.trim()
  const batchKey = process.env.BATCHSKIPTRACING_API_KEY?.trim()
  const idiKey = process.env.IDICORE_API_KEY?.trim()
  if (!tracerfyKey && !batchKey && !idiKey) {
    return NextResponse.json(
      {
        error:
          'Skip trace providers are not configured ' +
          '(BATCHSKIPTRACING_API_KEY / IDICORE_API_KEY / TRACERFY_API_KEY)',
      },
      { status: 500 },
    )
  }

  const ownerType = classifyOwner(ownerName, firstName, lastName)
  const traceArgs: TraceArgs = { firstName, lastName, ownerName, address, city, state, zip }

  const runners: Record<string, (() => Promise<TraceResult>) | null> = {
    batchdata: batchKey ? () => traceBatchData(batchKey, traceArgs) : null,
    idicore: idiKey ? () => traceIdicore(idiKey, traceArgs) : null,
    tracerfy: tracerfyKey ? () => traceTracerfy(tracerfyKey, traceArgs) : null,
  }
  // Tracerfy always runs last; the primary is chosen by owner type.
  const order =
    ownerType === 'entity'
      ? ['batchdata', 'tracerfy']
      : ['idicore', 'tracerfy']

  try {
    let phones: string[] = []
    let emails: string[] = []
    let cacheSource = 'none'

    for (const name of order) {
      const run = runners[name]
      if (!run) continue
      try {
        const result = await run()
        if (result.phones.length > 0 || result.emails.length > 0) {
          phones = result.phones
          emails = result.emails
          cacheSource = name
          break
        }
      } catch (providerErr) {
        console.error(`Skip trace provider '${name}' error:`, providerErr)
      }
    }

    // Provider call on cache miss. Complimentary (billing_exempt) workspaces
    // are not charged — still bump local usage for internal accounting.
    const nextCount = currentCount + 1
    const { error: usageUpdateError } = await adminClient
      .from('skip_trace_usage')
      .upsert(
        {
          user_id: userId,
          team_owner_id: workspaceId,
          month: currentMonth,
          count: nextCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,month' },
      )

    if (usageUpdateError) {
      console.error('Skip trace usage update error:', usageUpdateError)
      return NextResponse.json({ error: 'Failed to update skip trace usage' }, { status: 500 })
    }

    if (!skipTraceWaived && stripeCustomerId) {
      const meterKey = `skiptrace:${workspaceId}:${cacheKey || userId}:${currentMonth}:${nextCount}`
      await reportSkipTraceMeterEvent({
        stripeCustomerId,
        idempotencyKey: meterKey,
      })
    }

    // Save to SHARED cache — next team that skip-traces this owner
    // gets a free cache hit (no $0.50 charge).
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

    return NextResponse.json({
      success: true,
      phones,
      emails,
      cached: false,
      billable: !skipTraceWaived,
      unit_price_usd: skipTraceWaived ? 0 : SKIP_TRACE_PRICE_USD,
      waived: skipTraceWaived,
      source: cacheSource,
      owner_type: ownerType,
      hit: phones.length > 0 || emails.length > 0,
      credits_deducted: 0,
      count: nextCount,
      limit: MONTHLY_LIMIT,
    })
  } catch (err) {
    console.error('Skip trace error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
