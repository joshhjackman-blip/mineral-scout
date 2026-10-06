import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { attachUserToTeam } from '@/lib/team-attach'

export const dynamic = 'force-dynamic'

async function attachMember(
  adminClient: SupabaseClient,
  input: {
    ownerId: string
    userId: string
    email: string
    metadata: Record<string, unknown>
  },
): Promise<{ error?: string; status?: number }> {
  const { data: invite, error: inviteLookupError } = await adminClient
    .from('team_members')
    .select('id, status')
    .eq('owner_id', input.ownerId)
    .eq('invite_email', input.email)
    .maybeSingle()

  if (inviteLookupError) {
    return { error: inviteLookupError.message, status: 500 }
  }
  if (!invite || invite.status === 'revoked') {
    return { error: 'No valid invite found for this email.', status: 404 }
  }

  const result = await attachUserToTeam(adminClient, {
    ownerId: input.ownerId,
    userId: input.userId,
    email: input.email,
    metadata: input.metadata,
    status: 'accepted',
  })
  if (result.error) {
    return { error: result.error, status: 500 }
  }
  return {}
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { ownerId?: string }
  let ownerId = body.ownerId?.trim() || ''

  const cookieStore = cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {},
      },
    },
  )
  const {
    data: { session },
  } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const email = (session.user.email ?? '').toLowerCase().trim()
  if (!email) {
    return NextResponse.json({ error: 'Account email required' }, { status: 400 })
  }

  if (!ownerId) {
    const { data: pending } = await adminClient
      .from('team_members')
      .select('owner_id, updated_at')
      .eq('invite_email', email)
      .neq('status', 'revoked')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    ownerId = String((pending as { owner_id?: string } | null)?.owner_id ?? '').trim()
    if (!ownerId) {
      return NextResponse.json({ success: true, accepted: false })
    }
  }

  const result = await attachMember(adminClient, {
    ownerId,
    userId: session.user.id,
    email,
    metadata: (session.user.user_metadata ?? {}) as Record<string, unknown>,
  })

  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 },
    )
  }

  return NextResponse.json({ success: true, accepted: true, owner_id: ownerId })
}
