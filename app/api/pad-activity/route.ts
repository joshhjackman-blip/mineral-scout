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

    const rawEvents = countyResults
      .flatMap((r) => (r.data || []) as unknown as PadActivityEvent[])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit)
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
