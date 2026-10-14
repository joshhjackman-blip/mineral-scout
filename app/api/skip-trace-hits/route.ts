import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiUser } from '@/lib/api-auth'
import { unackedFoundHits, type SkipTraceHitReview } from '@/lib/skip-trace-hits'

export const dynamic = 'force-dynamic'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

function sinceIso(days = 60): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

export async function GET(req: NextRequest) {
  const gate = await requireApiUser(req)
  if (gate.error) return gate.error

  const db = adminDb()
  const { data, error } = await db
    .from('skip_trace_reviews')
    .select(
      'id, owner_name, phones, emails, notes, status, deal_id, requested_by, resolved_at, updated_at',
    )
    .eq('status', 'resolved')
    .eq('requested_by', gate.user.id)
    .gte('updated_at', sinceIso())
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ success: false, data: null, error: error.message }, { status: 500 })
  }

  const reviews = (data ?? []) as SkipTraceHitReview[]
  const ids = reviews.map((r) => r.id)
  let acked = new Set<string>()
  if (ids.length > 0) {
    const { data: ackRows, error: ackError } = await db
      .from('skip_trace_hit_acks')
      .select('review_id')
      .eq('user_id', gate.user.id)
      .in('review_id', ids)
    if (ackError && !String(ackError.message).includes('does not exist')) {
      return NextResponse.json(
        { success: false, data: null, error: ackError.message },
        { status: 500 },
      )
    }
    acked = new Set(
      ((ackRows ?? []) as Array<{ review_id?: string }>).map((row) => String(row.review_id ?? '')),
    )
  }

  return NextResponse.json({
    success: true,
    data: unackedFoundHits(reviews, acked),
    error: null,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireApiUser(req)
  if (gate.error) return gate.error

  const body = (await req.json().catch(() => ({}))) as { id?: string }
  const id = String(body.id ?? '').trim()
  if (!id) {
    return NextResponse.json(
      { success: false, data: null, error: 'id is required' },
      { status: 400 },
    )
  }

  const db = adminDb()
  const { data: review, error: lookupError } = await db
    .from('skip_trace_reviews')
    .select('id, requested_by, team_owner_id')
    .eq('id', id)
    .maybeSingle()
  if (lookupError || !review) {
    return NextResponse.json({ success: false, data: null, error: 'Not found' }, { status: 404 })
  }

  const requestedBy = String((review as { requested_by?: string | null }).requested_by ?? '')
  if (requestedBy && requestedBy !== gate.user.id) {
    return NextResponse.json({ success: false, data: null, error: 'Not found' }, { status: 404 })
  }

  const { error: ackError } = await db.from('skip_trace_hit_acks').upsert(
    {
      review_id: id,
      user_id: gate.user.id,
      acknowledged_at: new Date().toISOString(),
    },
    { onConflict: 'review_id,user_id' },
  )
  if (ackError) {
    return NextResponse.json({ success: false, data: null, error: ackError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: { id }, error: null })
}
