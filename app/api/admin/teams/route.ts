import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isPlatformAdmin } from '@/lib/team'

export const dynamic = 'force-dynamic'

type AuthUser = {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
  created_at?: string
}

async function requirePlatformAdmin(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll().map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
          }))
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value)
            res.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.user || !isPlatformAdmin(session.user.user_metadata as Record<string, unknown>)) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  return { session, adminClient }
}

async function listAllUsers(adminClient: SupabaseClient): Promise<AuthUser[]> {
  const users: AuthUser[] = []
  let page = 1
  const perPage = 1000
  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const batch = (data?.users ?? []) as AuthUser[]
    users.push(...batch)
    if (batch.length < perPage) break
    page += 1
  }
  return users
}

async function findUserByEmail(
  adminClient: SupabaseClient,
  email: string,
): Promise<AuthUser | null> {
  const users = await listAllUsers(adminClient)
  const needle = email.toLowerCase()
  return users.find((u) => (u.email ?? '').toLowerCase() === needle) ?? null
}

/** GET — list provisioned team workspaces (owners with seats). */
export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate && gate.error) return gate.error
  const { adminClient } = gate as {
    adminClient: SupabaseClient
  }

  const { data: ownerSubs, error: subError } = await adminClient
    .from('subscriptions')
    .select('user_id, status, seat_count, team_owner_id, created_at, updated_at')
    .is('team_owner_id', null)
    .gte('seat_count', 1)
    .order('updated_at', { ascending: false })

  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 500 })
  }

  const users = await listAllUsers(adminClient)
  const userById = new Map(users.map((u) => [u.id, u]))

  const ownerIds = ((ownerSubs ?? []) as Array<{ user_id: string }>).map((s) => s.user_id)
  const { data: memberRows } = ownerIds.length
    ? await adminClient
        .from('team_members')
        .select('owner_id, invite_email, status, member_id')
        .in('owner_id', ownerIds)
        .neq('status', 'revoked')
    : { data: [] as Array<{ owner_id: string; invite_email: string; status: string; member_id: string | null }> }

  const membersByOwner = new Map<string, Array<{ email: string; status: string }>>()
  for (const row of (memberRows ?? []) as Array<{
    owner_id: string
    invite_email: string
    status: string
  }>) {
    const list = membersByOwner.get(row.owner_id) ?? []
    list.push({ email: row.invite_email, status: row.status })
    membersByOwner.set(row.owner_id, list)
  }

  const teams = ((ownerSubs ?? []) as Array<{
    user_id: string
    status: string | null
    seat_count: number | null
    created_at: string | null
    updated_at: string | null
  }>).map((sub) => {
    const user = userById.get(sub.user_id)
    const members = membersByOwner.get(sub.user_id) ?? []
    const seatCount = Number(sub.seat_count ?? 1)
    return {
      owner_id: sub.user_id,
      owner_email: user?.email ?? '(unknown)',
      status: sub.status ?? 'none',
      seat_count: seatCount,
      seats_used: 1 + members.length,
      members,
      created_at: sub.created_at,
      updated_at: sub.updated_at,
      is_platform_admin: Boolean(user?.user_metadata?.is_admin),
    }
  })

  return NextResponse.json({ teams })
}

/**
 * POST — provision a team admin seat.
 * Body: { email: string, seatCount: number }
 *
 * Creates/invites the user if needed, marks them as team admin
 * (NOT platform is_admin), and sets seat_count on their subscription.
 */
export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate && gate.error) return gate.error
  const { adminClient, session } = gate as {
    adminClient: SupabaseClient
    session: { user: { id: string } }
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string
    seatCount?: number
  }
  const email = String(body.email ?? '')
    .toLowerCase()
    .trim()
  const seatCount = Math.max(1, Math.min(100, Number(body.seatCount ?? 2) || 2))

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid admin email required' }, { status: 400 })
  }

  let user = await findUserByEmail(adminClient, email)
  let invited = false

  if (!user) {
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: {
        team_role: 'admin',
        // Never grant platform admin via team provisioning.
        is_admin: false,
      },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/account`,
    })
    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message || 'Failed to invite team admin' },
        { status: 500 },
      )
    }
    user = data.user as AuthUser
    invited = true
  } else {
    // Ensure existing user is not accidentally a platform admin unless
    // they already are (staff). Clear team_owner_id so they own a workspace.
    const existingMeta = (user.user_metadata ?? {}) as Record<string, unknown>
    await adminClient.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...existingMeta,
        team_role: 'admin',
        team_owner_id: null,
        subscription_status: 'active',
        // Preserve existing is_admin for staff accounts only.
        is_admin: Boolean(existingMeta.is_admin),
      },
    })
  }

  const { error: subError } = await adminClient.from('subscriptions').upsert(
    {
      user_id: user.id,
      status: 'active',
      seat_count: seatCount,
      team_owner_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    invited,
    team: {
      owner_id: user.id,
      owner_email: email,
      seat_count: seatCount,
      provisioned_by: session.user.id,
    },
  })
}

/** PATCH — update seat count for an existing team admin. */
export async function PATCH(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate && gate.error) return gate.error
  const { adminClient } = gate as { adminClient: SupabaseClient }

  const body = (await req.json().catch(() => ({}))) as {
    ownerId?: string
    seatCount?: number
  }
  const ownerId = String(body.ownerId ?? '').trim()
  const seatCount = Math.max(1, Math.min(100, Number(body.seatCount ?? 0) || 0))

  if (!ownerId || seatCount < 1) {
    return NextResponse.json({ error: 'ownerId and seatCount required' }, { status: 400 })
  }

  const { data: members } = await adminClient
    .from('team_members')
    .select('id')
    .eq('owner_id', ownerId)
    .neq('status', 'revoked')

  const used = 1 + (members?.length ?? 0)
  if (seatCount < used) {
    return NextResponse.json(
      {
        error: `Cannot set seats to ${seatCount}; team already uses ${used} seats (admin + members).`,
      },
      { status: 400 },
    )
  }

  const { error } = await adminClient
    .from('subscriptions')
    .update({
      seat_count: seatCount,
      status: 'active',
      team_owner_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', ownerId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, owner_id: ownerId, seat_count: seatCount })
}
