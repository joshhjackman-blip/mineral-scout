import type { SupabaseClient, User } from '@supabase/supabase-js'
import { appBaseUrl, findUserByEmail } from '@/lib/auth-users'
import { inviteCopy, inviteEmailHtml, type InviteEmailKind } from '@/lib/invite-email'
import { logEmailSend } from '@/lib/usage-log'

export type AuthInviteResult = {
  user: User
  created: boolean
  emailed: boolean
  emailError?: string
  /** Present when the email could not be sent so the inviter can copy it. */
  actionUrl?: string
}

function authRedirectTo(pathAndQuery: string): string {
  const base = appBaseUrl()
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  return base ? `${base}${path}` : path
}

async function sendInviteEmail(input: {
  adminClient: SupabaseClient
  toEmail: string
  kind: InviteEmailKind
  actionUrl: string
  inviterUserId?: string | null
  inviterEmail?: string | null
}): Promise<{ sent: boolean; error?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim()
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY missing; invite email not sent')
    return { sent: false, error: 'RESEND_API_KEY is not set' }
  }

  const copy = inviteCopy(input.kind, input.inviterEmail)
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: 'Mineral Map <noreply@getmineralmap.com>',
      to: input.toEmail,
      subject: copy.subject,
      html: inviteEmailHtml({
        kind: input.kind,
        actionUrl: input.actionUrl,
        inviterEmail: input.inviterEmail,
      }),
    }),
  })

  if (!emailRes.ok) {
    const detail = await emailRes.text()
    console.error('Resend invite error:', detail)
    return { sent: false, error: detail.slice(0, 300) }
  }

  await logEmailSend(input.adminClient, {
    kind: 'team_invite',
    toEmail: input.toEmail,
    userId: input.inviterUserId ?? null,
    meta: { invite_kind: input.kind },
  })
  return { sent: true }
}

/**
 * Create (or reuse) an Auth user and email them a join link via Resend.
 *
 * Does not require anyone to create the login in the Supabase dashboard.
 * Uses generateLink (invite / recovery) so we are not dependent on Supabase
 * SMTP — the branded email goes out through Resend, same as member invites.
 */
export async function inviteAuthUser(
  adminClient: SupabaseClient,
  input: {
    email: string
    kind: InviteEmailKind
    metadata: Record<string, unknown>
    redirectTo: string
    inviterUserId?: string | null
    inviterEmail?: string | null
  },
): Promise<AuthInviteResult> {
  const email = input.email.toLowerCase().trim()
  const existing = await findUserByEmail(adminClient, email)
  const redirectTo = authRedirectTo(input.redirectTo)

  let user = existing
  let created = false
  let actionLink: string | null = null

  if (!existing) {
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        data: input.metadata,
        redirectTo,
      },
    })
    if (error || !data?.user) {
      throw new Error(error?.message || 'Failed to create invited user')
    }
    user = data.user
    created = true
    actionLink = data.properties?.action_link ?? null
  } else {
    const existingMeta = (existing.user_metadata ?? {}) as Record<string, unknown>
    await adminClient.auth.admin.updateUserById(existing.id, {
      user_metadata: {
        ...existingMeta,
        ...input.metadata,
      },
    })
    const refreshed = await adminClient.auth.admin.getUserById(existing.id)
    user = refreshed.data.user ?? existing

    if (!existing.last_sign_in_at) {
      const { data, error } = await adminClient.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      })
      if (error) {
        throw new Error(error.message || 'Failed to create invite link')
      }
      actionLink = data.properties?.action_link ?? null
    } else {
      actionLink = redirectTo
    }
  }

  if (!user) {
    throw new Error('Failed to resolve invited user')
  }

  const actionUrl = actionLink || redirectTo
  const emailed = await sendInviteEmail({
    adminClient,
    toEmail: email,
    kind: input.kind,
    actionUrl,
    inviterUserId: input.inviterUserId,
    inviterEmail: input.inviterEmail,
  })

  return {
    user,
    created,
    emailed: emailed.sent,
    emailError: emailed.error,
    actionUrl: emailed.sent ? undefined : actionUrl,
  }
}
