import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getTeamOwnerId, inviteSeatCapacity, resolveTeamRole } from '@/lib/team'
import { inviteAuthUser } from '@/lib/auth-invite'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string }
  const normalizedEmail = body.email?.toLowerCase().trim()
  if (!normalizedEmail) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const cookieStore = cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // No cookie writes needed for this endpoint.
        },
      },
    }
  )
  const {
    data: { session },
  } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: sub } = await adminClient
    .from('subscriptions')
    .select('status, seat_count, team_owner_id')
    .eq('user_id', session.user.id)
    .maybeSingle()

  const metadata = (session.user.user_metadata ?? {}) as Record<string, unknown>
  const role = resolveTeamRole({
    metadata,
    email: session.user.email,
    subscription: sub,
  })

  // Team members (and unprovisioned users) cannot invite.
  if (role === 'team_member') {
    return NextResponse.json(
      { error: 'Only your team admin can invite members.' },
      { status: 403 },
    )
  }
  if (role === 'unprovisioned') {
    return NextResponse.json(
      {
        error:
          'Your account is not provisioned for team seats yet. Ask Mineral Map to assign you as a team admin.',
      },
      { status: 403 },
    )
  }

  // Belt-and-suspenders: metadata/sub team_owner_id means member.
  if (getTeamOwnerId(metadata, sub?.team_owner_id)) {
    return NextResponse.json(
      { error: 'Only your team admin can invite members.' },
      { status: 403 },
    )
  }

  if (normalizedEmail === (session.user.email ?? '').toLowerCase()) {
    return NextResponse.json({ error: 'You cannot invite yourself.' }, { status: 400 })
  }

  const { data: existingMembers } = await adminClient
    .from('team_members')
    .select('id, status')
    .eq('owner_id', session.user.id)
    .neq('status', 'revoked')

  const seatLimit = Number(sub?.seat_count ?? 1)
  const capacity = inviteSeatCapacity(seatLimit)
  if (capacity < 1) {
    return NextResponse.json(
      {
        error:
          'No member seats available. Ask Mineral Map to increase your seat count.',
      },
      { status: 403 },
    )
  }

  if ((existingMembers?.length ?? 0) >= capacity) {
    return NextResponse.json(
      {
        error: `Seat limit reached. Your team includes ${seatLimit} seats (1 admin + ${capacity} members).`,
      },
      { status: 403 },
    )
  }

  const { error: inviteError } = await adminClient.from('team_members').upsert(
    {
      owner_id: session.user.id,
      invite_email: normalizedEmail,
      status: 'pending',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'owner_id,invite_email' }
  )

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 })
  }

  const invitePath = `/auth?invite=${session.user.id}&email=${encodeURIComponent(normalizedEmail)}`

  let emailed = false
  let emailError: string | undefined
  let actionUrl: string | undefined
  try {
    const result = await inviteAuthUser(adminClient, {
      email: normalizedEmail,
      kind: 'team_member',
      metadata: {
        subscription_status: 'active',
        team_owner_id: session.user.id,
        team_role: 'member',
        is_admin: false,
      },
      redirectTo: invitePath,
      inviterUserId: session.user.id,
      inviterEmail: session.user.email,
    })
    emailed = result.emailed
    emailError = result.emailError
    actionUrl = result.actionUrl
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: message || 'Failed to send invite' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    email: normalizedEmail,
    emailed,
    email_error: emailError ?? null,
    action_url: actionUrl ?? null,
    seats: {
      total: seatLimit,
      used: 1 + (existingMembers?.length ?? 0) + 1,
      capacity,
    },
  })
}
