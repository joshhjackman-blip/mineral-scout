// Vercel Cron endpoint that scrapes RRC Wellbore Query (Current
// schedule) and upserts metadata into <county>_wells.
//
// Mirrors /api/cron/scrape-permits:
//   - Runs on Vercel (RRC blocks GitHub Actions IPs)
//   - Soft-upsert on api_number (insert new, update existing)
//   - Never nulls out geometry / abstract / well_type / completion_date
//     that came from the shapefile loader
//
// Source: https://webapps2.rrc.texas.gov/EWA/wellboreQueryAction.do
// Export: methodToCall=generateWellboreCriteriaReportCsv (full result
// set; the HTML grid caps ~200 rows even with pageSize=-1).
//
// Status freshness: we shard by wellTypeArg so PRODUCING / SHUT IN /
// INJECTION / etc. land correctly. Operator / lease / rrc_lease_id
// update every run for every Current on-schedule well.
//
// Schedule: 21:00 UTC daily (1h before permits). vercel.json + GH
// Actions curl backup.

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseSupabase = SupabaseClient<any, any, any>

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const BASE = 'https://webapps2.rrc.texas.gov'
const SEARCH_PATH = '/EWA/wellboreQueryAction.do'

const COUNTY_FIPS: Record<string, string> = {
  howard: '227',
  martin: '317',
  // Ready when those county wells tables ship:
  midland: '329',
  glasscock: '173',
  upton: '461',
  reagan: '383',
  crane: '103',
  pecos: '371',
  ward: '475',
  winkler: '495',
  loving: '301',
  reeves: '389',
}

// Active product counties with wells tables today.
const DEFAULT_COUNTIES: string[] = ['howard', 'martin']

// Well-type shards. RRC's Current schedule for Martin exceeds the
// HTML 10k cap; CSV often still returns, but sharding keeps status
// accurate and avoids surprise truncations.
const WELL_TYPE_SHARDS: Array<{ code: string; status: string }> = [
  { code: 'PR', status: 'PRODUCING' },
  { code: 'SH', status: 'SHUT IN' },
  { code: 'SM', status: 'SHUT IN' },
  { code: 'IN', status: 'INJECTION' },
  { code: 'TA', status: 'TEMP ABANDONED' },
  { code: 'AB', status: 'ABANDONED' },
  { code: 'NP', status: 'NO PRODUCTION' },
  { code: 'OB', status: 'OBSERVATION' },
  { code: 'PP', status: 'PARTIAL PLUG' },
  { code: 'DW', status: 'DOMESTIC USE WELL' },
  { code: 'LU', status: 'LEASE USE' },
  { code: 'WS', status: 'WATER SUPPLY' },
  { code: 'OS', status: 'OTHER TYPE SERVICE' },
  { code: 'PF', status: 'PROD FACTOR WELL' },
  { code: 'SD', status: 'SEALED' },
  { code: 'ZZ', status: 'NOT ELIGIBLE FOR ALLOWABLE' },
]

const SEARCH_FIELDS = [
  'searchArgs.apiNoPrefixArg',
  'searchArgs.apiNoSuffixArg',
  'searchArgs.countyCodeArg',
  'searchArgs.districtCodeArg',
  'searchArgs.drillingPermitArg',
  'searchArgs.fieldNumbersArg',
  'searchArgs.leaseNumberArg',
  'searchArgs.leaseTypeArg',
  'searchArgs.operatorNumbersArg',
  'searchArgs.scheduleTypeArg',
  'searchArgs.wellTypeArg',
]

const UA =
  'Mozilla/5.0 (compatible; MineralMap/1.0 wells-scraper; +https://getmineralmap.com)'

type ParsedWell = {
  api_number: string
  rrc_lease_id: string | null
  lease_name: string | null
  operator_name: string | null
  well_status: string
  on_schedule: boolean
}

function normalizeApi(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D+/g, '')
  if (!digits) return null
  const stripped = digits.replace(/^0+/, '')
  return stripped || '0'
}

function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text || null
}

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
  if (!r.ok) throw new Error(`RRC wellbore form load ${r.status}`)
  const html = await r.text()
  const m = html.match(/<form[^>]+action="([^"]+)"/i)
  if (!m) throw new Error('RRC wellbore form not found; layout may have changed')
  const actionUrl = `${BASE}${m[1].replace(/;jsessionid=[^?]*/i, '')}`
  const setCookie = r.headers.get('set-cookie') ?? ''
  const cookie = setCookie
    .split(/,(?=[^;]+=)/)
    .map((piece) => piece.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
  return { actionUrl, cookie }
}

async function postForm(
  actionUrl: string,
  cookie: string,
  fields: Record<string, string>,
): Promise<{ contentType: string; body: string }> {
  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  const r = await fetch(actionUrl, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/vnd.ms-excel,*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form.toString(),
    redirect: 'follow',
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`RRC wellbore POST ${r.status}`)
  const contentType = r.headers.get('content-type') ?? ''
  const body = await r.text()
  return { contentType, body }
}

function blankSearchFields(
  overrides: Record<string, string>,
): Record<string, string> {
  const fields: Record<string, string> = { methodToCall: 'search' }
  for (const k of SEARCH_FIELDS) fields[k] = ''
  Object.assign(fields, overrides)
  return fields
}

/** Parse RRC wellbore criteria CSV export into well rows. */
function parseWellboreCsv(csvText: string, wellStatus: string): ParsedWell[] {
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/)
  const headerIdx = lines.findIndex((line) => {
    const u = line.toUpperCase()
    return u.includes('API') && u.includes('LEASE')
  })
  if (headerIdx < 0) return []

  // Minimal CSV parser that respects quotes (RRC wraps every field).
  const parseLine = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = !inQuotes
        }
        continue
      }
      if (ch === ',' && !inQuotes) {
        out.push(cur)
        cur = ''
        continue
      }
      cur += ch
    }
    out.push(cur)
    return out
  }

  const header = parseLine(lines[headerIdx]).map((h) =>
    h.replace(/^"|"$/g, '').trim().toLowerCase(),
  )
  const idx = (name: string) => header.findIndex((h) => h === name)
  const iApi = idx('api no.')
  const iLeaseNo = idx('lease no.')
  const iLeaseName = idx('lease name')
  const iOperator = idx('operator name')
  const iOnSched = idx('on schedule')
  if (iApi < 0) return []

  const wells: ParsedWell[] = []
  for (let li = headerIdx + 1; li < lines.length; li++) {
    const line = lines[li].trim()
    if (!line || line.startsWith('"Search Criteria')) continue
    const cols = parseLine(line).map((c) => c.replace(/^"|"$/g, '').trim())
    const api = normalizeApi(cols[iApi])
    if (!api) continue
    const onSchedRaw = (iOnSched >= 0 ? cols[iOnSched] : 'Y').toUpperCase()
    const on_schedule = onSchedRaw === 'Y' || onSchedRaw === 'YES'
    wells.push({
      api_number: api,
      rrc_lease_id: iLeaseNo >= 0 ? cleanText(cols[iLeaseNo]) : null,
      lease_name: iLeaseName >= 0 ? cleanText(cols[iLeaseName]) : null,
      operator_name: iOperator >= 0 ? cleanText(cols[iOperator]) : null,
      well_status: wellStatus,
      on_schedule,
    })
  }
  return wells
}

async function fetchShard(
  actionUrl: string,
  cookie: string,
  countyFips: string,
  wellTypeCode: string,
  wellStatus: string,
): Promise<ParsedWell[]> {
  const search = blankSearchFields({
    methodToCall: 'search',
    'searchArgs.countyCodeArg': countyFips,
    'searchArgs.scheduleTypeArg': 'Y', // Current
    'searchArgs.wellTypeArg': wellTypeCode,
  })
  await postForm(actionUrl, cookie, search)

  const csvReq = blankSearchFields({
    methodToCall: 'generateWellboreCriteriaReportCsv',
    'searchArgs.countyCodeArg': countyFips,
    'searchArgs.scheduleTypeArg': 'Y',
    'searchArgs.wellTypeArg': wellTypeCode,
  })
  const { contentType, body } = await postForm(actionUrl, cookie, csvReq)
  if (
    contentType.includes('text/html') &&
    !body.toUpperCase().includes('API NO')
  ) {
    // Empty result / error page — treat as zero rows for this shard.
    if (/no records|0 records|exceed/i.test(body)) return []
    throw new Error(`CSV export returned HTML for wellType=${wellTypeCode}`)
  }
  return parseWellboreCsv(body, wellStatus)
}

async function existingByApi(
  supabase: LooseSupabase,
  table: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  let lastId = 0
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('id, api_number')
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(1000)
    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('not find') || msg.includes('does not exist')) {
        return out
      }
      throw error
    }
    const rows = (data ?? []) as Array<{ id: number; api_number: string | null }>
    if (rows.length === 0) break
    for (const row of rows) {
      const api = normalizeApi(row.api_number)
      if (api) out.set(api, row.id)
      lastId = row.id
    }
    if (rows.length < 1000) break
  }
  return out
}

/** Metadata-only payload — never writes lat/lon/abstract/well_type. */
function wellToUpdatePayload(row: ParsedWell): Record<string, unknown> {
  return {
    operator_name: row.operator_name,
    lease_name: row.lease_name,
    rrc_lease_id: row.rrc_lease_id,
    well_status: row.well_status,
  }
}

function wellToInsertPayload(row: ParsedWell): Record<string, unknown> {
  // Omit geometry / classification columns — shapefile reload fills
  // those. Writing explicit nulls can trip NOT NULL defaults on some
  // county schemas.
  return {
    api_number: row.api_number,
    operator_name: row.operator_name,
    lease_name: row.lease_name,
    rrc_lease_id: row.rrc_lease_id,
    well_status: row.well_status,
  }
}

async function upsertWells(
  supabase: LooseSupabase,
  table: string,
  rows: ParsedWell[],
  idByApi: Map<string, number>,
): Promise<{ inserted: number; updated: number }> {
  // Dedupe by API within the batch (later shard wins — finer statuses
  // like SHUT IN overwrite a stale ACTIVE if we ever mix sources).
  const byApi = new Map<string, ParsedWell>()
  for (const row of rows) byApi.set(row.api_number, row)

  const toInsert: ParsedWell[] = []
  const toUpdate: Array<{ id: number; row: ParsedWell }> = []
  for (const row of Array.from(byApi.values())) {
    const existingId = idByApi.get(row.api_number)
    if (existingId !== undefined) toUpdate.push({ id: existingId, row })
    else toInsert.push(row)
  }

  let inserted = 0
  const BATCH = 200
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH).map(wellToInsertPayload)
    const { data, error } = await supabase.from(table).insert(batch).select('id, api_number')
    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('not find') || msg.includes('does not exist')) {
        return { inserted: 0, updated: 0 }
      }
      // Retry without nullable geometry columns if schema is thinner.
      if (msg.includes('column')) {
        const slim = toInsert.slice(i, i + BATCH).map((row) => ({
          api_number: row.api_number,
          operator_name: row.operator_name,
          lease_name: row.lease_name,
          rrc_lease_id: row.rrc_lease_id,
          well_status: row.well_status,
        }))
        const retry = await supabase.from(table).insert(slim).select('id, api_number')
        if (retry.error) throw retry.error
        for (const r of (retry.data ?? []) as Array<{ id: number; api_number: string }>) {
          const api = normalizeApi(r.api_number)
          if (api) idByApi.set(api, r.id)
        }
        inserted += slim.length
        continue
      }
      throw error
    }
    for (const r of (data ?? []) as Array<{ id: number; api_number: string }>) {
      const api = normalizeApi(r.api_number)
      if (api) idByApi.set(api, r.id)
    }
    inserted += batch.length
  }

  let updated = 0
  for (const { id, row } of toUpdate) {
    const { error } = await supabase
      .from(table)
      .update(wellToUpdatePayload(row))
      .eq('id', id)
    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('column')) {
        const retry = await supabase
          .from(table)
          .update({
            operator_name: row.operator_name,
            lease_name: row.lease_name,
            well_status: row.well_status,
          })
          .eq('id', id)
        if (retry.error) throw retry.error
      } else {
        throw error
      }
    }
    updated += 1
  }
  return { inserted, updated }
}

type CountyReport = {
  county: string
  fips: string
  parsed: number
  inserted: number
  updated: number
  shards: Array<{ code: string; parsed: number }>
  error?: string
}

async function processCounty(
  supabase: LooseSupabase,
  actionUrl: string,
  cookie: string,
  county: string,
): Promise<CountyReport> {
  const fips = COUNTY_FIPS[county]
  if (!fips) {
    return {
      county,
      fips: '',
      parsed: 0,
      inserted: 0,
      updated: 0,
      shards: [],
      error: `unknown county '${county}'`,
    }
  }
  const table = `${county}_wells`
  const shards: Array<{ code: string; parsed: number }> = []
  const allRows: ParsedWell[] = []

  try {
    for (const shard of WELL_TYPE_SHARDS) {
      try {
        const rows = await fetchShard(
          actionUrl,
          cookie,
          fips,
          shard.code,
          shard.status,
        )
        shards.push({ code: shard.code, parsed: rows.length })
        allRows.push(...rows)
      } catch (exc) {
        shards.push({ code: shard.code, parsed: 0 })
        // Keep going — one empty/broken type shouldn't kill the county.
        console.warn(
          `[scrape-wells] ${county} type=${shard.code}:`,
          exc instanceof Error ? exc.message : exc,
        )
      }
    }

    if (allRows.length === 0) {
      return { county, fips, parsed: 0, inserted: 0, updated: 0, shards }
    }

    const idByApi = await existingByApi(supabase, table)
    if (idByApi.size === 0) {
      // Table missing or empty + select failed soft. Still try insert.
    }
    const { inserted, updated } = await upsertWells(
      supabase,
      table,
      allRows,
      idByApi,
    )
    return {
      county,
      fips,
      parsed: allRows.length,
      inserted,
      updated,
      shards,
    }
  } catch (exc) {
    return {
      county,
      fips,
      parsed: 0,
      inserted: 0,
      updated: 0,
      shards,
      error: exc instanceof Error ? exc.message : String(exc),
    }
  }
}

export async function GET(request: Request) {
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

  const url = new URL(request.url)
  const countyParam =
    url.searchParams.get('county') || DEFAULT_COUNTIES.join(',')
  const counties = countyParam
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)

  const start = Date.now()
  const { actionUrl, cookie } = await openSearchSession()
  const reports: CountyReport[] = []
  for (const county of counties) {
    reports.push(await processCounty(supabase, actionUrl, cookie, county))
  }

  return NextResponse.json({
    ok: true,
    schedule: 'current',
    elapsedMs: Date.now() - start,
    totals: {
      parsed: reports.reduce((s, r) => s + r.parsed, 0),
      inserted: reports.reduce((s, r) => s + r.inserted, 0),
      updated: reports.reduce((s, r) => s + r.updated, 0),
    },
    counties: reports,
  })
}
