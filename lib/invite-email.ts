export type InviteEmailKind = 'team_admin' | 'team_member' | 'platform_admin'

export function inviteCopy(kind: InviteEmailKind, inviterEmail?: string | null): {
  subject: string
  headline: string
  body: string
  cta: string
} {
  if (kind === 'team_admin') {
    return {
      subject: "You're invited to run a Mineral Map workspace",
      headline: "You're the admin for a Mineral Map team",
      body: 'Mineral Map set you up as the team admin. Click below to choose a password and open your workspace. You can invite your teammates from Account once you are in.',
      cta: 'Set password and join',
    }
  }
  if (kind === 'platform_admin') {
    return {
      subject: "You're invited as a Mineral Map operator",
      headline: "You've been granted operator access",
      body: 'A Mineral Map owner invited you as a platform admin. Click below to choose a password and open the ops console.',
      cta: 'Set password and join',
    }
  }
  const from = inviterEmail ? ` (${inviterEmail})` : ''
  return {
    subject: "You've been invited to Mineral Map",
    headline: "You've been invited to Mineral Map",
    body: `A teammate${from} invited you to their Mineral Map workspace. Click below to join — you do not need anyone to create an account for you.`,
    cta: 'Accept invitation',
  }
}

export function inviteEmailHtml(input: {
  kind: InviteEmailKind
  actionUrl: string
  inviterEmail?: string | null
}): string {
  const copy = inviteCopy(input.kind, input.inviterEmail)
  return `
        <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; color: #111827; margin-bottom: 16px;">${copy.headline}</h1>
          <p style="font-size: 15px; color: #4B5563; line-height: 1.7; margin-bottom: 24px;">
            ${copy.body}
          </p>
          <a href="${input.actionUrl}" style="display: inline-block; background: #EF9F27; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-family: Inter, sans-serif; font-weight: 600; font-size: 14px;">
            ${copy.cta}
          </a>
          <p style="font-size: 12px; color: #9CA3AF; margin-top: 32px;">
            If you weren't expecting this invite, you can ignore this email.
          </p>
        </div>
      `
}
