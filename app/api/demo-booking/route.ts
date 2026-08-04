import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { logEmailSend } from '@/lib/usage-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TO_EMAIL = 'management@mineralmapllc.com'
const FROM_EMAIL = 'Mineral Map <noreply@getmineralmap.com>'

type DemoBookingBody = {
  name?: string
  email?: string
  company?: string
  phone?: string
  preferredTime?: string
  notes?: string
  /** Honeypot — must stay empty */
  website?: string
}

function clean(value: unknown, max = 500): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * POST /api/demo-booking
 * Sends a demo request to management@mineralmapllc.com via Resend.
 */
export async function POST(request: NextRequest) {
  let body: DemoBookingBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: 'invalid JSON body' },
      { status: 400 },
    )
  }

  // Bot honeypot
  if (clean(body.website, 100)) {
    return NextResponse.json({ success: true, data: { queued: true }, error: null })
  }

  const name = clean(body.name, 120)
  const email = clean(body.email, 200).toLowerCase()
  const company = clean(body.company, 160)
  const phone = clean(body.phone, 60)
  const preferredTime = clean(body.preferredTime, 200)
  const notes = clean(body.notes, 2000)

  if (!name || !email) {
    return NextResponse.json(
      { success: false, data: null, error: 'Name and email are required' },
      { status: 400 },
    )
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { success: false, data: null, error: 'Enter a valid email address' },
      { status: 400 },
    )
  }

  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    console.error('RESEND_API_KEY missing; demo booking not sent')
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'Email is not configured yet. Please email management@mineralmapllc.com directly.',
      },
      { status: 503 },
    )
  }

  const rows = [
    ['Name', name],
    ['Email', email],
    ['Company', company || '—'],
    ['Phone', phone || '—'],
    ['Preferred time', preferredTime || '—'],
    ['Notes', notes || '—'],
  ]

  const htmlRows = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:8px 12px 8px 0;font-size:13px;color:#6B7280;vertical-align:top;white-space:nowrap;">${label}</td>
        <td style="padding:8px 0;font-size:14px;color:#111827;vertical-align:top;">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join('')

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      reply_to: email,
      subject: `Demo request — ${name}${company ? ` (${company})` : ''}`,
      html: `
        <div style="font-family:Geist,Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;">
          <h1 style="font-size:22px;color:#111827;margin:0 0 8px;">New demo booking request</h1>
          <p style="font-size:14px;color:#6B7280;margin:0 0 24px;line-height:1.5;">
            Submitted from the Mineral Map book-a-demo page.
          </p>
          <table style="width:100%;border-collapse:collapse;">${htmlRows}</table>
          <p style="font-size:12px;color:#9CA3AF;margin-top:28px;">
            Reply directly to this email to reach ${escapeHtml(name)} at ${escapeHtml(email)}.
          </p>
        </div>
      `,
      text: rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
    }),
  })

  if (!emailRes.ok) {
    const detail = await emailRes.text()
    console.error('Resend demo-booking error:', detail)
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'Could not send your request. Please email management@mineralmapllc.com.',
      },
      { status: 502 },
    )
  }

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
    await logEmailSend(adminClient, {
      kind: 'demo_booking',
      toEmail: TO_EMAIL,
      meta: { from: email, name, company: company || null },
    })
  }

  return NextResponse.json({
    success: true,
    data: { to: TO_EMAIL },
    error: null,
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
