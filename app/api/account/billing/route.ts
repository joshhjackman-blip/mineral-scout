import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiUser } from '@/lib/api-auth'
import { isSkipTraceWaivedFor } from '@/lib/access'
import { getTeamOwnerId } from '@/lib/team'

export const dynamic = 'force-dynamic'

/**
 * Skip-trace waiver + running total for the signed-in user's workspace.
 * Waived only when the user or their team admin is Mineral Map / Great Plains.
 */
export async function GET(req: NextRequest) {
  const gate = await requireApiUser(req, { requireAgreement: false })
  if (gate.error) return gate.error

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: sub } = await adminClient
    .from('subscriptions')
    .select('team_owner_id')
    .eq('user_id', gate.user.id)
    .maybeSingle()

  const workspaceId =
    getTeamOwnerId(
      gate.user.user_metadata as Record<string, unknown>,
      (sub as { team_owner_id?: string | null } | null)?.team_owner_id,
    ) || gate.user.id

  let workspaceOwnerEmail = gate.user.email ?? null
  if (workspaceId !== gate.user.id) {
    const { data: ownerUser } = await adminClient.auth.admin.getUserById(workspaceId)
    workspaceOwnerEmail = ownerUser?.user?.email ?? workspaceOwnerEmail
  }

  return NextResponse.json({
    success: true,
    data: {
      skip_trace_waived: isSkipTraceWaivedFor({
        userEmail: gate.user.email,
        workspaceOwnerEmail,
      }),
      workspace_owner_email: workspaceOwnerEmail,
    },
    error: null,
  })
}
