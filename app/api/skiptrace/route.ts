import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { getTeamOwnerId } from '@/lib/team'
import { skipTraceOwnerKey } from '@/lib/workspace'
import { SKIP_TRACE_PRICE_USD, isSkipTraceBillable } from '@/lib/billing'
import { isBillingExempt } from '@/lib/access'
import {
  hasSignedCurrentAgreement,
  isAgreementGateEnabled,
} from '@/lib/agreement'
import { queueSkipTraceReview } from '@/lib/skip-trace-review'
import {
  incrementSkipTraceUsage,
  readSkipTraceUsage,
} from '@/lib/skip-trace-usage'

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

/** Label only — Accurate Append runs first, then idiCORE / BatchData / Tracerfy. */
function classifyOwner(ownerName?: string, firstName?: string, lastName?: string): 'entity' | 'person' {
  const s = `${ownerName ?? ''} ${firstName ?? ''} ${lastName ?? ''}`.toUpperCase()
  return ENTITY_RE.test(s) ? 'entity' : 'person'
}

const ACCURATE_APPEND_BASE = 'https://api.accurateappend.com/Services/V2'

function accurateAppendLicenseKey(): string {
  return (
    process.env.ACCURATE_APPEND_API_KEY?.trim() ||
    process.env.ACCURATE_APPEND_LICENSE_KEY?.trim() ||
    ''
  )
}

function pushAccurateAppendPhones(payload: unknown, phones: string[]) {
  if (!payload || typeof payload !== 'object') return
  const root = payload as Record<string, unknown>
  const items = Array.isArray(root.Phones)
    ? root.Phones
    : Array.isArray(root.phones)
      ? root.phones
      : []
  for (const item of items) {
    if (typeof item === 'string') {
      pushUniquePhone(phones, item)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const area = String(obj.AreaCode ?? obj.areaCode ?? '').replace(/\D/g, '')
    const rest = String(
      obj.PhoneNumber ?? obj.phoneNumber ?? obj.number ?? obj.phone ?? '',
    ).replace(/\D/g, '')
    const combined = area && rest.length === 7 ? `${area}${rest}` : rest
    if (combined.length >= 10) pushUniquePhone(phones, combined)
  }
}

function pushAccurateAppendEmails(payload: unknown, emails: string[]) {
  if (!payload || typeof payload !== 'object') return
  const root = payload as Record<string, unknown>
  const items = Array.isArray(root.Emails)
    ? root.Emails
    : Array.isArray(root.emails)
      ? root.emails
      : []
  for (const item of items) {
    if (typeof item === 'string') {
      pushUniqueEmail(emails, item)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    pushUniqueEmail(emails, obj.Email ?? obj.email ?? obj.address)
  }
}

async function accurateAppendGet(
  path: string,
  params: URLSearchParams,
): Promise<Record<string, unknown> | null> {
  const url = `${ACCURATE_APPEND_BASE}${path}?${params.toString()}`
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) {
    console.error('Accurate Append', path, 'failed:', res.status, text.slice(0, 300))
    return null
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    console.error('Accurate Append', path, 'parse failed')
    return null
  }
}

/** Accurate Append phone + email append — first provider when ACCURATE_APPEND_API_KEY is set.
 * People: ADS consumer phone (mobile + landline) + MaxConnect email.
 * Entities: business phone append + email (owner name as lastname).
 * Empty result falls through to idiCORE. */
async function traceAccurateAppend(licenseKey: string, a: TraceArgs): Promise<TraceResult> {
  const phones: string[] = []
  const emails: string[] = []
  const firstName = (a.firstName || '').trim()
  const lastName = (a.lastName || '').trim()
  const ownerName = (a.ownerName || '').trim()
  const lastNameOrFull = lastName || ownerName
  if (!lastNameOrFull && !firstName) return { phones, emails }

  const common = new URLSearchParams()
  if (firstName) common.set('firstname', firstName)
  if (lastNameOrFull) common.set('lastname', lastNameOrFull)
  if (a.address?.trim()) common.set('address', a.address.trim())
  if (a.city?.trim()) common.set('city', a.city.trim())
  if (a.state?.trim()) common.set('state', a.state.trim())
  if (a.zip?.trim()) common.set('postalcode', a.zip.trim())

  const ownerType = classifyOwner(a.ownerName, a.firstName, a.lastName)
  const jobs: Promise<void>[] = []

  if (ownerType === 'entity' && ownerName) {
    const biz = new URLSearchParams()
    biz.set('businessname', ownerName)
    if (a.address?.trim()) biz.set('address', a.address.trim())
    if (a.city?.trim()) biz.set('city', a.city.trim())
    if (a.state?.trim()) biz.set('state', a.state.trim())
    if (a.zip?.trim()) biz.set('postalcode', a.zip.trim())
    jobs.push(
      accurateAppendGet(`/AppendPhone/Business/${encodeURIComponent(licenseKey)}/`, biz).then(
        (data) => {
          if (!data) return
          pushAccurateAppendPhones(data, phones)
          extractContactsFromPayload(data, phones, emails)
        },
      ),
    )
  } else {
    const phoneParams = new URLSearchParams(common)
    phoneParams.set('lineType', 'C;S')
    jobs.push(
      accurateAppendGet(`/AppendPhone/Ads/${encodeURIComponent(licenseKey)}/`, phoneParams).then(
        (data) => {
          if (!data) return
          pushAccurateAppendPhones(data, phones)
          extractContactsFromPayload(data, phones, emails)
        },
      ),
    )
  }

  if (lastNameOrFull) {
    const emailParams = new URLSearchParams(common)
    emailParams.set('maxResults', '5')
    jobs.push(
      accurateAppendGet(`/AppendEmail/${encodeURIComponent(licenseKey)}/`, emailParams).then(
        (data) => {
          if (!data) return
          pushAccurateAppendEmails(data, emails)
          extractContactsFromPayload(data, phones, emails)
        },
      ),
    )
  }

  await Promise.all(jobs)
  console.log(
    'Accurate Append result:',
    JSON.stringify({ ownerType, phones: phones.length, emails: emails.length }),
  )
  return { phones, emails }
}

/** BatchData property skip-trace — backup after Accurate Append / idiCORE. */
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

/** Build a RequestInit that egresses through the static-IP proxy when
 * IDICORE_PROXY_URL / SKIPTRACE_PROXY_URL is set. idiCORE allow-lists a fixed
 * US IP; Vercel Pro egresses from rotating AWS ranges, so both the auth and
 * the search call must go through the registered-IP proxy. */
async function idicoreProxyInit(base: RequestInit): Promise<RequestInit> {
  const proxyUrl =
    process.env.IDICORE_PROXY_URL?.trim() || process.env.SKIPTRACE_PROXY_URL?.trim()
  if (!proxyUrl) return base
  const { ProxyAgent } = await import('undici')
  return { ...base, dispatcher: new ProxyAgent(proxyUrl) } as RequestInit & {
    dispatcher: unknown
  }
}

// Cached idiCORE bearer token (survives across calls on a warm serverless
// instance so we don't re-authenticate on every skip-trace).
let idicoreToken: { value: string; expiresAt: number } | null = null

/** Authenticate against idiCORE and return a bearer token.
 *
 * idiCORE is a TWO-STEP API. Per idiCORE's sample: POST to the auth endpoint
 * (url1, https://login-api-test.idicore.com/apiclient) with HTTP Basic auth
 * — `Authorization: Basic base64(clientId:clientSecret)` — and a JSON body of
 * permissible-use codes `{"glba": "...", "dppa": "..."}`. The response body IS
 * the token (raw string); it expires in ~15 minutes.
 *
 * Config (env): IDICORE_AUTH_URL, IDICORE_CLIENT_ID, IDICORE_CLIENT_SECRET,
 * IDICORE_GLBA (default "otheruse"), IDICORE_DPPA (default "none"). */
async function idicoreAuthenticate(): Promise<string | null> {
  if (idicoreToken && idicoreToken.expiresAt > Date.now() + 30_000) {
    return idicoreToken.value
  }
  const authUrl = process.env.IDICORE_AUTH_URL?.trim()
  const clientId = process.env.IDICORE_CLIENT_ID?.trim()
  const clientSecret = process.env.IDICORE_CLIENT_SECRET?.trim()
  if (!authUrl || !clientId || !clientSecret) return null

  const glba = process.env.IDICORE_GLBA?.trim() || 'otheruse'
  const dppa = process.env.IDICORE_DPPA?.trim() || 'none'
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const init = await idicoreProxyInit({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${basic}`,
    },
    body: JSON.stringify({ glba, dppa }),
  })
  const res = await fetch(authUrl, init as RequestInit)
  if (!res.ok) {
    console.error('idiCORE auth failed:', res.status, (await res.text()).slice(0, 300))
    return null
  }
  // The response body is the token itself (a raw JWT string).
  const token = (await res.text()).trim()
  if (!token) return null
  // idiCORE tokens expire in ~15 min; cache for 12 to stay safely inside that.
  idicoreToken = { value: token, expiresAt: Date.now() + 12 * 60_000 }
  return token
}

/** idiCORE (IDI) skip-trace — second provider, after Accurate Append.
 *
 * Two-step: authenticate (idicoreAuthenticate) then POST the search to
 * IDICORE_SEARCH_URL (the tailored "/search/MineralMap" template). Falls back
 * to the legacy single-URL Bearer flow (IDICORE_API_URL + IDICORE_API_KEY)
 * when no auth URL is configured. No-ops (-> Tracerfy) when neither is set.
 *
 * The search request/response mapping uses defensive contact extraction;
 * confirm the exact input field names + response shape against idiCORE's
 * tailored MineralMap documentation / sample script. */
async function traceIdicore(a: TraceArgs): Promise<TraceResult> {
  const phones: string[] = []
  const emails: string[] = []
  const searchUrl =
    process.env.IDICORE_SEARCH_URL?.trim() || process.env.IDICORE_API_URL?.trim()
  if (!searchUrl) return { phones, emails }

  // Token: two-step auth when IDICORE_AUTH_URL is set, else legacy static key.
  const token = (await idicoreAuthenticate()) || process.env.IDICORE_API_KEY?.trim()
  if (!token) return { phones, emails }

  // idiCORE person-search inputs. First/last + address narrow the match; the
  // tailored MineralMap template returns only phone + email.
  const body = {
    firstName: a.firstName || '',
    lastName: a.lastName || '',
    address: a.address || '',
    city: a.city || '',
    state: a.state || '',
    zip: a.zip || '',
  }
  // idiCORE expects the token as the raw Authorization header value; set
  // IDICORE_AUTH_SCHEME=bearer if the account requires a "Bearer " prefix.
  const authHeader =
    process.env.IDICORE_AUTH_SCHEME?.trim().toLowerCase() === 'bearer'
      ? `Bearer ${token}`
      : token
  const init = await idicoreProxyInit({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(body),
  })
  const res = await fetch(searchUrl, init as RequestInit)
  if (!res.ok) {
    console.error('idiCORE search failed:', res.status, (await res.text()).slice(0, 300))
    return { phones, emails }
  }
  const data = JSON.parse(await res.text()) as Record<string, unknown>
  // idiCORE MineralMap response: { result: [ { phone: [{number,...}],
  // email: [{data,...}] }, ... ], error?, ... }. A too-broad query returns an
  // `error` (e.g. TooManyMatches) with result=[]; we just yield no contacts
  // and the chain falls through to Tracerfy.
  const results = Array.isArray(data.result) ? (data.result as Array<Record<string, unknown>>) : []
  for (const identity of results) {
    for (const p of (identity?.phone as Array<Record<string, unknown>>) ?? []) {
      if (p?.fake === true) continue
      const num = String(p?.number ?? '').trim()
      if (num && !phones.includes(num)) phones.push(num)
    }
    for (const e of (identity?.email as Array<Record<string, unknown>>) ?? []) {
      const addr = String(e?.data ?? '').trim()
      if (addr && !emails.includes(addr)) emails.push(addr)
    }
  }
  const err = data.error as { message?: string } | undefined
  if (err?.message && results.length === 0) {
    console.warn('idiCORE search returned no results:', err.message)
  }
  // Defensive fallback for any other shape.
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
    .select('team_owner_id, status')
    .eq('user_id', userId)
    .maybeSingle()
  const workspaceId =
    getTeamOwnerId(
      metadata,
      (subRow as { team_owner_id?: string | null } | null)?.team_owner_id,
    ) || userId

  // Grandfathered / complimentary accounts: no $1 skip-trace invoice line.
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
  let currentBillable = 0
  const cacheKey = skipTraceOwnerKey(ownerName)

  // 1) Shared cache first — any prior team's result counts. Cache hits
  // are FREE ($0) — no usage increment, no invoice line.
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
  //      Accurate Append first, then idiCORE, BatchData backup, Tracerfy last-resort.
  const accurateAppendKey = accurateAppendLicenseKey()
  const tracerfyKey = process.env.TRACERFY_API_KEY?.trim()
  const batchKey = process.env.BATCHSKIPTRACING_API_KEY?.trim()
  // idiCORE is enabled once a search endpoint is configured (two-step auth via
  // IDICORE_AUTH_URL, or legacy IDICORE_API_URL + IDICORE_API_KEY).
  const idicoreEnabled = Boolean(
    process.env.IDICORE_SEARCH_URL?.trim() || process.env.IDICORE_API_URL?.trim(),
  )
  if (!accurateAppendKey && !tracerfyKey && !batchKey && !idicoreEnabled) {
    return NextResponse.json(
      {
        error:
          'Skip trace providers are not configured ' +
          '(ACCURATE_APPEND_API_KEY / IDICORE_SEARCH_URL / BATCHSKIPTRACING_API_KEY / TRACERFY_API_KEY)',
      },
      { status: 500 },
    )
  }

  const ownerType = classifyOwner(ownerName, firstName, lastName)
  const traceArgs: TraceArgs = { firstName, lastName, ownerName, address, city, state, zip }

  const runners: Record<string, (() => Promise<TraceResult>) | null> = {
    accurateappend: accurateAppendKey
      ? () => traceAccurateAppend(accurateAppendKey, traceArgs)
      : null,
    batchdata: batchKey ? () => traceBatchData(batchKey, traceArgs) : null,
    idicore: idicoreEnabled ? () => traceIdicore(traceArgs) : null,
    tracerfy: tracerfyKey ? () => traceTracerfy(tracerfyKey, traceArgs) : null,
  }
  const order = ['accurateappend', 'idicore', 'batchdata', 'tracerfy']

  try {
    let phones: string[] = []
    let emails: string[] = []
    let cacheSource = 'none'

    for (const name of order) {
      const run = runners[name]
      if (!run) continue
      try {
        console.log(`Skip trace trying provider: ${name}`)
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

    // $1 only when a phone number comes back. Misses, email-only, cache
    // hits, and billing_exempt workspaces are not billed. Running total
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
