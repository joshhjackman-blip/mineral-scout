import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiUser } from '@/lib/api-auth'
import { hasSignedCurrentAgreement } from '@/lib/agreement'
import { readTeamCardStatus } from '@/lib/stripe-card'
import { stripeBillingConfigured } from '@/lib/skip-trace-gate'

export const dynamic = 'force-dynamic'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function GET(req: NextRequest) {
  const gate = await requireApiUser(req, { requireAgreement: false })
  if (gate.error) return gate.error

  const admin = adminDb()
  const { data: request } = await admin
    .from('signup_requests')
    .select('id, full_name, email, company, status, wants_admin, seat_count, onboarded_at')
    .eq('user_id', gate.user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const card = await readTeamCardStatus(admin, gate.user.id)
  const meta = (gate.user.user_metadata ?? {}) as Record<string, unknown>

  return NextResponse.json({
    success: true,
    data: {
      email: gate.user.email,
      full_name:
        String((request as { full_name?: string } | null)?.full_name ?? meta.full_name ?? '').trim() ||
        null,
      company:
        String((request as { company?: string | null } | null)?.company ?? meta.company ?? '').trim() ||
        null,
      wants_admin: (request as { wants_admin?: boolean | null } | null)?.wants_admin ?? null,
      seat_count: Number((request as { seat_count?: number | null } | null)?.seat_count ?? 5) || 5,
      agreement_signed: hasSignedCurrentAgreement(meta),
      has_card: card.has_card,
      stripe_configured: stripeBillingConfigured(),
      onboarded: Boolean((request as { onboarded_at?: string | null } | null)?.onboarded_at),
      request_status: (request as { status?: string } | null)?.status ?? null,
    },
    error: null,
  })
}

/**
 * Save workspace role (team admin vs individual) and mark onboarding complete
 * when agreement is signed. Card is encouraged but not required if Stripe is off.
 */
export async function POST(req: NextRequest) {
  const gate = await requireApiUser(req, { requireAgreement: false })
  if (gate.error) return gate.error

  const body = (await req.json().catch(() => ({}))) as {
    full_name?: string
    company?: string
    wants_admin?: boolean
    seat_count?: number
    complete?: boolean
  }

  const fullName = String(body.full_name ?? '').trim()
  if (fullName.length < 2) {
    return NextResponse.json(
      { success: false, data: null, error: 'Enter your full name' },
      { status: 400 },
    )
  }
  const company = String(body.company ?? '').trim() || null
  const wantsAdmin = body.wants_admin !== false
  const seatCount = wantsAdmin
    ? Math.max(1, Math.min(25, Math.floor(Number(body.seat_count) || 5)))
    : 1

  const admin = adminDb()
  const meta = (gate.user.user_metadata ?? {}) as Record<string, unknown>
  await admin.auth.admin.updateUserById(gate.user.id, {
    user_metadata: {
      ...meta,
      full_name: fullName,
      company,
      team_role: 'admin',
      team_owner_id: null,
      seat_count: seatCount,
      subscription_status: 'active',
    },
  })

  const { error: subError } = await admin.from('subscriptions').upsert(
    {
      user_id: gate.user.id,
      status: 'active',
      seat_count: seatCount,
      team_owner_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (subError) {
    return NextResponse.json(
      { success: false, data: null, error: subError.message },
      { status: 500 },
    )
  }

  const now = new Date().toISOString()
  const onboarded = body.complete === true
  await admin
    .from('signup_requests')
    .update({
      full_name: fullName,
      company,
      wants_admin: wantsAdmin,
      seat_count: seatCount,
      status: onboarded ? 'onboarded' : 'accepted',
      onboarded_at: onboarded ? now : null,
      updated_at: now,
    })
    .eq('user_id', gate.user.id)
    .in('status', ['accepted', 'onboarded'])

  return NextResponse.json({
    success: true,
    data: { wants_admin: wantsAdmin, seat_count: seatCount, onboarded },
    error: null,
  })
}
