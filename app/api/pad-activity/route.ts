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

/**
 * GET /api/pad-activity?county=howard&abstract=543
 * GET /api/pad-activity?county=howard&owner=SMITH%20JOHN
 *
 * Returns recent pad_activity_events for the OwnerDrawer Well Activity card.
 * Optional signed URLs for before/after chips when storage paths exist.
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
  const county = (searchParams.get('county') || '').trim().toLowerCase()
  const abstract = (searchParams.get('abstract') || '').trim()
  const owner = (searchParams.get('owner') || '').trim()
  const limit = Math.min(Number(searchParams.get('limit') || '10') || 10, 50)

  if (!county) {
    return NextResponse.json(
      { success: false, data: null, error: 'county required' },
      { status: 400 },
    )
  }
  if (!abstract && !owner) {
    return NextResponse.json(
      { success: false, data: null, error: 'abstract or owner required' },
      { status: 400 },
    )
  }

  let query = supabase
    .from('pad_activity_events')
    .select(
      'id,county_id,rrc_lease_id,api_number,abstract_number,owner_name,lease_name,' +
        'operator_name,signature,confidence,change_score,summary,before_path,' +
        'after_path,week_start,propensity_bump,source,created_at',
    )
    .eq('county_id', county)
    .order('week_start', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (abstract) {
    // Bare abstract ("543") — strip A- prefix if the client sent it.
    const bare = abstract.replace(/^A-/i, '').replace(/^0+/, '') || abstract
    query = query.or(`abstract_number.eq.${bare},abstract_number.eq.${abstract}`)
  } else if (owner) {
    query = query.eq('owner_name', owner)
  }

  const { data, error } = await query
  if (error) {
    // Table may not exist until migration is applied — fail soft.
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
  const signed: Record<string, string> = {}

  // Sign chip paths on demand (Raw-Data bucket). Soft-fail if storage
  // isn't configured or the object is missing.
  const paths = Array.from(
    new Set(
      events.flatMap((e) => [e.before_path, e.after_path].filter(Boolean) as string[]),
    ),
  )
  for (const path of paths.slice(0, 20)) {
    try {
      const { data: signedData, error: signErr } = await supabase.storage
        .from('Raw-Data')
        .createSignedUrl(path, 60 * 60)
      if (!signErr && signedData?.signedUrl) {
        signed[path] = signedData.signedUrl
      }
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    success: true,
    data: { events, signed },
    error: null,
  })
}
