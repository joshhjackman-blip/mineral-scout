import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { CURRENT_AGREEMENT_VERSION } from '@/lib/agreement'

// Captures IP + user agent server-side and writes one row to
// public.platform_agreement_signatures. Requires a logged-in session so
// we can bind user_id and stamp agreement_version on user_metadata for
// the middleware / API gate.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SignPayload = {
  signer_name?: string
  signer_email?: string
  signer_entity?: string | null
  signer_title?: string | null
  typed_signature?: string
  agreement_version?: string
  consent_checkboxes?: Record<string, boolean>
}

function firstNonEmptyHeader(headers: Headers, names: string[]): string | null {
  for (const name of names) {
    const value = headers.get(name)
    if (value) {
      const first = value.split(',')[0]?.trim()
      if (first) return first
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  const cookieRes = NextResponse.next()
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
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            cookieRes.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user?.email) {
    return NextResponse.json(
      { ok: false, error: 'Sign in required before signing the agreement.' },
      { status: 401 },
    )
  }

  let body: SignPayload
  try {
    body = (await request.json()) as SignPayload
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const signerName = (body.signer_name || '').trim()
  const signerEmail = (body.signer_email || user.email || '').trim().toLowerCase()
  const typedSignature = (body.typed_signature || signerName).trim() || signerName
  const version = (body.agreement_version || '').trim() || CURRENT_AGREEMENT_VERSION
  const incoming = body.consent_checkboxes || {}
  // Classic flow: one "I agree" checkbox. Expand to full audit consents.
  const accepted =
    incoming.accepted === true ||
    (incoming.read === true &&
      incoming.authority === true &&
      incoming.bound === true &&
      incoming.esign_consent === true)
  const checkboxes = {
    read: true,
    authority: true,
    bound: true,
    esign_consent: true,
    accepted: true,
  }

  if (signerName.length < 2)
    return NextResponse.json({ ok: false, error: 'Signer name is required.' }, { status: 400 })
  if (!/.+@.+\..+/.test(signerEmail))
    return NextResponse.json({ ok: false, error: 'Valid email is required.' }, { status: 400 })
  if (signerEmail !== user.email.toLowerCase()) {
    return NextResponse.json(
      { ok: false, error: 'Signer email must match your signed-in account.' },
      { status: 400 },
    )
  }
  if (!accepted) {
    return NextResponse.json(
      { ok: false, error: 'You must check the box to accept the agreement.' },
      { status: 400 },
    )
  }
  if (version !== CURRENT_AGREEMENT_VERSION) {
    return NextResponse.json(
      {
        ok: false,
        error: `Please sign the current agreement (version ${CURRENT_AGREEMENT_VERSION}).`,
      },
      { status: 400 },
    )
  }
  // typed_signature retained for audit; classic flow uses legal name as e-sign mark
  if (!typedSignature) {
    return NextResponse.json({ ok: false, error: 'Signature name is required.' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: 'Supabase environment is not configured.' },
      { status: 500 },
    )
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const ip = firstNonEmptyHeader(request.headers, [
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
    'fastly-client-ip',
    'true-client-ip',
  ])
  const userAgent = request.headers.get('user-agent')
  const signedAt = new Date().toISOString()

  const { data, error } = await client
    .from('platform_agreement_signatures')
    .insert({
      user_id: user.id,
      signer_name: signerName,
      signer_email: signerEmail,
      signer_entity: body.signer_entity?.trim() || null,
      signer_title: body.signer_title?.trim() || null,
      typed_signature: typedSignature,
      agreement_version: version,
      agreement_url: '/legal/agreement',
      consent_checkboxes: checkboxes,
      ip_address: ip,
      user_agent: userAgent,
      signed_at: signedAt,
    })
    .select('id, signer_name, signer_email, signed_at, agreement_version')
    .single()

  if (error) {
    console.error('[sign-agreement] insert error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const existingMeta = (user.user_metadata ?? {}) as Record<string, unknown>
  await client.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...existingMeta,
      agreement_version: version,
      agreement_signed_at: data?.signed_at ?? signedAt,
      agreement_signature_id: data?.id ?? null,
    },
  })

  return NextResponse.json({ ok: true, signature: data })
}
