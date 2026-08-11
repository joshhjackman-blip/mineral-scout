import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isPlatformAdmin } from '@/lib/team'

export const dynamic = 'force-dynamic'

/**
 * POST — one-shot: mark every existing auth user as billing-exempt
 * (complimentary platform access, no seat fee). Safe to re-run.
 *
 * Does NOT disable skip-trace metering — provider calls still bill at $0.50
 * unless you change that separately.
 */

type AuthUser = {
  id: string
  email?: string | null
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

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate && gate.error) return gate.error
  const { adminClient, session } = gate as {
    adminClient: SupabaseClient
    session: { user: { id: string } }
  }

  const users = await listAllUsers(adminClient)
  const now = new Date().toISOString()
  let updated = 0
  let skipped = 0
  const errors: Array<{ email: string; error: string }> = []

  for (const user of users) {
    const existingMeta = (user.user_metadata ?? {}) as Record<string, unknown>
    if (existingMeta.billing_exempt === true) {
      skipped += 1
      // Still ensure complimentary subscription row exists.
    } else {
      const { error: metaError } = await adminClient.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...existingMeta,
          billing_exempt: true,
          subscription_status: 'active',
          // Keep any existing seat_count; default 1 for solo accounts.
          seat_count:
            typeof existingMeta.seat_count === 'number' && existingMeta.seat_count > 0
              ? existingMeta.seat_count
              : 1,
        },
      })
      if (metaError) {
        errors.push({
          email: user.email ?? user.id,
          error: metaError.message,
        })
        continue
      }
      updated += 1
    }

    const seatCount =
      typeof existingMeta.seat_count === 'number' && existingMeta.seat_count > 0
        ? existingMeta.seat_count
        : 1

    // Preserve team membership / existing seat rows; only ensure access.
    const { data: existingSub } = await adminClient
      .from('subscriptions')
      .select('seat_count, team_owner_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const { error: subError } = await adminClient.from('subscriptions').upsert(
      {
        user_id: user.id,
        status: 'active',
        seat_count: Number(existingSub?.seat_count ?? seatCount) || 1,
        team_owner_id: existingSub?.team_owner_id ?? null,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    )
    if (subError) {
      errors.push({
        email: user.email ?? user.id,
        error: subError.message,
      })
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    grandfathered_by: session.user.id,
    total_users: users.length,
    newly_exempt: updated,
    already_exempt: skipped,
    errors,
  })
}

/** GET — how many users are already exempt vs not. */
export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin(req)
  if ('error' in gate && gate.error) return gate.error
  const { adminClient } = gate as { adminClient: SupabaseClient }

  const users = await listAllUsers(adminClient)
  let exempt = 0
  for (const user of users) {
    if ((user.user_metadata as Record<string, unknown> | undefined)?.billing_exempt === true) {
      exempt += 1
    }
  }

  return NextResponse.json({
    total_users: users.length,
    billing_exempt: exempt,
    need_grandfather: users.length - exempt,
  })
}
