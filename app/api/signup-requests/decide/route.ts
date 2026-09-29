import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  acceptSignupRequest,
  declineSignupRequest,
  loadSignupRequestByToken,
} from '@/lib/signup-request-actions'
import { decidePageHtml } from '@/lib/signup-requests'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function html(status: number, page: string) {
  return new NextResponse(page, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

function parseAction(value: string | null): 'accept' | 'decline' | null {
  if (value === 'accept' || value === 'decline') return value
  return null
}

async function readBody(req: NextRequest): Promise<{ token: string; action: string | null }> {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as { token?: string; action?: string }
    return { token: String(body.token ?? ''), action: body.action ?? null }
  }
  const form = await req.formData().catch(() => null)
  if (form) {
    return {
      token: String(form.get('token') ?? ''),
      action: form.get('action') ? String(form.get('action')) : null,
    }
  }
  return { token: '', action: null }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim() || ''
  const action = parseAction(req.nextUrl.searchParams.get('action'))
  if (!token || !action) {
    return html(
      400,
      decidePageHtml({
        title: 'Invalid link',
        body: 'This accept/decline link is missing information. Open the Owner portfolio instead.',
      }),
    )
  }

  const admin = adminDb()
  let request
  try {
    request = await loadSignupRequestByToken(admin, token)
  } catch (err) {
    return html(
      500,
      decidePageHtml({
        title: 'Could not load request',
        body: err instanceof Error ? err.message : 'Unknown error',
      }),
    )
  }

  if (!request) {
    return html(
      404,
      decidePageHtml({
        title: 'Request not found',
        body: 'This link is expired or already used. Check the Owner portfolio.',
      }),
    )
  }

  if (request.status !== 'pending') {
    return html(
      200,
      decidePageHtml({
        title: `Already ${request.status}`,
        body:
          request.status === 'accepted'
            ? 'This person was already approved. If they did not get the email, resend from Owner.'
            : `This request is ${request.status}.`,
        name: request.full_name,
        email: request.email,
      }),
    )
  }

  return html(
    200,
    decidePageHtml({
      title: action === 'accept' ? 'Approve this signup?' : 'Decline this signup?',
      body:
        action === 'accept'
          ? 'Confirming sends them a Resend email with a link to choose a password, sign the agreement, add a card, and say if they are the team admin.'
          : 'Confirming emails them that we are not opening a workspace for this request.',
      token,
      action,
      name: request.full_name,
      email: request.email,
    }),
  )
}

export async function POST(req: NextRequest) {
  const fromQuery = {
    token: req.nextUrl.searchParams.get('token')?.trim() || '',
    action: req.nextUrl.searchParams.get('action'),
  }
  const fromBody = await readBody(req)
  const token = fromBody.token || fromQuery.token
  const action = parseAction(fromBody.action || fromQuery.action)
  if (!token || !action) {
    return html(
      400,
      decidePageHtml({
        title: 'Invalid request',
        body: 'Missing token or action.',
      }),
    )
  }

  const admin = adminDb()
  let request
  try {
    request = await loadSignupRequestByToken(admin, token)
  } catch (err) {
    return html(
      500,
      decidePageHtml({
        title: 'Could not load request',
        body: err instanceof Error ? err.message : 'Unknown error',
      }),
    )
  }
  if (!request) {
    return html(
      404,
      decidePageHtml({ title: 'Request not found', body: 'This link is expired or already used.' }),
    )
  }
  if (request.status !== 'pending') {
    return html(
      200,
      decidePageHtml({
        title: `Already ${request.status}`,
        body: 'No further action was taken.',
        name: request.full_name,
        email: request.email,
      }),
    )
  }

  try {
    if (action === 'accept') {
      const result = await acceptSignupRequest(admin, { request })
      return html(
        200,
        decidePageHtml({
          title: 'Approved',
          body: result.emailed
            ? `We emailed ${request.email} a signup link.`
            : `Approved, but the signup email did not send (${result.emailError || 'Resend error'}). Copy the link from Owner if needed.`,
          name: request.full_name,
          email: request.email,
        }),
      )
    }
    await declineSignupRequest(admin, { request })
    return html(
      200,
      decidePageHtml({
        title: 'Declined',
        body: `We marked ${request.email} as declined and emailed them.`,
        name: request.full_name,
        email: request.email,
      }),
    )
  } catch (err) {
    return html(
      500,
      decidePageHtml({
        title: 'Could not update request',
        body: err instanceof Error ? err.message : 'Unknown error',
      }),
    )
  }
}
