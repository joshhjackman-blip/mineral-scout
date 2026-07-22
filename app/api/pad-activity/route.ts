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
    'after_path,week_start,propensity_bump,source,created_at'

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

    const events = countyResults
      .flatMap((r) => (r.data || []) as unknown as PadActivityEvent[])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit)
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

  const events = (data || []) as unknown as PadActivityEvent[]
  const signed = await signPaths(supabase, events, 20)

  return NextResponse.json({
    success: true,
    data: { events, signed },
    error: null,
  })
}
