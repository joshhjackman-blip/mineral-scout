/**
 * Skip-trace provider chain. Shared by POST /api/skiptrace (billable live
 * path) and the miss-queue researcher. Order: idiCORE → Accurate Append →
 * BatchData → Tracerfy. A phone or email hit stops the cascade.
 *
 * idiCORE must go through undici + ProxyAgent so Vercel egress hits the
 * allow-listed static IP.
 */

import { isBusinessOwner } from '@/lib/skip-trace-name'

export type TraceArgs = {
  firstName?: string
  lastName?: string
  ownerName?: string
  address?: string
  city?: string
  state?: string
  zip?: string
}

export type TraceResult = { phones: string[]; emails: string[] }

export type SkipTraceProviderName = 'idicore' | 'accurateappend' | 'batchdata' | 'tracerfy'

export type SkipTraceChainResult = TraceResult & {
  source: string
  tried: string[]
}

export const SKIP_TRACE_PROVIDER_ORDER: SkipTraceProviderName[] = [
  'idicore',
  'accurateappend',
  'batchdata',
  'tracerfy',
]

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
  emails: string[],
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

  const nestedCollections = [
    root.persons,
    root.results,
    root.result,
    root.Result,
    root.Results,
    root.data,
    root.skips,
    root.identities,
    root.records,
    root.Records,
  ]
  for (const collection of nestedCollections) {
    if (!Array.isArray(collection)) continue
    for (const item of collection) {
      extractContactsFromPayload(item, phones, emails)
    }
  }
}

/** Label only — used to pick Accurate Append's people vs business endpoint. */
export function classifyOwner(
  ownerName?: string,
  firstName?: string,
  lastName?: string,
): 'entity' | 'person' {
  return isBusinessOwner(ownerName, firstName, lastName) ? 'entity' : 'person'
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

/** Accurate Append phone + email append — backup after idiCORE when
 * ACCURATE_APPEND_API_KEY is set.
 * People: ADS consumer phone (mobile + landline) + MaxConnect email.
 * Entities: business phone append + email (owner name as lastname).
 * Empty result falls through to BatchData. */
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

/** BatchData property skip-trace — backup after idiCORE / Accurate Append. */
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

function idicoreProxyUrl(): string {
  return (
    process.env.IDICORE_PROXY_URL?.trim() ||
    process.env.SKIPTRACE_PROXY_URL?.trim() ||
    ''
  )
}

function idicoreHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'invalid-url'
  }
}

type IdicoreHttpResult = { ok: boolean; status: number; text: string }

/**
 * HTTP for idiCORE only. Must use undici's own `fetch` — Next.js patches
 * global `fetch` and drops `dispatcher`, so `new ProxyAgent(proxyUrl)` on
 * `fetch(url, { dispatcher })` never actually proxies. idiCORE allow-lists
 * one static US IP; without the proxy, auth fails and `/search` is never
 * billed (which is why the test dashboard can sit at 2 searches).
 */
async function idicoreHttp(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<IdicoreHttpResult> {
  const proxyUrl = idicoreProxyUrl()
  const { fetch: undiciFetch, ProxyAgent } = await import('undici')
  const res = await undiciFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    ...(proxyUrl ? { dispatcher: new ProxyAgent(proxyUrl) } : {}),
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
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
  if (!authUrl || !clientId || !clientSecret) {
    console.error(
      'idiCORE auth skipped: missing IDICORE_AUTH_URL / CLIENT_ID / CLIENT_SECRET',
    )
    return null
  }

  const glba = process.env.IDICORE_GLBA?.trim() || 'otheruse'
  const dppa = process.env.IDICORE_DPPA?.trim() || 'none'
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  console.log('idiCORE auth', {
    host: idicoreHost(authUrl),
    viaProxy: Boolean(idicoreProxyUrl()),
  })
  const res = await idicoreHttp(authUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${basic}`,
    },
    body: JSON.stringify({ glba, dppa }),
  })
  if (!res.ok) {
    console.error('idiCORE auth failed:', res.status, res.text.slice(0, 300))
    return null
  }
  // The response body is the token itself (a raw JWT string).
  const token = res.text.trim()
  if (!token) {
    console.error('idiCORE auth returned an empty body')
    return null
  }
  // idiCORE tokens expire in ~15 min; cache for 12 to stay safely inside that.
  idicoreToken = { value: token, expiresAt: Date.now() + 12 * 60_000 }
  console.log('idiCORE auth ok, token chars', token.length)
  return token
}

export type IdicoreAuthProbe = {
  ok: boolean
  status: number | null
  viaProxy: boolean
  tokenChars: number
  error: string | null
}

/**
 * Fresh auth-only probe. Does not POST /search, so it does not consume a
 * skip-trace credit. Clears the in-memory token cache so the result is live.
 */
export async function probeIdicoreAuth(): Promise<IdicoreAuthProbe> {
  idicoreToken = null
  const viaProxy = Boolean(idicoreProxyUrl())
  const authUrl = process.env.IDICORE_AUTH_URL?.trim()
  const clientId = process.env.IDICORE_CLIENT_ID?.trim()
  const clientSecret = process.env.IDICORE_CLIENT_SECRET?.trim()
  if (!authUrl || !clientId || !clientSecret) {
    return {
      ok: false,
      status: null,
      viaProxy,
      tokenChars: 0,
      error: 'missing IDICORE_AUTH_URL / CLIENT_ID / CLIENT_SECRET',
    }
  }

  const glba = process.env.IDICORE_GLBA?.trim() || 'otheruse'
  const dppa = process.env.IDICORE_DPPA?.trim() || 'none'
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  try {
    const res = await idicoreHttp(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basic}`,
      },
      body: JSON.stringify({ glba, dppa }),
    })
    const token = res.text.trim()
    if (!res.ok || !token) {
      return {
        ok: false,
        status: res.status,
        viaProxy,
        tokenChars: 0,
        error: res.ok
          ? 'auth returned an empty body'
          : `auth failed (${res.status})`,
      }
    }
    idicoreToken = { value: token, expiresAt: Date.now() + 12 * 60_000 }
    return {
      ok: true,
      status: res.status,
      viaProxy,
      tokenChars: token.length,
      error: null,
    }
  } catch (err) {
    return {
      ok: false,
      status: null,
      viaProxy,
      tokenChars: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** idiCORE (IDI) skip-trace — first provider.
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
  if (!searchUrl) {
    console.error('idiCORE search skipped: IDICORE_SEARCH_URL / IDICORE_API_URL unset')
    return { phones, emails }
  }

  // Token: two-step auth when IDICORE_AUTH_URL is set, else legacy static key.
  const token = (await idicoreAuthenticate()) || process.env.IDICORE_API_KEY?.trim()
  if (!token) {
    console.error('idiCORE search skipped: no token (auth failed and IDICORE_API_KEY unset)')
    return { phones, emails }
  }

  // idiCORE expects the token as the raw Authorization header value; set
  // IDICORE_AUTH_SCHEME=bearer if the account requires a "Bearer " prefix.
  const authHeader =
    process.env.IDICORE_AUTH_SCHEME?.trim().toLowerCase() === 'bearer'
      ? `Bearer ${token}`
      : token

  const street = (a.address || '').trim()
  const streetLooksBad = /%|c\/o|care of|po box|p\.o\. box/i.test(street)
  const attempts: Array<{ label: string; body: Record<string, string> }> = [
    {
      label: 'full',
      body: {
        firstName: a.firstName || '',
        lastName: a.lastName || '',
        address: street,
        city: a.city || '',
        state: a.state || '',
        zip: a.zip || '',
      },
    },
  ]
  // Care-of / PO Box / attorney lines over-constrain MineralMap. A second
  // search without street (name + city/state/zip) often still finds the person.
  if (street) {
    attempts.push({
      label: streetLooksBad ? 'drop-bad-street' : 'name-city-zip',
      body: {
        firstName: a.firstName || '',
        lastName: a.lastName || '',
        address: '',
        city: a.city || '',
        state: a.state || '',
        zip: a.zip || '',
      },
    })
  }

  for (const attempt of attempts) {
    const found = await idicoreSearchOnce(searchUrl, authHeader, attempt.label, {
      ownerName: a.ownerName || '',
      ...attempt.body,
    })
    for (const num of found.phones) pushUniquePhone(phones, num)
    for (const addr of found.emails) pushUniqueEmail(emails, addr)
    if (phones.length > 0) break
  }
  return { phones, emails }
}

function idicoreIdentities(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const buckets = [
    data.result,
    data.results,
    data.Result,
    data.Results,
    data.identities,
    data.records,
    data.Records,
    data.people,
    data.People,
  ]
  const out: Array<Record<string, unknown>> = []
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue
    for (const item of bucket) {
      if (item && typeof item === 'object') out.push(item as Record<string, unknown>)
    }
  }
  return out
}

function pullIdicorePhones(identity: Record<string, unknown>, phones: string[]) {
  const lists = [
    identity.phone,
    identity.phones,
    identity.Phone,
    identity.Phones,
    identity.phoneNumbers,
    identity.PhoneNumbers,
  ]
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (typeof item === 'string') {
        pushUniquePhone(phones, item)
        continue
      }
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      if (obj.fake === true) continue
      pushUniquePhone(
        phones,
        obj.number ?? obj.phone ?? obj.phoneNumber ?? obj.PhoneNumber ?? obj.data,
      )
    }
  }
}

function pullIdicoreEmails(identity: Record<string, unknown>, emails: string[]) {
  const lists = [
    identity.email,
    identity.emails,
    identity.Email,
    identity.Emails,
    identity.emailAddresses,
  ]
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (typeof item === 'string') {
        pushUniqueEmail(emails, item)
        continue
      }
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      pushUniqueEmail(emails, obj.data ?? obj.email ?? obj.address ?? obj.Email)
    }
  }
}

async function idicoreSearchOnce(
  searchUrl: string,
  authHeader: string,
  label: string,
  body: Record<string, string>,
): Promise<TraceResult> {
  const phones: string[] = []
  const emails: string[] = []
  console.log('idiCORE search POST', {
    label,
    host: idicoreHost(searchUrl),
    viaProxy: Boolean(idicoreProxyUrl()),
    firstName: body.firstName,
    lastName: body.lastName,
    ownerName: body.ownerName,
    hasAddress: Boolean(body.address && body.city && body.state),
  })
  const searchBody = { ...body }
  delete searchBody.ownerName
  const res = await idicoreHttp(searchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(searchBody),
  })
  if (!res.ok) {
    console.error('idiCORE search failed:', label, res.status, res.text.slice(0, 400))
    return { phones, emails }
  }
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(res.text) as Record<string, unknown>
  } catch {
    console.error('idiCORE search parse failed:', label, res.text.slice(0, 200))
    return { phones, emails }
  }
  const identities = idicoreIdentities(data)
  for (const identity of identities) {
    pullIdicorePhones(identity, phones)
    pullIdicoreEmails(identity, emails)
  }
  extractContactsFromPayload(data, phones, emails)
  const err = data.error as { message?: string } | string | undefined
  const errMsg = typeof err === 'string' ? err : err?.message
  console.log('idiCORE search parsed', {
    label,
    keys: Object.keys(data).slice(0, 12),
    identities: identities.length,
    phones: phones.length,
    emails: emails.length,
    error: errMsg || null,
    snippet: res.text.replace(/\s+/g, ' ').slice(0, 280),
  })
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

export function skipTraceProvidersConfigured(): boolean {
  return Boolean(
    accurateAppendLicenseKey() ||
      process.env.TRACERFY_API_KEY?.trim() ||
      process.env.BATCHSKIPTRACING_API_KEY?.trim() ||
      process.env.IDICORE_SEARCH_URL?.trim() ||
      process.env.IDICORE_API_URL?.trim(),
  )
}

export async function runSkipTraceChain(args: TraceArgs): Promise<SkipTraceChainResult> {
  const accurateAppendKey = accurateAppendLicenseKey()
  const tracerfyKey = process.env.TRACERFY_API_KEY?.trim()
  const batchKey = process.env.BATCHSKIPTRACING_API_KEY?.trim()
  const idicoreEnabled = Boolean(
    process.env.IDICORE_SEARCH_URL?.trim() || process.env.IDICORE_API_URL?.trim(),
  )

  const runners: Record<string, (() => Promise<TraceResult>) | null> = {
    accurateappend: accurateAppendKey
      ? () => traceAccurateAppend(accurateAppendKey, args)
      : null,
    batchdata: batchKey ? () => traceBatchData(batchKey, args) : null,
    idicore: idicoreEnabled ? () => traceIdicore(args) : null,
    tracerfy: tracerfyKey ? () => traceTracerfy(tracerfyKey, args) : null,
  }

  let phones: string[] = []
  let emails: string[] = []
  let source = 'none'
  const tried: string[] = []

  for (const name of SKIP_TRACE_PROVIDER_ORDER) {
    const run = runners[name]
    if (!run) continue
    try {
      console.log(`Skip trace trying provider: ${name}`)
      tried.push(name)
      const result = await run()
      if (result.phones.length > 0 || result.emails.length > 0) {
        phones = result.phones
        emails = result.emails
        source = name
        break
      }
    } catch (providerErr) {
      console.error(`Skip trace provider '${name}' error:`, providerErr)
    }
  }

  return { phones, emails, source, tried }
}
