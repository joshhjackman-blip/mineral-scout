import { createHash, randomBytes } from 'node:crypto'

export const SIGNUP_OWNER_EMAIL = 'management@mineralmapllc.com'
export const SIGNUP_FROM_EMAIL = 'Mineral Map <noreply@getmineralmap.com>'

export type SignupRequestStatus = 'pending' | 'accepted' | 'declined' | 'onboarded'

export type SignupRequestRow = {
  id: string
  full_name: string
  email: string
  company: string | null
  phone: string | null
  notes: string | null
  status: SignupRequestStatus
  decision_token_hash: string
  wants_admin: boolean | null
  seat_count: number | null
  user_id: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  decline_reason: string | null
  onboarded_at: string | null
  created_at: string
  updated_at: string
}

export function newSignupToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashSignupToken(token: string): string {
  return createHash('sha256').update(token.trim().toLowerCase()).digest('hex')
}

export function isValidSignupEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function cleanSignupText(value: unknown, max: number): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max)
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function signupOwnerNoticeHtml(input: {
  name: string
  email: string
  company?: string
  acceptUrl: string
  declineUrl: string
}): string {
  const company = input.company?.trim()
  return `
        <div style="font-family:Geist,Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;">
          <h1 style="font-size:22px;color:#111827;margin:0 0 8px;">New Mineral Map signup request</h1>
          <p style="font-size:14px;color:#6B7280;margin:0 0 20px;line-height:1.5;">
            ${escapeHtml(input.name)} asked for access. Accept to email them a signup link
            (password, agreement, card, team admin). Decline if they should not join.
          </p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr>
              <td style="padding:8px 12px 8px 0;font-size:13px;color:#6B7280;">Name</td>
              <td style="padding:8px 0;font-size:14px;color:#111827;">${escapeHtml(input.name)}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px 8px 0;font-size:13px;color:#6B7280;">Email</td>
              <td style="padding:8px 0;font-size:14px;color:#111827;">${escapeHtml(input.email)}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px 8px 0;font-size:13px;color:#6B7280;">Company</td>
              <td style="padding:8px 0;font-size:14px;color:#111827;">${escapeHtml(company || '—')}</td>
            </tr>
          </table>
          <p style="margin:0 0 12px;">
            <a href="${input.acceptUrl}" style="display:inline-block;background:#059669;color:white;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
              Accept — send signup email
            </a>
          </p>
          <p style="margin:0 0 24px;">
            <a href="${input.declineUrl}" style="display:inline-block;background:#991B1B;color:white;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
              Decline
            </a>
          </p>
          <p style="font-size:12px;color:#9CA3AF;margin:0;">
            You can also accept or decline from the Owner portfolio.
          </p>
        </div>
      `
}

export function signupDeclinedHtml(name: string): string {
  return `
        <div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:40px 20px;">
          <h1 style="font-size:24px;color:#111827;margin-bottom:16px;">Mineral Map access</h1>
          <p style="font-size:15px;color:#4B5563;line-height:1.7;margin-bottom:24px;">
            Hi ${escapeHtml(name)}, we are not able to open a Mineral Map workspace for this
            request. If that is a surprise, reply to this email or write
            management@mineralmapllc.com.
          </p>
        </div>
      `
}

export function decidePageHtml(input: {
  title: string
  body: string
  token?: string
  action?: 'accept' | 'decline'
  name?: string
  email?: string
}): string {
  const confirm =
    input.token && input.action
      ? `
        <form method="POST" action="/api/signup-requests/decide">
          <input type="hidden" name="token" value="${escapeHtml(input.token)}" />
          <input type="hidden" name="action" value="${escapeHtml(input.action)}" />
          <button type="submit" style="display:inline-block;border:none;border-radius:8px;padding:12px 22px;font-weight:600;font-size:14px;cursor:pointer;background:${input.action === 'accept' ? '#059669' : '#991B1B'};color:white;">
            ${input.action === 'accept' ? 'Confirm accept and email them' : 'Confirm decline'}
          </button>
        </form>`
      : ''
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;background:#F8FAFC;font-family:Geist,Inter,system-ui,sans-serif;color:#111827;">
    <div style="max-width:480px;margin:72px auto;padding:32px;background:white;border:1px solid #E5E7EB;border-radius:12px;">
      <p style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#D97706;margin:0 0 12px;">Mineral Map</p>
      <h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(input.title)}</h1>
      <p style="font-size:15px;line-height:1.6;color:#4B5563;">${escapeHtml(input.body)}</p>
      ${
        input.name
          ? `<p style="font-size:14px;color:#111827;"><strong>${escapeHtml(input.name)}</strong><br/>${escapeHtml(input.email ?? '')}</p>`
          : ''
      }
      ${confirm}
    </div>
  </body>
</html>`
}
