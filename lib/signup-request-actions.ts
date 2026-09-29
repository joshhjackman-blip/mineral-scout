import type { SupabaseClient } from '@supabase/supabase-js'
import { appBaseUrl } from '@/lib/auth-users'
import { inviteAuthUser } from '@/lib/auth-invite'
import { logEmailSend } from '@/lib/usage-log'
import {
  SIGNUP_FROM_EMAIL,
  SIGNUP_OWNER_EMAIL,
  hashSignupToken,
  signupDeclinedHtml,
  type SignupRequestRow,
} from '@/lib/signup-requests'

export type SignupDecision = 'accept' | 'decline'

function asRow(data: unknown): SignupRequestRow | null {
  if (!data || typeof data !== 'object') return null
  return data as SignupRequestRow
}

export async function loadSignupRequestByToken(
  admin: SupabaseClient,
  token: string,
): Promise<SignupRequestRow | null> {
  const hash = hashSignupToken(token)
  const { data, error } = await admin
    .from('signup_requests')
    .select('*')
    .eq('decision_token_hash', hash)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return asRow(data)
}

export async function loadSignupRequestById(
  admin: SupabaseClient,
  id: string,
): Promise<SignupRequestRow | null> {
  const { data, error } = await admin
    .from('signup_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return asRow(data)
}

async function sendApplicantEmail(input: {
  admin: SupabaseClient
  to: string
  subject: string
  html: string
  kind: 'signup_invite' | 'signup_declined'
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return { sent: false, error: 'RESEND_API_KEY is not set' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      from: SIGNUP_FROM_EMAIL,
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    return { sent: false, error: detail.slice(0, 300) }
  }
  await logEmailSend(input.admin, {
    kind: input.kind,
    toEmail: input.to,
  })
  return { sent: true }
}

export async function acceptSignupRequest(
  admin: SupabaseClient,
  input: { request: SignupRequestRow; reviewerId?: string | null },
): Promise<{ request: SignupRequestRow; emailed: boolean; emailError?: string; actionUrl?: string }> {
  const email = input.request.email.toLowerCase().trim()
  const invited = await inviteAuthUser(admin, {
    email,
    kind: 'approved_signup',
    metadata: {
      full_name: input.request.full_name,
      company: input.request.company,
      signup_request_id: input.request.id,
      subscription_status: 'active',
    },
    redirectTo: `/auth?welcome=signup&email=${encodeURIComponent(email)}`,
    inviterEmail: SIGNUP_OWNER_EMAIL,
  })

  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('signup_requests')
    .update({
      status: 'accepted',
      user_id: invited.user.id,
      reviewed_by: input.reviewerId ?? input.request.reviewed_by,
      reviewed_at: now,
      updated_at: now,
    })
    .eq('id', input.request.id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  return {
    request: asRow(data)!,
    emailed: invited.emailed,
    emailError: invited.emailError,
    actionUrl: invited.actionUrl,
  }
}

export async function declineSignupRequest(
  admin: SupabaseClient,
  input: {
    request: SignupRequestRow
    reviewerId?: string | null
    reason?: string | null
  },
): Promise<{ request: SignupRequestRow; emailed: boolean }> {
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('signup_requests')
    .update({
      status: 'declined',
      reviewed_by: input.reviewerId ?? input.request.reviewed_by,
      reviewed_at: now,
      decline_reason: input.reason?.trim() || null,
      updated_at: now,
    })
    .eq('id', input.request.id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  const mailed = await sendApplicantEmail({
    admin,
    to: input.request.email,
    subject: 'Mineral Map access update',
    html: signupDeclinedHtml(input.request.full_name),
    kind: 'signup_declined',
  })

  return { request: asRow(data)!, emailed: mailed.sent }
}

export function signupDecideUrls(token: string): { acceptUrl: string; declineUrl: string } {
  const base = appBaseUrl() || 'https://getmineralmap.com'
  const encoded = encodeURIComponent(token)
  return {
    acceptUrl: `${base}/api/signup-requests/decide?token=${encoded}&action=accept`,
    declineUrl: `${base}/api/signup-requests/decide?token=${encoded}&action=decline`,
  }
}
