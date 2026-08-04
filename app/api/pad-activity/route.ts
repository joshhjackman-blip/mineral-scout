import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PadActivityEvent = {
  id: number
  county_id: string
  rrc_lease_id: string | null
  api_number: string | null
  abstract_number: string | null
  owner_name: string | null
  lease_name: string | null
  operator_name: string | null
  signature: string
  confidence: number
  change_score: number | null
  summary: string
  before_path: string | null
  after_path: string | null
  week_start: string
  propensity_bump: number
  source: string
  created_at: string
  raw?: Record<string, unknown> | null
  latitude?: number | null
  longitude?: number | null
}

function normalizeLeaseId(raw: string | null | undefined): string {
  const text = String(raw || '').trim()
  return text.replace(/^0+/, '') || text
}

function finiteCoord(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Fill missing abstract / lease / coords so leads + map deep-links + Sentinel work. */
async function hydrateAbstracts(
  supabase: NonNullable<ReturnType<typeof adminClient>>,
  events: PadActivityEvent[],
): Promise<PadActivityEvent[]> {
  if (events.length === 0) return events

  // 1) Fill missing rrc_lease_id / lat/lon from wells by api_number.
  const needWell = events.filter(
    (e) => e.api_number && (!e.rrc_lease_id || finiteCoord((e.raw as { latitude?: unknown } | null)?.latitude) == null),
  )
  const apiToWell = new Map<string, { rrc_lease_id: string | null; latitude: number | null; longitude: number | null; abstract: string | null }>()
  await Promise.all(
    needWell.map(async (ev) => {
      const key = `${ev.county_id}::${ev.api_number}`
      if (apiToWell.has(key)) return
      try {
        const { data } = await supabase
          .from(`${ev.county_id}_wells`)
          .select('rrc_lease_id,latitude,longitude,abstract')
          .eq('api_number', ev.api_number!)
          .limit(1)
        const row = data?.[0]
        apiToWell.set(key, {
          rrc_lease_id: row?.rrc_lease_id != null ? String(row.rrc_lease_id) : null,
          latitude: finiteCoord(row?.latitude),
          longitude: finiteCoord(row?.longitude),
          abstract: row?.abstract != null ? String(row.abstract).trim() : null,
        })
      } catch {
        apiToWell.set(key, { rrc_lease_id: null, latitude: null, longitude: null, abstract: null })
      }
    }),
  )

  const withWells = events.map((ev) => {
    const raw = { ...((ev.raw || {}) as Record<string, unknown>) }
    const well = ev.api_number ? apiToWell.get(`${ev.county_id}::${ev.api_number}`) : null
    const rrc_lease_id = ev.rrc_lease_id || well?.rrc_lease_id || null
    const abstract_number = ev.abstract_number || well?.abstract || null
    if (well?.latitude != null && finiteCoord(raw.latitude) == null) raw.latitude = well.latitude
    if (well?.longitude != null && finiteCoord(raw.longitude) == null) raw.longitude = well.longitude
    return { ...ev, rrc_lease_id, abstract_number, raw }
  })

  // 1b) Existing RRC events often stored lat/lon only on the permit row, not
  // in event.raw. Pull coords (and abstract) from {county}_permits so on-demand
  // Sentinel chips have a point to query.
  const needPermit = withWells.filter((e) => {
    const raw = (e.raw || {}) as Record<string, unknown>
    const missingCoords = finiteCoord(raw.latitude) == null || finiteCoord(raw.longitude) == null
    const permit = String(raw.permit_number || '').trim()
    return missingCoords && Boolean(e.api_number || permit)
  })
  const permitCoords = new Map<string, { latitude: number | null; longitude: number | null; abstract: string | null }>()
  await Promise.all(
    needPermit.map(async (ev) => {
      const raw = (ev.raw || {}) as Record<string, unknown>
      const permit = String(raw.permit_number || '').trim()
      const key = `${ev.county_id}::${ev.api_number || ''}::${permit}`
      if (permitCoords.has(key)) return
      try {
        let query = supabase
          .from(`${ev.county_id}_permits`)
          .select('latitude,longitude,abstract_number,api_number,permit_number')
          .limit(1)
        if (ev.api_number) query = query.eq('api_number', ev.api_number)
        else query = query.eq('permit_number', permit)
        const { data } = await query
        const row = data?.[0]
        permitCoords.set(key, {
          latitude: finiteCoord(row?.latitude),
          longitude: finiteCoord(row?.longitude),
          abstract: row?.abstract_number != null ? String(row.abstract_number).trim() : null,
        })
      } catch {
        permitCoords.set(key, { latitude: null, longitude: null, abstract: null })
      }
    }),
  )

  const withPermits = withWells.map((ev) => {
    const raw = { ...((ev.raw || {}) as Record<string, unknown>) }
    const permit = String(raw.permit_number || '').trim()
    const hit = permitCoords.get(`${ev.county_id}::${ev.api_number || ''}::${permit}`)
    if (hit?.latitude != null && finiteCoord(raw.latitude) == null) raw.latitude = hit.latitude
    if (hit?.longitude != null && finiteCoord(raw.longitude) == null) raw.longitude = hit.longitude
    const abstract_number = ev.abstract_number || hit?.abstract || null
    return { ...ev, abstract_number, raw }
  })

  // 2) Fill missing abstract from ownership via normalized lease id.
  const missing = withPermits.filter((e) => !e.abstract_number && e.rrc_lease_id)
  const leaseToAbstract = new Map<string, string>()
  await Promise.all(
    missing.map(async (ev) => {
      const lease = normalizeLeaseId(ev.rrc_lease_id)
      const key = `${ev.county_id}::${lease}`
      if (!lease || leaseToAbstract.has(key)) return
      try {
        const { data } = await supabase
          .from(`${ev.county_id}_mineral_ownership`)
          .select('abstract')
          .eq('rrc_lease_id', lease)
          .not('abstract', 'is', null)
          .limit(1)
        const abs = String(data?.[0]?.abstract || '').trim()
        if (abs) leaseToAbstract.set(key, abs)
      } catch {
        // ignore
      }
    }),
  )

  return withPermits.map((ev) => {
    const raw = (ev.raw || {}) as Record<string, unknown>
    const lat = finiteCoord(raw.latitude)
    const lon = finiteCoord(raw.longitude)
    const lease = normalizeLeaseId(ev.rrc_lease_id)
    const abs =
      ev.abstract_number ||
      (lease ? leaseToAbstract.get(`${ev.county_id}::${lease}`) : null) ||
      null
    return {
      ...ev,
      abstract_number: abs,
      latitude: lat,
      longitude: lon,
    }
  })
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

function parseDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null
  const d = new Date(String(raw))
  return Number.isFinite(d.getTime()) ? d : null
}

function mondayOf(d: Date): string {
  const copy = new Date(d)
  const day = copy.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setUTCDate(copy.getUTCDate() + diff)
  return copy.toISOString().slice(0, 10)
}

/**
 * Live RRC bridge for the Pad Ops desk when `pad_activity_events` is empty
 * (weekly job not run recently). Mirrors scripts/pad_activity/rrc_bridge.py
 * so brokers still see approved / spud / completion signals.
 */
async function liveRrcSignals(
  supabase: NonNullable<ReturnType<typeof adminClient>>,
  counties: string[],
  days: number,
  limit: number,
): Promise<PadActivityEvent[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const weekStart = mondayOf(new Date())
  const out: PadActivityEvent[] = []
  let synthId = -1

  for (const countyId of counties) {
    const table = `${countyId}_permits`
    // Pull a wide recent slice, then filter client-side across the four
    // date columns (PostgREST OR across nullable dates is brittle).
    const pageSize = Math.max(80, Math.ceil((limit * 3) / Math.max(counties.length, 1)))
    const { data, error } = await supabase
      .from(table)
      .select(
        'permit_number,api_number,operator_name,lease_name,abstract_number,latitude,longitude,permit_type,status,filed_date,approved_date,spud_date,completion_date',
      )
      .order('id', { ascending: false })
      .limit(pageSize)

    if (error || !data) continue

    const claimed = new Set<string>()
    type PermitRow = {
      permit_number?: string | null
      api_number?: string | null
      operator_name?: string | null
      lease_name?: string | null
      abstract_number?: string | null
      latitude?: number | null
      longitude?: number | null
      permit_type?: string | null
      status?: string | null
      filed_date?: string | null
      approved_date?: string | null
      spud_date?: string | null
      completion_date?: string | null
    }

    const inWindow = (row: PermitRow): boolean => {
      for (const key of ['completion_date', 'spud_date', 'approved_date', 'filed_date'] as const) {
        const d = parseDate(row[key])
        if (d && d >= since) return true
      }
      return false
    }

    const push = (
      row: PermitRow,
      signature: string,
      confidence: number,
      summary: string,
      signalDate: Date,
    ) => {
      const api = String(row.api_number || '').trim() || null
      const permit = String(row.permit_number || '').trim()
      const key = api || (permit ? `permit:${permit}` : null)
      if (key && claimed.has(key)) return
      if (key) claimed.add(key)
      const lat = row.latitude != null ? Number(row.latitude) : null
      const lon = row.longitude != null ? Number(row.longitude) : null
      out.push({
        id: synthId--,
        county_id: countyId,
        rrc_lease_id: null,
        api_number: api,
        abstract_number: String(row.abstract_number || '').trim() || null,
        owner_name: null,
        lease_name: String(row.lease_name || '').trim() || null,
        operator_name: String(row.operator_name || '').trim() || null,
        signature,
        confidence,
        change_score: null,
        summary,
        before_path: null,
        after_path: null,
        week_start: weekStart,
        propensity_bump: signature === 'RRC_COMPLETION' ? 8 : signature === 'RIG_MOVE_IN' ? 5 : 3,
        source: 'rrc_live',
        created_at: signalDate.toISOString(),
        raw: {
          permit_number: permit || null,
          approved_date: row.approved_date,
          filed_date: row.filed_date,
          spud_date: row.spud_date,
          completion_date: row.completion_date,
          latitude: Number.isFinite(lat as number) ? lat : null,
          longitude: Number.isFinite(lon as number) ? lon : null,
          live_bridge: true,
        },
        latitude: Number.isFinite(lat as number) ? lat : null,
        longitude: Number.isFinite(lon as number) ? lon : null,
      })
    }

    const recent = (data as PermitRow[]).filter(inWindow)

    // Pass 1 — completions
    for (const row of recent) {
      const completion = parseDate(row.completion_date)
      if (!completion || completion < since) continue
      const lease = String(row.lease_name || '').trim() || 'this lease'
      const api = String(row.api_number || '').trim()
      push(
        row,
        'RRC_COMPLETION',
        0.85,
        `RRC filing shows completion ${completion.toISOString().slice(0, 10)} on ${lease}` +
          `${api ? ` (API ${api})` : ''}. Production / payout window — prioritize outreach.`,
        completion,
      )
    }

    // Pass 2 — spuds (not yet completed)
    for (const row of recent) {
      const spud = parseDate(row.spud_date)
      const completion = parseDate(row.completion_date)
      if (!spud || spud < since || completion) continue
      const lease = String(row.lease_name || '').trim() || 'this lease'
      const api = String(row.api_number || '').trim()
      push(
        row,
        'RIG_MOVE_IN',
        0.7,
        `Spud ${spud.toISOString().slice(0, 10)} on ${lease}` +
          `${api ? ` (API ${api})` : ''}. Drilling underway — watch for completion crew.`,
        spud,
      )
    }

    // Pass 3 — approved / filed permits
    for (const row of recent) {
      const approved = parseDate(row.approved_date)
      const filed = parseDate(row.filed_date)
      const signal =
        approved && approved >= since ? approved : filed && filed >= since ? filed : null
      if (!signal) continue
      const kind = approved && signal.getTime() === approved.getTime() ? 'approved' : 'filed'
      const lease = String(row.lease_name || '').trim() || 'this lease'
      const permit = String(row.permit_number || '').trim()
      push(
        row,
        'RRC_APPROVED',
        kind === 'approved' ? 0.65 : 0.55,
        `Drilling permit ${kind} ${signal.toISOString().slice(0, 10)} on ${lease}` +
          `${permit ? ` (#${permit})` : ''}. Operator commitment — early outreach window.`,
        signal,
      )
    }
  }

  return out
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit)
}

async function signPaths(
  supabase: NonNullable<ReturnType<typeof adminClient>>,
  events: PadActivityEvent[],
  maxPaths = 40,
): Promise<Record<string, string>> {
  const signed: Record<string, string> = {}
  const paths = Array.from(
    new Set(
      events.flatMap((e) => [e.before_path, e.after_path].filter(Boolean) as string[]),
    ),
  )
  for (const path of paths.slice(0, maxPaths)) {
    try {
      const { data: signedData, error: signErr } = await supabase.storage
        .from('Raw-Data')
        .createSignedUrl(path, 60 * 60)
      if (!signErr && signedData?.signedUrl) {
        signed[path] = signedData.signedUrl
      }
    } catch {
      // ignore missing objects
    }
  }
  return signed
}

/**
 * GET /api/pad-activity?county=howard&abstract=543
 * GET /api/pad-activity?county=howard&owner=SMITH%20JOHN
 * GET /api/pad-activity?mode=list&counties=howard,martin&days=30
 *
 * Drawer queries use county + abstract/owner.
 * The /pad-activity page uses mode=list for the feed of recent events.
 */
export async function GET(request: NextRequest) {
  const supabase = adminClient()
  if (!supabase) {
    return NextResponse.json(
      { success: false, data: null, error: 'supabase env missing' },
      { status: 500 },
    )
  }

  const { searchParams } = new URL(request.url)
  const mode = (searchParams.get('mode') || '').trim().toLowerCase()
  const county = (searchParams.get('county') || '').trim().toLowerCase()
  const abstract = (searchParams.get('abstract') || '').trim()
  const owner = (searchParams.get('owner') || '').trim()
  const limit = Math.min(Number(searchParams.get('limit') || (mode === 'list' ? '100' : '10')) || 10, 200)

  const selectCols =
    'id,county_id,rrc_lease_id,api_number,abstract_number,owner_name,lease_name,' +
    'operator_name,signature,confidence,change_score,summary,before_path,' +
    'after_path,week_start,propensity_bump,source,created_at,raw'

  // ── List feed for /pad-activity page ─────────────────────────────
  if (mode === 'list') {
    const countiesParam = (searchParams.get('counties') || 'howard,martin').trim()
    const counties = countiesParam
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean)
    const days = Math.min(Math.max(Number(searchParams.get('days') || '90') || 90, 1), 365)
    // Prefer created_at for the window — every Phase-1 row is stamped
    // with the current Monday as week_start, so filtering on week_start
    // collapses "last 90 days of permit activity" into "detected this
    // week". created_at matches when the weekly job wrote the event.
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const signature = (searchParams.get('signature') || '').trim()

    // IMPORTANT: do NOT use .in('county_id', [...]) here. On this
    // Supabase project that filter silently returns [] for some
    // date windows (observed 2026-07-22: howard,martin + days=90
    // → 0 rows; same query per-county with .eq → 100 rows each).
    // Fan out with .eq per county and merge.
    const perCountyLimit = Math.max(20, Math.ceil(limit / Math.max(counties.length, 1)))
    const countyResults = await Promise.all(
      (counties.length > 0 ? counties : ['howard', 'martin']).map(async (countyId) => {
        let query = supabase
          .from('pad_activity_events')
          .select(selectCols)
          .eq('county_id', countyId)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(perCountyLimit)
        if (signature && signature !== 'all') {
          query = query.eq('signature', signature)
        }
        return query
      }),
    )

    const errors = countyResults
      .map((r) => r.error)
      .filter(Boolean)
    if (errors.length === countyResults.length && errors[0]) {
      const message = errors[0].message || 'query failed'
      const missing =
        /pad_activity_events/i.test(message) ||
        /does not exist/i.test(message) ||
        errors[0].code === '42P01'
      return NextResponse.json({
        success: true,
        data: { events: [], signed: {}, leads: [], days },
        error: missing ? null : message,
      })
    }

    let rawEvents = countyResults
      .flatMap((r) => (r.data || []) as unknown as PadActivityEvent[])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit)

    // Desk stays empty when the weekly pad job hasn't written rows.
    // Bridge live RRC permit activity so Pad Ops always has signals.
    let feedSource: 'pad_activity_events' | 'rrc_live' | 'mixed' = 'pad_activity_events'
    if (rawEvents.length === 0) {
      let live = await liveRrcSignals(supabase, counties, days, limit)
      if (signature && signature !== 'all') {
        live = live.filter((e) => e.signature === signature)
      }
      rawEvents = live
      feedSource = 'rrc_live'
    }

    const events = await hydrateAbstracts(supabase, rawEvents)
    const signed = await signPaths(supabase, events)

    // Unique leads affected (owner_name + county), newest first.
    const leadMap = new Map<string, {
      owner_name: string
      county_id: string
      event_count: number
      latest_signature: string
      latest_week: string
      abstracts: string[]
      propensity_bump_total: number
    }>()
    for (const ev of events) {
      const name = (ev.owner_name || '').trim()
      if (!name) continue
      const key = `${ev.county_id}::${name.toUpperCase()}`
      const existing = leadMap.get(key)
      if (!existing) {
        leadMap.set(key, {
          owner_name: name,
          county_id: ev.county_id,
          event_count: 1,
          latest_signature: ev.signature,
          latest_week: ev.week_start,
          abstracts: ev.abstract_number ? [ev.abstract_number] : [],
          propensity_bump_total: ev.propensity_bump || 0,
        })
      } else {
        existing.event_count += 1
        existing.propensity_bump_total += ev.propensity_bump || 0
        if (ev.abstract_number && !existing.abstracts.includes(ev.abstract_number)) {
          existing.abstracts.push(ev.abstract_number)
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        events,
        signed,
        leads: Array.from(leadMap.values()),
        days,
        feed_source: feedSource,
      },
      error: null,
    })
  }

  // ── Drawer query (county + abstract|owner) ───────────────────────
  if (!county) {
    return NextResponse.json(
      { success: false, data: null, error: 'county required' },
      { status: 400 },
    )
  }
  if (!abstract && !owner) {
    return NextResponse.json(
      { success: false, data: null, error: 'abstract or owner required (or use mode=list)' },
      { status: 400 },
    )
  }

  let query = supabase
    .from('pad_activity_events')
    .select(selectCols)
    .eq('county_id', county)
    .order('week_start', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (abstract) {
    const bare = abstract.replace(/^A-/i, '').replace(/^0+/, '') || abstract
    query = query.or(`abstract_number.eq.${bare},abstract_number.eq.${abstract}`)
  } else if (owner) {
    query = query.eq('owner_name', owner)
  }

  const { data, error } = await query
  if (error) {
    const missing =
      /pad_activity_events/i.test(error.message) ||
      /does not exist/i.test(error.message) ||
      error.code === '42P01'
    return NextResponse.json({
      success: true,
      data: { events: [] as PadActivityEvent[], signed: {} },
      error: missing ? null : error.message,
    })
  }

  const events = await hydrateAbstracts(
    supabase,
    (data || []) as unknown as PadActivityEvent[],
  )
  const signed = await signPaths(supabase, events, 20)

  return NextResponse.json({
    success: true,
    data: { events, signed },
    error: null,
  })
}
