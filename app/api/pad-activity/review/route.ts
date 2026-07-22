import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DECISIONS = {
  COMPLETION_CREW: {
    signature: 'COMPLETION_CREW',
    confidence: 0.95,
    propensity_bump: 3,
    summary: (lease: string) =>
      `Human review: confirmed completion-crew activity on ${lease}. Production and payout likely imminent — recommended follow-up.`,
  },
  RIG_MOVE_IN: {
    signature: 'RIG_MOVE_IN',
    confidence: 0.9,
    propensity_bump: 0,
    summary: (lease: string) =>
      `Human review: confirmed rig / pad activity on ${lease}. Drilling may be starting.`,
  },
  NON_RELEVANT: {
    signature: 'NON_RELEVANT',
    confidence: 0.9,
    propensity_bump: 0,
    summary: (lease: string) =>
      `Human review: imagery change on ${lease} marked non-relevant (not chase-worthy).`,
  },
} as const

type Decision = keyof typeof DECISIONS

function adminClient() {
  return createAdminClient()
}

/**
 * POST /api/pad-activity/review
 * Body: { event_id: number, decision: 'COMPLETION_CREW' | 'RIG_MOVE_IN' | 'NON_RELEVANT' }
 *
 * Updates every sibling row for the same pad/week/source so the whole
 * owner fan-out flips together. Confirmed completions also bump propensity.
 */
export async function POST(request: NextRequest) {
  const supabase = adminClient()
  if (!supabase) {
    return NextResponse.json(
      { success: false, data: null, error: 'supabase env missing' },
      { status: 500 },
    )
  }

  let body: { event_id?: number; decision?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: 'invalid JSON body' },
      { status: 400 },
    )
  }

  const eventId = Number(body.event_id)
  const decision = String(body.decision || '').trim() as Decision
  if (!eventId || !(decision in DECISIONS)) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'event_id and decision (COMPLETION_CREW|RIG_MOVE_IN|NON_RELEVANT) required',
      },
      { status: 400 },
    )
  }

  const { data: seed, error: seedErr } = await supabase
    .from('pad_activity_events')
    .select(
      'id,county_id,api_number,rrc_lease_id,week_start,source,lease_name,owner_name,raw',
    )
    .eq('id', eventId)
    .maybeSingle()

  if (seedErr || !seed) {
    return NextResponse.json(
      { success: false, data: null, error: seedErr?.message || 'event not found' },
      { status: 404 },
    )
  }

  const cfg = DECISIONS[decision]
  const lease = (seed.lease_name as string) || 'this lease'
  const patch = {
    signature: cfg.signature,
    confidence: cfg.confidence,
    propensity_bump: cfg.propensity_bump,
    summary: cfg.summary(lease),
    raw: {
      ...((seed.raw as Record<string, unknown>) || {}),
      human_review: {
        decision: cfg.signature,
        reviewed_at: new Date().toISOString(),
        from_event_id: eventId,
      },
      needs_review: false,
    },
  }

  // Flip all siblings for this pad/week/source (owner fan-out).
  let q = supabase
    .from('pad_activity_events')
    .update(patch)
    .eq('county_id', seed.county_id)
    .eq('week_start', seed.week_start)
    .eq('source', seed.source)

  if (seed.api_number) {
    q = q.eq('api_number', seed.api_number)
  } else if (seed.rrc_lease_id) {
    q = q.eq('rrc_lease_id', seed.rrc_lease_id)
  } else {
    q = q.eq('id', eventId)
  }

  const { data: updated, error: updErr } = await q.select('id,owner_name,signature')
  if (updErr) {
    return NextResponse.json(
      { success: false, data: null, error: updErr.message },
      { status: 500 },
    )
  }

  let propensityBumps = 0
  if (decision === 'COMPLETION_CREW') {
    const owners = Array.from(
      new Set(
        (updated || [])
          .map((r) => String(r.owner_name || '').trim())
          .filter(Boolean),
      ),
    )
    const table = `${seed.county_id}_mineral_ownership`
    for (const owner of owners) {
      try {
        const { data: rows } = await supabase
          .from(table)
          .select('propensity_score')
          .eq('owner_name', owner)
          .limit(1)
        const prior = Number(rows?.[0]?.propensity_score ?? 0) || 0
        const next = Math.min(10, prior + 3)
        await supabase
          .from(table)
          .update({ propensity_score: next, motivated: next >= 5 })
          .eq('owner_name', owner)
        await supabase
          .from('deals')
          .update({ tag: 'hot' })
          .eq('owner_name', owner)
          .eq('county', seed.county_id)
        propensityBumps += 1
      } catch {
        // Soft-fail — review still succeeded.
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      updated: (updated || []).length,
      signature: cfg.signature,
      propensity_bumps: propensityBumps,
    },
    error: null,
  })
}
