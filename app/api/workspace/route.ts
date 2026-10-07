import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiUser } from '@/lib/api-auth'
import { getTeamOwnerId } from '@/lib/team'
import { ensureGreatPlainsMembership } from '@/lib/team-attach'

export const dynamic = 'force-dynamic'

/** Resolve CRM workspace and attach seeded Great Plains members if needed. */
export async function GET(req: NextRequest) {
  const gate = await requireApiUser(req, { requireAgreement: false })
  if (gate.error) return gate.error

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const ensured = await ensureGreatPlainsMembership(adminClient, gate.user)
  if (!ensured.ok && ensured.error) {
    console.warn('ensureGreatPlainsMembership:', ensured.error)
  }

  const { data: sub } = await adminClient
    .from('subscriptions')
    .select('team_owner_id')
    .eq('user_id', gate.user.id)
    .maybeSingle()

  const workspaceId =
    ensured.ownerId ||
    getTeamOwnerId(
      gate.user.user_metadata as Record<string, unknown>,
      (sub as { team_owner_id?: string | null } | null)?.team_owner_id,
    ) ||
    gate.user.id

  return NextResponse.json({
    success: true,
    data: {
      userId: gate.user.id,
      workspaceId,
      attached: Boolean(ensured.attached),
    },
    error: null,
  })
}
