import type { SupabaseClient, User } from '@supabase/supabase-js'
import { findUserByEmail } from '@/lib/auth-users'
import { inviteAuthUser } from '@/lib/auth-invite'
import {
  GREAT_PLAINS_MEMBER_EMAILS,
  GREAT_PLAINS_OWNER_EMAILS,
  getTeamOwnerId,
  isGreatPlainsMember,
  normalizeEmail,
} from '@/lib/team'

export type AttachTeamMemberInput = {
  ownerId: string
  userId: string
  email: string
  metadata?: Record<string, unknown>
  status?: 'pending' | 'accepted'
}

export async function attachUserToTeam(
  adminClient: SupabaseClient,
  input: AttachTeamMemberInput,
): Promise<{ error?: string }> {
  const email = normalizeEmail(input.email)
  const status = input.status ?? 'accepted'
  const now = new Date().toISOString()

  const { error: memberError } = await adminClient.from('team_members').upsert(
    {
      owner_id: input.ownerId,
      invite_email: email,
      member_id: status === 'accepted' ? input.userId : null,
      status,
      updated_at: now,
    },
    { onConflict: 'owner_id,invite_email' },
  )
  if (memberError) return { error: memberError.message }

  if (status === 'accepted') {
    const { error: subError } = await adminClient.from('subscriptions').upsert(
      {
        user_id: input.userId,
        status: 'active',
        team_owner_id: input.ownerId,
        seat_count: 1,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    )
    if (subError) return { error: subError.message }

    const { error: metaError } = await adminClient.auth.admin.updateUserById(input.userId, {
      user_metadata: {
        ...(input.metadata ?? {}),
        subscription_status: 'active',
        team_owner_id: input.ownerId,
        team_role: 'member',
        is_admin: false,
      },
    })
    if (metaError) return { error: metaError.message }
  }

  return {}
}

export async function findGreatPlainsOwner(
  adminClient: SupabaseClient,
): Promise<User | null> {
  for (const email of GREAT_PLAINS_OWNER_EMAILS) {
    const user = await findUserByEmail(adminClient, email)
    if (user) return user
  }
  return null
}

export async function ensureGreatPlainsMembership(
  adminClient: SupabaseClient,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
): Promise<{ ok: boolean; attached: boolean; ownerId?: string; error?: string }> {
  if (!isGreatPlainsMember(user.email)) {
    return { ok: true, attached: false }
  }

  const owner = await findGreatPlainsOwner(adminClient)
  if (!owner) {
    return { ok: false, attached: false, error: 'Great Plains owner account not found' }
  }

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
  const { data: sub } = await adminClient
    .from('subscriptions')
    .select('team_owner_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const currentOwner = getTeamOwnerId(
    metadata,
    (sub as { team_owner_id?: string | null } | null)?.team_owner_id,
  )
  if (currentOwner === owner.id) {
    return { ok: true, attached: false, ownerId: owner.id }
  }

  const result = await attachUserToTeam(adminClient, {
    ownerId: owner.id,
    userId: user.id,
    email: user.email ?? '',
    metadata,
    status: 'accepted',
  })
  if (result.error) {
    return { ok: false, attached: false, ownerId: owner.id, error: result.error }
  }
  return { ok: true, attached: true, ownerId: owner.id }
}

export async function seedGreatPlainsMembers(
  adminClient: SupabaseClient,
  inviter?: { id?: string | null; email?: string | null },
): Promise<{
  ownerId: string
  ownerEmail: string
  members: Array<{
    email: string
    userId: string
    created: boolean
    emailed: boolean
    attached: boolean
    emailError?: string
    actionUrl?: string
  }>
}> {
  const owner = await findGreatPlainsOwner(adminClient)
  if (!owner) {
    throw new Error(
      `Great Plains owner not found (looked for ${GREAT_PLAINS_OWNER_EMAILS.join(', ')})`,
    )
  }

  const members: Array<{
    email: string
    userId: string
    created: boolean
    emailed: boolean
    attached: boolean
    emailError?: string
    actionUrl?: string
  }> = []

  for (const email of GREAT_PLAINS_MEMBER_EMAILS) {
    const invited = await inviteAuthUser(adminClient, {
      email,
      kind: 'team_member',
      metadata: {
        subscription_status: 'active',
        team_owner_id: owner.id,
        team_role: 'member',
        is_admin: false,
      },
      redirectTo: `/auth?invite=${owner.id}&email=${encodeURIComponent(email)}`,
      inviterUserId: inviter?.id ?? owner.id,
      inviterEmail: inviter?.email ?? owner.email,
    })

    const signedIn = Boolean(invited.user.last_sign_in_at)
    const attach = await attachUserToTeam(adminClient, {
      ownerId: owner.id,
      userId: invited.user.id,
      email,
      metadata: (invited.user.user_metadata ?? {}) as Record<string, unknown>,
      status: signedIn ? 'accepted' : 'pending',
    })
    if (attach.error) {
      throw new Error(`${email}: ${attach.error}`)
    }

    members.push({
      email,
      userId: invited.user.id,
      created: invited.created,
      emailed: invited.emailed,
      attached: signedIn,
      emailError: invited.emailError,
      actionUrl: invited.actionUrl,
    })
  }

  return {
    ownerId: owner.id,
    ownerEmail: owner.email ?? GREAT_PLAINS_OWNER_EMAILS[0],
    members,
  }
}
