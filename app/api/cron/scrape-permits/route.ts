// Vercel Cron endpoint that scrapes fresh RRC drilling permits and
// upserts them into every active county's <county>_permits table.
//
// Why this exists: we spent 2026-07-16 → 07-21 trying to run this
// scrape from GitHub Actions runners, which RRC blocks by IP range.
// ScrapingBee (5 different config permutations) also failed at the
// TLS handshake layer between ScrapingBee's proxy pool and RRC's
// server. Direct probes from other cloud environments (this dev
// shell) hit RRC fine, so the fix is simple: run the scraper from
// somewhere that ISN'T on RRC's block-list. Vercel's serverless
// functions run in AWS/GCP data centers on IP ranges that RRC has
// not (as of this commit) blocked.
//
// Runtime: Node.js (not Edge — cheerio needs Node's DOM shim and
// the outbound POST needs full HTTPS support). No proxy. Direct
// HTTPS to webapps2.rrc.texas.gov.
//
// Schedule: 22:00 UTC daily (= 5 PM CDT / 4 PM CST). Configured in
// vercel.json → crons.
//
// Auth: Vercel Cron includes an Authorization: Bearer <token>
// header on every scheduled invocation, where <token> is the
// CRON_SECRET env var. We reject requests missing that. Manual
// invocation from your machine is also possible with the same
// header (see the README).
//
// Cost profile: 12 county POSTs per day × 30 days = 360 outbound
// requests/month, ~30s wall-clock per run, well inside every
// Vercel plan tier. Zero ScrapingBee credits.

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'

// Loose alias so we don't have to fight the SDK's default `never`-
// heavy inference. Runtime shape is fully unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseSupabase = SupabaseClient<any, any, any>

export const runtime = 'nodejs'
// Long-running scrape — Vercel's default 10s timeout would kill us.
// 300s (5min) is the max on Pro; give us the whole thing since
// each county POST takes ~2-3s on RRC's server.
export const maxDuration = 300
// Never cache — this is a mutating side-effect endpoint.
export const dynamic = 'force-dynamic'

const BASE = 'https://webapps2.rrc.texas.gov'
const SEARCH_PATH = '/EWA/drillingPermitsQueryAction.do'

const COUNTY_FIPS: Record<string, string> = {
  gonzales:  '177',
  howard:    '227',
  martin:    '317',
  midland:   '329',
  glasscock: '173',
  upton:     '461',
  reagan:    '383',
  crane:     '103',
  pecos:     '371',
  ward:      '475',
  winkler:   '495',
  loving:    '301',
  reeves:    '389',
}

// The default 12 Permian counties this scrape covers. Gonzales is
// archived and skipped by default; pass ?county=gonzales explicitly
// if you want to bring it back.
const DEFAULT_COUNTIES: string[] = [
  'howard', 'martin', 'crane', 'glasscock', 'loving', 'midland',
  'pecos', 'reagan', 'reeves', 'upton', 'ward', 'winkler',
]

// Every hidden struts field the RRC form expects. Missing any and
// RRC silently redisplays the empty form instead of returning
// results. Kept 1:1 with the Python scraper's BLANK_FORM_FIELDS.
const BLANK_FIELDS = [
  'searchArgs.permitStatusNoHndlr.inputValue',
  'searchArgs.apiNoHndlr.inputValue',
  'searchArgs.districtCodeHndlr.selectedCodes',
  'searchArgs.npzFlagHndlr.inputValue',
  'searchArgs.offLeaseSurfLocFlagHndlr.inputValue',
  'searchArgs.offLeasePntrnPtFlagHndlr.inputValue',
  'searchArgs.operatorNameWildcardHndlr.inputValue',
  'searchArgs.operatorNameHndlr.inputValue',
  'searchArgs.operatorNoHndlr.inputValue',
  'searchArgs.leaseNameWildcardHndlr.inputValue',
  'searchArgs.leaseNameHndlr.inputValue',
  'searchArgs.leaseNoHndlr.inputValue',
  'searchArgs.wellNoHndlr.inputValue',
  'searchArgs.fieldNameWildcardHndlr.inputValue',
  'searchArgs.fieldNameHndlr.inputValue',
  'searchArgs.fieldNoHndlr.inputValue',
  'searchArgs.surveyNameWildcardHndlr.inputValue',
  'searchArgs.surveyNameHndlr.inputValue',
  'searchArgs.approvedDtFromHndlr.inputValue',
  'searchArgs.approvedDtToHndlr.inputValue',
  'searchArgs.stackedLateralFlagHndlr.inputValue',
]

// Browser-ish UA so RRC's app doesn't shunt us to a mobile / no-JS
// view. Same shape as the Python scraper's UA.
const UA =
  'Mozilla/5.0 (compatible; MineralMap/1.0 permits-scraper; +https://getmineralmap.com)'

type ParsedPermit = {
  api_number: string
  permit_number: string | null
  operator_name: string | null
  lease_name: string | null
  county_code: string
  permit_type: string | null
  status: string | null
  filed_date: string | null
  approved_date: string | null
  // Detail-page enrichment. Populated when we fetch the permit's
  // drillingPermitDetailAction.do page. Enables resolving the
  // permit to a tract without needing compute_development_status
  // or a matching well row.
  abstract_number: string | null
  latitude: number | null
  longitude: number | null
  // URL of the RRC detail page. Extracted from the results table's
  // inner <a> around the lease name so we can enrich per-permit
  // later in the pipeline.
  detail_url: string | null
}

function normalizeApi(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D+/g, '')
  if (!digits) return null
  // Strip leading zeros but keep "0" for the pathological all-zero case.
  const stripped = digits.replace(/^0+/, '')
  return stripped || '0'
}

function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text || null
}

// MM/DD/YYYY -> ISO YYYY-MM-DD. Returns null on unparseable input.
function parseUsDate(raw: string | null | undefined): string | null {
  const text = cleanText(raw) ?? ''
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!m) return null
  const [, mm, dd, yyyy] = m
  return `${yyyy}-${mm}-${dd}`
}

// GET the search form, extract the action URL, strip the
// JSESSIONID matrix parameter. Cookies flow via the returned
// cookie jar so subsequent POSTs from the same run inherit
// RRC's session.
async function openSearchSession(): Promise<{
  actionUrl: string
  cookie: string
}> {
  const r = await fetch(`${BASE}${SEARCH_PATH}`, {
    method: 'GET',
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
    cache: 'no-store',
  })
  if (!r.ok) {
    throw new Error(`RRC form load ${r.status}: ${r.statusText}`)
  }
  const html = await r.text()
  // The form's action attribute is the URL we POST to. RRC bakes
  // the JSESSIONID into it as a matrix parameter for cookieless
  // clients; strip it and rely on the cookie header we captured
  // above.
  const m = html.match(/<form[^>]+action="([^"]+)"/i)
  if (!m) throw new Error('RRC EWA form not found; endpoint layout may have changed')
  const rawAction = m[1]
  const cleanAction = rawAction.replace(/;jsessionid=[^?]*/i, '')
  const actionUrl = `${BASE}${cleanAction}`
  // Grab the Set-Cookie header (JSESSIONID) so we can replay it
  // on the POST. Vercel's undici doesn't expose a jar, so we do
  // it by hand from the response headers.
  const setCookie = r.headers.get('set-cookie') ?? ''
  const cookie = setCookie
    .split(/,(?=[^;]+=)/)
    .map((piece) => piece.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
  return { actionUrl, cookie }
}

async function queryCounty(
  actionUrl: string,
  cookie: string,
  countyFips: string,
  days: number,
): Promise<string> {
  const today = new Date()
  const since = new Date(today.getTime() - days * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) =>
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(
      d.getUTCDate(),
    ).padStart(2, '0')}/${d.getUTCFullYear()}`
  const form = new URLSearchParams()
  form.set('methodToCall', 'search')
  form.set('searchArgs.countyCodeHndlr.selectedCodes', countyFips)
  form.set('searchArgs.submittedDtFromHndlr.inputValue', fmt(since))
  form.set('searchArgs.submittedDtToHndlr.inputValue', fmt(today))
  form.set('pager.pageSize', '-1')
  for (const k of BLANK_FIELDS) {
    if (!form.has(k)) form.set(k, '')
  }
  const r = await fetch(actionUrl, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'text/html',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form.toString(),
    redirect: 'follow',
    cache: 'no-store',
  })
  if (!r.ok) {
    throw new Error(`RRC POST ${r.status}: ${r.statusText}`)
  }
  return r.text()
}

// Cheerio port of the Python parse_permit_rows. Same cell-count
// filter (14 direct-child <td>s per result row) so we discard
// pager / header rows cleanly.
function parsePermitRows(html: string, countyFips: string): ParsedPermit[] {
  const $ = cheerio.load(html)
  const grid = $('table.DataGrid').first()
  if (!grid.length) return []
  const permits: ParsedPermit[] = []
  grid.find('tr').each((_, tr) => {
    const $tr = $(tr)
    // Direct-child <td>s only — RRC's cells sometimes wrap inner
    // tables and we don't want those counted.
    const tds = $tr.children('td')
    if (tds.length !== 14) return
    const cellText = (i: number) =>
      cleanText($(tds[i]).text().replace(/\s+/g, ' ')) ?? ''

    const apiText = cellText(0)
    const apiMatch = apiText.match(/(\d{7,8})/)
    const api = apiMatch ? normalizeApi(apiMatch[1]) : null
    if (!api) return

    const leaseName = cellText(2) || null
    const operatorRaw = cellText(4)
    const operatorName =
      operatorRaw.replace(/\s*\(\d{4,7}\)\s*$/, '') || null

    const dates = cellText(6)
    const subMatch = dates.match(/Submitted:\s*(\d{2}\/\d{2}\/\d{4})/)
    const appMatch = dates.match(/Approved:\s*(\d{2}\/\d{2}\/\d{4})/)
    const submitted = subMatch ? parseUsDate(subMatch[1]) : null
    const approved = appMatch ? parseUsDate(appMatch[1]) : null

    const permitNumber = cellText(7) || null
    const typeParts = [cellText(8), cellText(9)].filter(Boolean)
    const permitType = typeParts.length ? typeParts.join(' · ') : null
    let status: string | null = cellText(13).toUpperCase() || null
    if (status && status.length > 32) status = status.slice(0, 32)

    // The lease-name cell wraps its text in an <a> pointing at
    // the permit detail page. Grab the href so we can enrich this
    // row later with the abstract number + lat/lon that RRC's
    // detail page carries but the search results don't.
    let detailUrl: string | null = null
    const leaseHref = $(tds[2]).find('a').attr('href')
    if (leaseHref) {
      // Result HREFs are relative (e.g.
      // 'drillingPermitDetailAction.do?methodToCall=...'). Resolve
      // against the EWA base so the detail fetch can use a full URL.
      detailUrl = leaseHref.startsWith('http')
        ? leaseHref
        : `${BASE}/EWA/${leaseHref.replace(/^\//, '')}`
    }

    permits.push({
      api_number: api,
      permit_number: permitNumber,
      operator_name: operatorName,
      lease_name: leaseName,
      county_code: countyFips,
      permit_type: permitType,
      status,
      filed_date: submitted,
      approved_date: approved,
      abstract_number: null,
      latitude: null,
      longitude: null,
      detail_url: detailUrl,
    })
  })
  return permits
}

// Fetch a permit's detail page and extract the abstract number,
// section, block, survey, and lat/lon. Returns null on any
// failure so the permit still gets upserted with search-page
// data. Called with a concurrency cap in enrichPermitsWithDetail
// below.
type PermitDetail = {
  abstract_number: string | null
  latitude: number | null
  longitude: number | null
}
async function fetchPermitDetail(
  detailUrl: string,
  cookie: string,
): Promise<PermitDetail | null> {
  try {
    const r = await fetch(detailUrl, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      redirect: 'follow',
      cache: 'no-store',
    })
    if (!r.ok) return null
    const html = await r.text()
    // Hidden input carries the abstract number as a plain integer
    // ("274"). We normalize to a bare-digit string; the sidebar
    // callers add the "A-" prefix themselves.
    const absMatch = html.match(
      /name="detailRecord\.abstractNumberHndlr\.inputValue"[^>]*value="([^"]+)"/i,
    )
    const abstract_number = absMatch ? cleanText(absMatch[1]) : null
    // Lat/lon live in visible <b>Latitude:</b> / <b>Longitude:</b>
    // spans. Values are plain decimals.
    const latMatch = html.match(
      /<b>\s*Latitude:\s*(?:&nbsp;)?\s*<\/b>\s*([-\d.]+)/i,
    )
    const lonMatch = html.match(
      /<b>\s*Longitude:\s*(?:&nbsp;)?\s*<\/b>\s*([-\d.]+)/i,
    )
    const lat = latMatch ? Number(latMatch[1]) : NaN
    const lon = lonMatch ? Number(lonMatch[1]) : NaN
    return {
      abstract_number,
      latitude: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
      longitude: Number.isFinite(lon) && lon >= -180 && lon <= 180 ? lon : null,
    }
  } catch {
    return null
  }
}

// Enrich each permit with abstract_number + lat/lon from its
// detail page. Skips permits that already have abstract_number
// set (either from a prior compute pass or from a preceding
// enrichment run — reduces credit / RRC load on repeat runs).
// Concurrency cap of 4 balances throughput vs RRC-friendliness:
// 12 counties x ~50 permits = ~600 detail fetches per run;
// serialized would blow the 300s Vercel maxDuration.
async function enrichPermitsWithDetail(
  permits: ParsedPermit[],
  cookie: string,
  existingAbstracts: Map<string, string>,
): Promise<{ enriched: number; skipped: number; failed: number }> {
  const CONCURRENCY = 4
  let enriched = 0
  let skipped = 0
  let failed = 0

  // Filter: skip permits with no detail URL, and skip permits
  // that already have an abstract in the DB from a prior run.
  const queue = permits.filter((p) => {
    if (!p.detail_url) return false
    const priorAbstract = existingAbstracts.get(p.api_number)
    if (priorAbstract) {
      // Backfill the permit record with the prior abstract so the
      // upsert doesn't null it out on the update path.
      p.abstract_number = priorAbstract
      skipped += 1
      return false
    }
    return true
  })

  let idx = 0
  const worker = async () => {
    while (true) {
      const my = idx++
      if (my >= queue.length) return
      const permit = queue[my]
      const detail = await fetchPermitDetail(permit.detail_url!, cookie)
      if (detail && (detail.abstract_number || detail.latitude !== null)) {
        permit.abstract_number = detail.abstract_number
        permit.latitude = detail.latitude
        permit.longitude = detail.longitude
        enriched += 1
      } else {
        failed += 1
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
  )
  return { enriched, skipped, failed }
}

// Look up existing rows by api_number so we can decide insert vs
// update. Also returns each row's existing abstract_number so
// enrichPermitsWithDetail can skip permits that are already
// resolved from a prior compute run or detail-fetch. Same 1000-row
// paginated approach the Python scraper uses to sidestep the JS
// client's default cap.
async function existingByApi(
  supabase: LooseSupabase,
  table: string,
): Promise<{
  idByApi: Map<string, number>
  abstractByApi: Map<string, string>
}> {
  const idByApi = new Map<string, number>()
  const abstractByApi = new Map<string, string>()
  let lastId = 0
  while (true) {
    // Attempt with abstract_number; fall back to a smaller select
    // if the county's permits table pre-dates Ticket 1.3.
    let data:
      | Array<{ id: number; api_number: string | null; abstract_number: string | null }>
      | null = null
    let error: { message: string } | null = null
    {
      const res = await supabase
        .from(table)
        .select('id, api_number, abstract_number')
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(1000)
      data = (res.data as typeof data) ?? null
      error = res.error ? { message: res.error.message } : null
    }
    if (error && /column .* does not exist/i.test(error.message)) {
      const res = await supabase
        .from(table)
        .select('id, api_number')
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(1000)
      data = ((res.data as Array<{ id: number; api_number: string | null }>) ?? []).map((r) => ({
        ...r,
        abstract_number: null,
      }))
      error = res.error ? { message: res.error.message } : null
    }
    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('not find') || msg.includes('does not exist')) {
        return { idByApi, abstractByApi }
      }
      throw new Error(error.message)
    }
    if (!data || data.length === 0) break
    for (const row of data) {
      const api = normalizeApi(row.api_number)
      if (!api) continue
      if (!idByApi.has(api)) idByApi.set(api, row.id)
      const abs = cleanText(row.abstract_number)
      if (abs) abstractByApi.set(api, abs)
    }
    lastId = data[data.length - 1].id
    if (data.length < 1000) break
  }
  return { idByApi, abstractByApi }
}

// Strip fields that shouldn't be written to Supabase (`detail_url`
// is scrape-only) and normalize null-vs-undefined for the writes.
// Payload includes abstract_number + latitude + longitude which
// are the tract-resolution fields the /permits page reads.
function permitToPayload(row: ParsedPermit): Record<string, unknown> {
  return {
    api_number: row.api_number,
    permit_number: row.permit_number,
    operator_name: row.operator_name,
    lease_name: row.lease_name,
    county_code: row.county_code,
    permit_type: row.permit_type,
    status: row.status,
    filed_date: row.filed_date,
    approved_date: row.approved_date,
    abstract_number: row.abstract_number,
    latitude: row.latitude,
    longitude: row.longitude,
  }
}

// Minimal payload for update() retries against county tables whose
// Ticket-1.3 schema hasn't landed (no abstract_number / latitude /
// longitude columns). Same shape as the Python scraper's fallback.
function permitToMinimalPayload(row: ParsedPermit): Record<string, unknown> {
  return {
    api_number: row.api_number,
    permit_number: row.permit_number,
    operator_name: row.operator_name,
    lease_name: row.lease_name,
    county_code: row.county_code,
    permit_type: row.permit_type,
    status: row.status,
    filed_date: row.filed_date,
    approved_date: row.approved_date,
  }
}

async function upsertPermits(
  supabase: LooseSupabase,
  table: string,
  rows: ParsedPermit[],
  idByApi: Map<string, number>,
): Promise<{ inserted: number; updated: number }> {
  const toInsert: ParsedPermit[] = []
  const toUpdate: Array<{ id: number; row: ParsedPermit }> = []
  for (const row of rows) {
    const existingId = idByApi.get(row.api_number)
    if (existingId !== undefined) {
      toUpdate.push({ id: existingId, row })
    } else {
      toInsert.push(row)
    }
  }
  let inserted = 0
  const BATCH = 500
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH).map(permitToPayload)
    const { error } = await supabase.from(table).insert(batch)
    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('not find') || msg.includes('does not exist')) {
        return { inserted: 0, updated: 0 }
      }
      // Column-mismatch fallback: retry with minimal payload.
      if (
        msg.includes('column') &&
        (msg.includes('does not exist') || msg.includes('not find'))
      ) {
        const minimalBatch = toInsert.slice(i, i + BATCH).map(permitToMinimalPayload)
        const retry = await supabase.from(table).insert(minimalBatch)
        if (retry.error) throw retry.error
        inserted += batch.length
        continue
      }
      throw error
    }
    inserted += batch.length
  }
  let updated = 0
  for (const { id, row } of toUpdate) {
    const { error } = await supabase.from(table).update(permitToPayload(row)).eq('id', id)
    if (error) {
      const msg = error.message.toLowerCase()
      if (
        msg.includes('column') &&
        (msg.includes('does not exist') || msg.includes('not find'))
      ) {
        const retry = await supabase.from(table).update(permitToMinimalPayload(row)).eq('id', id)
        if (retry.error) throw retry.error
      } else {
        throw error
      }
    }
    updated += 1
  }
  return { inserted, updated }
}

// Per-county report shape returned in the JSON response body.
type CountyReport = {
  county: string
  fips: string
  parsed: number
  inserted: number
  updated: number
  // Detail-enrichment counters. `resolved` = permits that ended
  // this run with an abstract_number set (either freshly fetched
  // from the detail page or inherited from a prior compute /
  // enrichment run). Watching this % over time tells us how many
  // brand-new permits are getting properly linked to tracts.
  enriched?: number
  skipped_enrich?: number
  resolved?: number
  error?: string
}

async function processCounty(
  supabase: LooseSupabase,
  actionUrl: string,
  cookie: string,
  county: string,
  days: number,
): Promise<CountyReport> {
  const fips = COUNTY_FIPS[county]
  if (!fips) {
    return { county, fips: '', parsed: 0, inserted: 0, updated: 0,
      error: `unknown county '${county}'` }
  }
  const table = `${county}_permits`
  try {
    const html = await queryCounty(actionUrl, cookie, fips, days)
    const rows = parsePermitRows(html, fips)
    if (rows.length === 0) {
      return { county, fips, parsed: 0, inserted: 0, updated: 0 }
    }
    // Look up existing DB state ONCE per county so both the
    // detail-enrichment skip check and the upsert insert/update
    // split share the same view.
    const { idByApi, abstractByApi } = await existingByApi(supabase, table)
    const { enriched, skipped } = await enrichPermitsWithDetail(
      rows,
      cookie,
      abstractByApi,
    )
    const { inserted, updated } = await upsertPermits(
      supabase, table, rows, idByApi,
    )
    const resolved = rows.filter((r) => r.abstract_number).length
    return {
      county, fips,
      parsed: rows.length,
      inserted, updated,
      enriched, skipped_enrich: skipped, resolved,
    }
  } catch (exc) {
    return {
      county, fips, parsed: 0, inserted: 0, updated: 0,
      error: exc instanceof Error ? exc.message : String(exc),
    }
  }
}

export async function GET(request: Request) {
  // Vercel Cron sets Authorization: Bearer $CRON_SECRET on every
  // scheduled invocation. Reject if missing/wrong so the endpoint
  // isn't world-callable.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization') || ''
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { ok: false, error: 'supabase env missing' },
      { status: 500 },
    )
  }
  const supabase: LooseSupabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  })

  // Query params for ad-hoc runs. Cron uses defaults.
  const url = new URL(request.url)
  const countyParam = url.searchParams.get('county') || DEFAULT_COUNTIES.join(',')
  const daysParam = Number(url.searchParams.get('days') || '90')
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 90
  const counties = countyParam
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)

  const start = Date.now()
  const { actionUrl, cookie } = await openSearchSession()
  const reports: CountyReport[] = []
  for (const county of counties) {
    const r = await processCounty(supabase, actionUrl, cookie, county, days)
    reports.push(r)
  }
  const elapsedMs = Date.now() - start
  const totalParsed = reports.reduce((s, r) => s + r.parsed, 0)
  const totalInserted = reports.reduce((s, r) => s + r.inserted, 0)
  const totalUpdated = reports.reduce((s, r) => s + r.updated, 0)
  return NextResponse.json({
    ok: true,
    days,
    elapsedMs,
    totals: {
      parsed: totalParsed,
      inserted: totalInserted,
      updated: totalUpdated,
    },
    counties: reports,
  })
}
