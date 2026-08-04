import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { ownerId?: string }
  const ownerId = body.ownerId?.trim()
  if (!ownerId) {
    return NextResponse.json({ error: 'ownerId required' }, { status: 400 })
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

  const email = (session.user.email ?? '').toLowerCase().trim()
  if (!email) {
    return NextResponse.json({ error: 'Account email required' }, { status: 400 })
  }

  // Must have a pending (or already accepted) invite for this email.
  const { data: invite, error: inviteLookupError } = await adminClient
    .from('team_members')
    .select('id, status')
    .eq('owner_id', ownerId)
    .eq('invite_email', email)
    .maybeSingle()

  if (inviteLookupError) {
    return NextResponse.json({ error: inviteLookupError.message }, { status: 500 })
  }
  if (!invite || invite.status === 'revoked') {
    return NextResponse.json(
      { error: 'No valid invite found for this email.' },
      { status: 404 },
    )
  }

  // Enforce seat capacity at accept time too.
  const { data: ownerSub } = await adminClient
    .from('subscriptions')
    .select('seat_count')
    .eq('user_id', ownerId)
    .maybeSingle()

  const { data: existingMembers } = await adminClient
    .from('team_members')
    .select('id, invite_email, status')
    .eq('owner_id', ownerId)
    .neq('status', 'revoked')

  const seatLimit = Number(ownerSub?.seat_count ?? 1)
  const capacity = Math.max(0, seatLimit - 1)
  const others = (existingMembers ?? []).filter(
    (m) => (m.invite_email ?? '').toLowerCase() !== email,
  )
  if (others.length >= capacity && invite.status !== 'accepted') {
    return NextResponse.json(
      { error: 'This team has no open seats. Ask your admin to free a seat.' },
      { status: 403 },
    )
  }

  const { error } = await adminClient
    .from('team_members')
    .update({
      member_id: session.user.id,
      status: 'accepted',
      updated_at: new Date().toISOString(),
    })
    .eq('owner_id', ownerId)
    .eq('invite_email', email)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await adminClient.from('subscriptions').upsert(
    {
      user_id: session.user.id,
      status: 'active',
      team_owner_id: ownerId,
      seat_count: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )

  const existingMeta = (session.user.user_metadata ?? {}) as Record<string, unknown>
  await adminClient.auth.admin.updateUserById(session.user.id, {
    user_metadata: {
      ...existingMeta,
      subscription_status: 'active',
      team_owner_id: ownerId,
      team_role: 'member',
      // Members never get the platform admin console.
      is_admin: false,
    },
  })

  return NextResponse.json({ success: true })
}
