import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isPlatformAdmin } from '@/lib/team'

export const dynamic = 'force-dynamic'

type AuthUser = {
  id: string
  email?: string | null
  created_at?: string
  user_metadata?: Record<string, unknown>
}

type SubscriptionRow = {
  user_id: string
  status: string | null
  stripe_customer_id: string | null
  created_at: string | null
}

type UsageRow = {
  user_id: string
  count: number | null
}

async function listAllUsers(adminClient: SupabaseClient) {
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

export async function GET(req: NextRequest) {
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
    }
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const users = await listAllUsers(adminClient)

  const { data: subs, error: subsError } = await adminClient
    .from('subscriptions')
    .select('user_id, status, stripe_customer_id, created_at')

  if (subsError) {
    return NextResponse.json({ error: 'Failed to load subscriptions' }, { status: 500 })
  }

  const currentMonth = new Date().toISOString().slice(0, 7)
  const { data: usage, error: usageError } = await adminClient
    .from('skip_trace_usage')
    .select('user_id, count')
    .eq('month', currentMonth)

  if (usageError) {
    return NextResponse.json({ error: 'Failed to load skip trace usage' }, { status: 500 })
  }

  const subByUserId = new Map<string, SubscriptionRow>(
    ((subs ?? []) as SubscriptionRow[]).map((sub) => [sub.user_id, sub])
  )
  const usageByUserId = new Map<string, number>(
    ((usage ?? []) as UsageRow[]).map((u) => [u.user_id, Number(u.count ?? 0)])
  )

  const enriched = users.map((user) => {
    const sub = subByUserId.get(user.id) ?? null
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
    const metaStatus = String(metadata.subscription_status ?? '').trim().toLowerCase()
    const subscriptionStatus = metaStatus || String(sub?.status ?? 'none').toLowerCase()

    return {
      id: user.id,
      email: user.email ?? '',
      created_at: user.created_at ?? new Date(0).toISOString(),
      subscription_status: subscriptionStatus,
      is_admin: isPlatformAdmin(metadata, user.email),
      subscription: sub,
      skip_traces: usageByUserId.get(user.id) ?? 0,
    }
  })

  const totalSkipTraces = (usage ?? []).reduce((sum, row) => sum + Number((row as UsageRow).count ?? 0), 0)
  const activeSubscribers = enriched.filter((u) => u.subscription_status === 'active' && !u.is_admin).length
  const trialUsers = enriched.filter((u) => u.subscription_status === 'trialing').length

  return NextResponse.json({
    users: enriched,
    stats: {
      totalUsers: enriched.length,
      activeSubscribers,
      trialUsers,
      totalSkipTraces,
    },
  })
}
