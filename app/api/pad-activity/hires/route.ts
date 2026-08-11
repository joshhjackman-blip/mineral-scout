import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, padImageryProxyUrl } from '@/lib/supabase-admin'
import { requireApiUser } from '@/lib/api-auth'
import {
  hiresStoragePath,
  padKeyFromEvent,
  pullHiresChip,
} from '@/lib/pad-hires'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function adminClient() {
  return createAdminClient()
}

async function resolveCoords(
  supabase: NonNullable<ReturnType<typeof adminClient>>,
  seed: {
    county_id: string
    api_number: string | null
    raw: Record<string, unknown> | null
  },
): Promise<{ lat: number; lon: number } | null> {
  const raw = seed.raw || {}
  const lat0 = Number(raw.latitude)
  const lon0 = Number(raw.longitude)
  if (Number.isFinite(lat0) && Number.isFinite(lon0)) {
    return { lat: lat0, lon: lon0 }
  }
  if (!seed.api_number) return null
  try {
    const { data } = await supabase
      .from(`${seed.county_id}_wells`)
      .select('latitude,longitude')
      .eq('api_number', seed.api_number)
      .limit(1)
    const lat = Number(data?.[0]?.latitude)
    const lon = Number(data?.[0]?.longitude)
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon }
  } catch {
    // ignore
  }
  return null
}

/**
 * POST /api/pad-activity/hires
 * Body: { event_id: number, force?: boolean }
 *
 * Pulls current Mapbox Satellite (preferred) or NAIP survey fallback,
 * stores PNG in Raw-Data, stamps sibling events with raw.hires_*.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiUser(request)
  if (gate.error) return gate.error

  const supabase = adminClient()
  if (!supabase) {
    return NextResponse.json(
      { success: false, data: null, error: 'supabase env missing' },
      { status: 500 },
    )
  }

  let body: {
    event_id?: number
    force?: boolean
    lat?: number
    lon?: number
    county_id?: string
    api_number?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: 'invalid JSON body' },
      { status: 400 },
    )
  }

  const eventId = Number(body.event_id)
  const force = Boolean(body.force)
  const directLat = Number(body.lat)
  const directLon = Number(body.lon)
  const hasDirectCoords = Number.isFinite(directLat) && Number.isFinite(directLon)

  // Live RRC bridge cards use synthetic negative ids — allow lat/lon body.
  if ((!eventId || eventId < 1) && !hasDirectCoords) {
    return NextResponse.json(
      { success: false, data: null, error: 'event_id or lat/lon required' },
      { status: 400 },
    )
  }

  type Seed = {
    id: number
    county_id: string
    api_number: string | null
    rrc_lease_id: string | null
    abstract_number: string | null
    week_start: string
    source: string
    signature: string | null
    raw: Record<string, unknown> | null
  }

  let seed: Seed | null = null
  if (eventId > 0) {
    const { data, error: seedErr } = await supabase
      .from('pad_activity_events')
      .select(
        'id,county_id,api_number,rrc_lease_id,abstract_number,week_start,source,signature,raw',
      )
      .eq('id', eventId)
      .maybeSingle()

    if (seedErr || !data) {
      return NextResponse.json(
        { success: false, data: null, error: seedErr?.message || 'event not found' },
        { status: 404 },
      )
    }
    seed = data as Seed
  } else {
    seed = {
      id: 0,
      county_id: String(body.county_id || 'howard'),
      api_number: body.api_number ? String(body.api_number) : null,
      rrc_lease_id: null,
      abstract_number: null,
      week_start: new Date().toISOString().slice(0, 10),
      source: 'rrc_live',
      signature: null,
      raw: { latitude: directLat, longitude: directLon },
    }
  }

  const existingRaw = (seed.raw as Record<string, unknown>) || {}
  const existingSource = String(existingRaw.hires_source || '')
  // Reuse cache only for current Mapbox pulls — never stick on stale NAIP.
  const cacheOk =
    !force &&
    typeof existingRaw.hires_path === 'string' &&
    existingRaw.hires_path &&
    existingSource === 'mapbox-satellite'

  if (cacheOk) {
    return NextResponse.json({
      success: true,
      data: {
        hires_path: existingRaw.hires_path,
        hires_date: existingRaw.hires_date ?? null,
        hires_source: existingSource,
        hires_label: existingRaw.hires_label ?? null,
        signed_url: padImageryProxyUrl(String(existingRaw.hires_path)),
        cached: true,
      },
      error: null,
    })
  }

  const coords = hasDirectCoords
    ? { lat: directLat, lon: directLon }
    : await resolveCoords(supabase, {
        county_id: seed.county_id,
        api_number: seed.api_number,
        raw: existingRaw,
      })
  if (!coords) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'No lat/lon on this event — cannot request hi-res imagery',
      },
      { status: 422 },
    )
  }

  let chip: Awaited<ReturnType<typeof pullHiresChip>>
  try {
    chip = await pullHiresChip(coords.lon, coords.lat)
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: err instanceof Error ? err.message : 'Hi-res pull failed',
      },
      { status: 502 },
    )
  }

  const padKey = padKeyFromEvent(seed)
  const storagePath = hiresStoragePath(
    seed.county_id,
    padKey,
    chip.imageryDate,
    chip.source,
  )

  const { error: upErr } = await supabase.storage.from('Raw-Data').upload(storagePath, chip.png, {
    contentType: 'image/png',
    upsert: true,
  })
  if (upErr) {
    return NextResponse.json(
      { success: false, data: null, error: `storage upload failed: ${upErr.message}` },
      { status: 500 },
    )
  }

  try {
    let del = supabase
      .from('pad_imagery_log')
      .delete()
      .eq('county_id', seed.county_id)
      .eq('imagery_date', chip.imageryDate)
      .eq('source', chip.source)
    if (seed.api_number) del = del.eq('api_number', seed.api_number)
    else if (seed.rrc_lease_id) del = del.eq('rrc_lease_id', seed.rrc_lease_id)
    await del
    await supabase.from('pad_imagery_log').insert({
      county_id: seed.county_id,
      rrc_lease_id: seed.rrc_lease_id,
      api_number: seed.api_number,
      abstract_number: seed.abstract_number,
      imagery_date: chip.imageryDate,
      cloud_cover: null,
      storage_path: storagePath,
      source: chip.source,
    })
  } catch {
    // Soft-fail — chip is already in Storage.
  }

  const hiresMeta = {
    hires_path: storagePath,
    hires_date: chip.imageryDate,
    hires_source: chip.source,
    hires_label: chip.label,
    hires_item_id: chip.itemId,
    hires_stale_survey: chip.isStaleSurvey,
    hires_requested_at: new Date().toISOString(),
    hires_from_event_id: eventId,
    latitude: coords.lat,
    longitude: coords.lon,
  }

  let updated = 0
  if (seed.id > 0) {
    let q = supabase
      .from('pad_activity_events')
      .select('id,raw')
      .eq('county_id', seed.county_id)
      .eq('week_start', seed.week_start)
      .eq('source', seed.source)
    if (seed.api_number) q = q.eq('api_number', seed.api_number)
    else if (seed.rrc_lease_id) q = q.eq('rrc_lease_id', seed.rrc_lease_id)
    else q = q.eq('id', seed.id)

    const { data: siblings } = await q
    for (const row of siblings || []) {
      const prior = (row.raw as Record<string, unknown>) || {}
      const { error } = await supabase
        .from('pad_activity_events')
        .update({ raw: { ...prior, ...hiresMeta } })
        .eq('id', row.id)
      if (!error) updated += 1
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      hires_path: storagePath,
      hires_date: chip.imageryDate,
      hires_source: chip.source,
      hires_label: chip.label,
      hires_stale_survey: chip.isStaleSurvey,
      signed_url: padImageryProxyUrl(storagePath),
      updated,
      cached: false,
      ground_m_approx: chip.groundMApprox,
    },
    error: null,
  })
}
