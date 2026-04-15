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
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )

  await adminClient.auth.admin.updateUserById(session.user.id, {
    user_metadata: {
      subscription_status: 'active',
      team_owner_id: ownerId,
    },
  })

  return NextResponse.json({ success: true })
}
