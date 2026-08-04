import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  isPlatformAdmin,
  isPlatformOwner,
  normalizeEmail,
  resolveTeamRole,
  roleLabel,
} from '@/lib/team'

export const dynamic = 'force-dynamic'

type AuthUser = {
  id: string
  email?: string | null
  created_at?: string
  last_sign_in_at?: string | null
  user_metadata?: Record<string, unknown>
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

  if (
    !session?.user ||
    !isPlatformAdmin(
      session.user.user_metadata as Record<string, unknown>,
      session.user.email,
    )
  ) {
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
  const needle = normalizeEmail(email)
  return users.find((u) => normalizeEmail(u.email) === needle) ?? null
}

/**
 * GET — list every admin the owner tracks:
 * - platform owner
 * - platform staff admins (is_admin)
 * - customer team admins (provisioned seats)
 */
export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate && gate.error) return gate.error
  const { adminClient, session } = gate as {
    adminClient: SupabaseClient
    session: { user: { email?: string | null } }
  }

  const users = await listAllUsers(adminClient)
  const { data: subs } = await adminClient
    .from('subscriptions')
    .select('user_id, status, seat_count, team_owner_id')

  const subByUser = new Map(
    ((subs ?? []) as Array<{
      user_id: string
      status: string | null
      seat_count: number | null
      team_owner_id: string | null
    }>).map((s) => [s.user_id, s]),
  )

  const { data: memberRows } = await adminClient
    .from('team_members')
    .select('owner_id')
    .neq('status', 'revoked')

  const memberCountByOwner = new Map<string, number>()
  for (const row of (memberRows ?? []) as Array<{ owner_id: string }>) {
    memberCountByOwner.set(row.owner_id, (memberCountByOwner.get(row.owner_id) ?? 0) + 1)
  }

  const admins = users
    .map((user) => {
      const sub = subByUser.get(user.id) ?? null
      const role = resolveTeamRole({
        metadata: user.user_metadata as Record<string, unknown>,
        email: user.email,
        subscription: sub,
      })
      if (
        role !== 'platform_owner' &&
        role !== 'platform_admin' &&
        role !== 'team_admin'
      ) {
        return null
      }
      const seats = Number(sub?.seat_count ?? 0)
      const members = memberCountByOwner.get(user.id) ?? 0
      return {
        id: user.id,
        email: user.email ?? '',
        role,
        role_label: roleLabel(role),
        created_at: user.created_at ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
        seat_count: seats,
        seats_used: role === 'team_admin' ? 1 + members : null,
        is_owner: role === 'platform_owner',
        can_revoke:
          role === 'platform_admin' &&
          !isPlatformOwner(user.email) &&
          isPlatformOwner(session.user.email),
      }
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => {
      const order = { platform_owner: 0, platform_admin: 1, team_admin: 2 } as const
      const ao = order[a.role as keyof typeof order] ?? 9
      const bo = order[b.role as keyof typeof order] ?? 9
      if (ao !== bo) return ao - bo
      return a.email.localeCompare(b.email)
    })

  return NextResponse.json({
    admins,
    viewer_is_owner: isPlatformOwner(session.user.email),
  })
}

/**
 * POST — owner grants platform admin to another account.
 * Body: { email: string }
 */
export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate && gate.error) return gate.error
  const { adminClient, session } = gate as {
    adminClient: SupabaseClient
    session: { user: { email?: string | null; id: string } }
  }

  if (!isPlatformOwner(session.user.email)) {
    return NextResponse.json(
      { error: 'Only the owner account can grant platform admin.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { email?: string }
  const email = normalizeEmail(body.email)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  if (isPlatformOwner(email)) {
    return NextResponse.json(
      { error: 'That email is already the owner account.' },
      { status: 400 },
    )
  }

  let user = await findUserByEmail(adminClient, email)
  let invited = false

  if (!user) {
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: {
        is_admin: true,
        team_role: 'platform_admin',
      },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin`,
    })
    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message || 'Failed to invite admin' },
        { status: 500 },
      )
    }
    user = data.user as AuthUser
    invited = true
  } else {
    const existingMeta = (user.user_metadata ?? {}) as Record<string, unknown>
    await adminClient.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...existingMeta,
        is_admin: true,
        team_role: 'platform_admin',
        // Staff admins are not customer team members.
        team_owner_id: null,
      },
    })
  }

  // Ensure they have an active subscription row (no customer seat package required).
  await adminClient.from('subscriptions').upsert(
    {
      user_id: user.id,
      status: 'active',
      team_owner_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  return NextResponse.json({
    success: true,
    invited,
    admin: {
      id: user.id,
      email,
      role: 'platform_admin',
      granted_by: session.user.id,
    },
  })
}

/**
 * PATCH — owner revokes platform admin from a staff account.
 * Body: { userId: string }
 * Cannot revoke the owner account.
 */
export async function PATCH(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate && gate.error) return gate.error
  const { adminClient, session } = gate as {
    adminClient: SupabaseClient
    session: { user: { email?: string | null } }
  }

  if (!isPlatformOwner(session.user.email)) {
    return NextResponse.json(
      { error: 'Only the owner account can revoke platform admin.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    userId?: string
    action?: string
  }
  const userId = String(body.userId ?? '').trim()
  if (!userId || body.action !== 'revoke') {
    return NextResponse.json(
      { error: 'userId and action=revoke required' },
      { status: 400 },
    )
  }

  const { data, error } = await adminClient.auth.admin.getUserById(userId)
  if (error || !data.user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  if (isPlatformOwner(data.user.email)) {
    return NextResponse.json(
      { error: 'Cannot revoke the owner account.' },
      { status: 400 },
    )
  }

  const existingMeta = (data.user.user_metadata ?? {}) as Record<string, unknown>
  await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...existingMeta,
      is_admin: false,
      team_role: null,
    },
  })

  return NextResponse.json({ success: true, user_id: userId })
}
