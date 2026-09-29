import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { appBaseUrl } from '@/lib/auth-users'
import { logEmailSend } from '@/lib/usage-log'
import {
  SIGNUP_FROM_EMAIL,
  SIGNUP_OWNER_EMAIL,
  cleanSignupText,
  hashSignupToken,
  isValidSignupEmail,
  newSignupToken,
  signupOwnerNoticeHtml,
} from '@/lib/signup-requests'
import { signupDecideUrls } from '@/lib/signup-request-actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

/**
 * Public Get started form. Stores a pending request and emails Mineral Map
 * accept/decline links. Does not create an Auth user.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    email?: string
    company?: string
    website?: string
  }

  if (cleanSignupText(body.website, 80)) {
    return NextResponse.json({ success: true, data: { queued: true }, error: null })
  }

  const fullName = cleanSignupText(body.name, 120)
  const email = cleanSignupText(body.email, 200).toLowerCase()
  const company = cleanSignupText(body.company, 160) || null

  if (!fullName || !email) {
    return NextResponse.json(
      { success: false, data: null, error: 'Name and email are required' },
      { status: 400 },
    )
  }
  if (!isValidSignupEmail(email)) {
    return NextResponse.json(
      { success: false, data: null, error: 'Enter a valid work email' },
      { status: 400 },
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendKey = process.env.RESEND_API_KEY?.trim()
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { success: false, data: null, error: 'Signup is not configured yet.' },
      { status: 500 },
    )
  }
  if (!resendKey) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'Email is not configured. Please email management@mineralmapllc.com.',
      },
      { status: 503 },
    )
  }
  if (!appBaseUrl()) {
    return NextResponse.json(
      { success: false, data: null, error: 'NEXT_PUBLIC_APP_URL is not set' },
      { status: 500 },
    )
  }

  const admin = adminDb()
  const { data: existing } = await admin
    .from('signup_requests')
    .select('id, status')
    .ilike('email', email)
    .in('status', ['pending', 'accepted', 'onboarded'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const status = String((existing as { status?: string }).status ?? '')
    return NextResponse.json({
      success: true,
      data: {
        already: true,
        status,
        message:
          status === 'onboarded'
            ? 'This email already has a workspace. Sign in instead.'
            : status === 'accepted'
            ? 'This email was already approved. Check your inbox for the signup link, or sign in.'
            : 'We already have this request. Mineral Map will email you if you are approved.',
      },
      error: null,
    })
  }

  const token = newSignupToken()
  const { data: inserted, error: insertError } = await admin
    .from('signup_requests')
    .insert({
      full_name: fullName,
      email,
      company,
      decision_token_hash: hashSignupToken(token),
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('signup_requests insert:', insertError.message)
    return NextResponse.json(
      { success: false, data: null, error: 'Could not save your request. Try again.' },
      { status: 500 },
    )
  }

  const urls = signupDecideUrls(token)
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: SIGNUP_FROM_EMAIL,
      to: [SIGNUP_OWNER_EMAIL],
      reply_to: email,
      subject: `Signup request — ${fullName}${company ? ` (${company})` : ''}`,
      html: signupOwnerNoticeHtml({
        name: fullName,
        email,
        company: company ?? undefined,
        acceptUrl: urls.acceptUrl,
        declineUrl: urls.declineUrl,
      }),
      text: `${fullName} <${email}> requested Mineral Map access.\nAccept: ${urls.acceptUrl}\nDecline: ${urls.declineUrl}`,
    }),
  })

  if (!emailRes.ok) {
    const detail = await emailRes.text()
    console.error('Resend signup-request error:', detail)
    await admin.from('signup_requests').delete().eq('id', (inserted as { id: string }).id)
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'Could not notify Mineral Map. Please email management@mineralmapllc.com.',
      },
      { status: 502 },
    )
  }

  await logEmailSend(admin, {
    kind: 'signup_request',
    toEmail: SIGNUP_OWNER_EMAIL,
    meta: { from: email, name: fullName, company },
  })

  return NextResponse.json({
    success: true,
    data: { id: (inserted as { id: string }).id },
    error: null,
  })
}
