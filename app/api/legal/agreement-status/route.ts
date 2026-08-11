import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import {
  CURRENT_AGREEMENT_VERSION,
  hasSignedCurrentAgreement,
} from '@/lib/agreement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — has the logged-in user signed the current agreement?
 * If a DB signature exists but user_metadata is stale, stamp metadata
 * so middleware/JWT can pass after the client refreshes the session.
 */
export async function GET(request: NextRequest) {
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll().map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
          }))
        },
        setAll() {
          // read-only status check
        },
      },
    },
  )

  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ ok: false, signed: false, error: 'Unauthorized' }, { status: 401 })
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  if (hasSignedCurrentAgreement(meta)) {
    return NextResponse.json({
      ok: true,
      signed: true,
      agreement_version: CURRENT_AGREEMENT_VERSION,
      source: 'metadata',
    })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { ok: false, signed: false, error: 'Supabase not configured' },
      { status: 500 },
    )
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const email = user.email.toLowerCase()
  const { data: byUser } = await admin
    .from('platform_agreement_signatures')
    .select('id, signed_at, agreement_version, user_id')
    .eq('agreement_version', CURRENT_AGREEMENT_VERSION)
    .eq('user_id', user.id)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let row = byUser
  if (!row) {
    const { data: byEmail } = await admin
      .from('platform_agreement_signatures')
      .select('id, signed_at, agreement_version, user_id')
      .eq('agreement_version', CURRENT_AGREEMENT_VERSION)
      .ilike('signer_email', email)
      .order('signed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    row = byEmail
  }

  if (!row) {
    return NextResponse.json({
      ok: true,
      signed: false,
      agreement_version: CURRENT_AGREEMENT_VERSION,
    })
  }

  // Stamp metadata (+ attach user_id on the row if it was email-only).
  await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...meta,
      agreement_version: CURRENT_AGREEMENT_VERSION,
      agreement_signed_at: row.signed_at,
      agreement_signature_id: row.id,
    },
  })
  if (!row.user_id) {
    await admin
      .from('platform_agreement_signatures')
      .update({ user_id: user.id })
      .eq('id', row.id)
  }

  return NextResponse.json({
    ok: true,
    signed: true,
    agreement_version: CURRENT_AGREEMENT_VERSION,
    source: 'database',
    refreshed_metadata: true,
  })
}
