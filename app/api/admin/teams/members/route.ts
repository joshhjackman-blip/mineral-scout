import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiPlatformAdmin } from '@/lib/api-auth'
import { findUserByEmail } from '@/lib/auth-users'
import { inviteAuthUser } from '@/lib/auth-invite'
import {
  GREAT_PLAINS_OWNER_EMAILS,
  normalizeEmail,
} from '@/lib/team'
import {
  attachUserToTeam,
  seedGreatPlainsMembers,
} from '@/lib/team-attach'

export const dynamic = 'force-dynamic'

/**
 * POST — attach a member to a team admin, or seed Great Plains members
 * (mtfminerals@gmail.com under jordan@greatplainsinterests.com).
 *
 * Body:
 *   { seed: true }                         → seed hardcoded Great Plains members
 *   { ownerEmail, memberEmail }            → attach one member under a team admin
 */
export async function POST(req: NextRequest) {
  const gate = await requireApiPlatformAdmin(req, { requireAgreement: false })
  if (gate.error) return gate.error

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const body = (await req.json().catch(() => ({}))) as {
    seed?: boolean
    ownerEmail?: string
    memberEmail?: string
  }

  if (body.seed) {
    try {
      const seeded = await seedGreatPlainsMembers(adminClient, {
        id: gate.user.id,
        email: gate.user.email,
      })
      return NextResponse.json({ success: true, ...seeded })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  const ownerEmail = normalizeEmail(body.ownerEmail) || GREAT_PLAINS_OWNER_EMAILS[0]
  const memberEmail = normalizeEmail(body.memberEmail)
  if (!memberEmail) {
    return NextResponse.json(
      { error: 'memberEmail is required (or pass seed: true)' },
      { status: 400 },
    )
  }

  const owner = await findUserByEmail(adminClient, ownerEmail)
  if (!owner) {
    return NextResponse.json(
      { error: `Team admin ${ownerEmail} was not found` },
      { status: 404 },
    )
  }

  let member = await findUserByEmail(adminClient, memberEmail)
  let created = false
  let emailed = false
  let emailError: string | undefined
  let actionUrl: string | undefined

  if (!member) {
    const invited = await inviteAuthUser(adminClient, {
      email: memberEmail,
      kind: 'team_member',
      metadata: {
        subscription_status: 'active',
        team_owner_id: owner.id,
        team_role: 'member',
        is_admin: false,
      },
      redirectTo: `/auth?invite=${owner.id}&email=${encodeURIComponent(memberEmail)}`,
      inviterUserId: gate.user.id,
      inviterEmail: gate.user.email,
    })
    member = invited.user
    created = invited.created
    emailed = invited.emailed
    emailError = invited.emailError
    actionUrl = invited.actionUrl
  }

  const signedIn = Boolean(member.last_sign_in_at)
  const attach = await attachUserToTeam(adminClient, {
    ownerId: owner.id,
    userId: member.id,
    email: memberEmail,
    metadata: (member.user_metadata ?? {}) as Record<string, unknown>,
    status: signedIn ? 'accepted' : 'pending',
  })
  if (attach.error) {
    return NextResponse.json({ error: attach.error }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    owner_email: owner.email,
    owner_id: owner.id,
    member_email: memberEmail,
    member_id: member.id,
    created,
    emailed,
    attached: signedIn,
    email_error: emailError ?? null,
    action_url: actionUrl ?? null,
  })
}
