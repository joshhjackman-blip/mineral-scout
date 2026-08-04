import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { logEmailSend } from '@/lib/usage-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TO_EMAIL = 'management@mineralmapllc.com'
const FROM_EMAIL = 'Mineral Map <noreply@getmineralmap.com>'

const CATEGORIES = [
  'billing',
  'technical',
  'account',
  'data_map',
  'other',
] as const

type Category = (typeof CATEGORIES)[number]

type HelpTicketBody = {
  subject?: string
  category?: string
  message?: string
  /** Honeypot — must stay empty */
  website?: string
}

function clean(value: unknown, max = 500): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function categoryLabel(category: Category): string {
  switch (category) {
    case 'billing':
      return 'Billing / success fee'
    case 'technical':
      return 'Technical issue'
    case 'account':
      return 'Account / seats'
    case 'data_map':
      return 'Data / map'
    default:
      return 'Other'
  }
}

/**
 * POST /api/help-ticket
 * Sends a help desk ticket to management@mineralmapllc.com via Resend.
 */
export async function POST(request: NextRequest) {
  let body: HelpTicketBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  if (clean(body.website, 100)) {
    return NextResponse.json({ success: true, data: { queued: true }, error: null })
  }

  const cookieStore = cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // No cookie writes needed.
        },
      },
    },
  )
  const {
    data: { session },
  } = await supabaseAuth.auth.getSession()

  if (!session?.user) {
    return NextResponse.json(
      { success: false, data: null, error: 'Sign in to submit a help ticket.' },
      { status: 401 },
    )
  }

  const subject = clean(body.subject, 160)
  const message = clean(body.message, 5000)
  const categoryRaw = clean(body.category, 40).toLowerCase()
  const category = (CATEGORIES as readonly string[]).includes(categoryRaw)
    ? (categoryRaw as Category)
    : 'other'

  if (!subject || !message) {
    return NextResponse.json(
      { success: false, data: null, error: 'Subject and message are required.' },
      { status: 400 },
    )
  }
  if (message.length < 10) {
    return NextResponse.json(
      { success: false, data: null, error: 'Please include a bit more detail in your message.' },
      { status: 400 },
    )
  }

  const fromEmail = (session.user.email ?? '').toLowerCase().trim()
  if (!fromEmail) {
    return NextResponse.json(
      { success: false, data: null, error: 'Your account needs an email address.' },
      { status: 400 },
    )
  }

  const ticketId = `HT-${Date.now().toString(36).toUpperCase()}`
  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    console.error('RESEND_API_KEY missing; help ticket not sent')
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'Email is not configured yet. Please email management@mineralmapllc.com directly.',
      },
      { status: 503 },
    )
  }

  const rows: Array<[string, string]> = [
    ['Ticket', ticketId],
    ['From', fromEmail],
    ['User ID', session.user.id],
    ['Category', categoryLabel(category)],
    ['Subject', subject],
    ['Message', message],
  ]

  const htmlRows = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:8px 12px 8px 0;font-size:13px;color:#6B7280;vertical-align:top;white-space:nowrap;">${label}</td>
        <td style="padding:8px 0;font-size:14px;color:#111827;vertical-align:top;white-space:pre-wrap;">${escapeHtml(value)}</td>
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
      reply_to: fromEmail,
      subject: `[Help ${ticketId}] ${categoryLabel(category)} — ${subject}`,
      html: `
        <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px 20px;">
          <h1 style="font-size:22px;color:#111827;margin:0 0 8px;">Help desk ticket</h1>
          <p style="font-size:14px;color:#6B7280;margin:0 0 24px;line-height:1.5;">
            Submitted from Mineral Map help desk.
          </p>
          <table style="width:100%;border-collapse:collapse;">${htmlRows}</table>
          <p style="font-size:12px;color:#9CA3AF;margin-top:28px;">
            Reply directly to this email to reach ${escapeHtml(fromEmail)}.
          </p>
        </div>
      `,
      text: rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
    }),
  })

  if (!emailRes.ok) {
    const detail = await emailRes.text()
    console.error('Resend help-ticket error:', detail)
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'Could not send your ticket. Please email management@mineralmapllc.com.',
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
      kind: 'help_ticket',
      toEmail: TO_EMAIL,
      userId: session.user.id,
      meta: {
        ticket_id: ticketId,
        from: fromEmail,
        subject,
        category,
      },
    })

    // Best-effort durable ticket row (table may not exist until migration runs).
    const { error: ticketError } = await adminClient.from('help_tickets').insert({
      ticket_id: ticketId,
      user_id: session.user.id,
      from_email: fromEmail,
      category,
      subject,
      message,
      status: 'open',
    })
    if (ticketError) {
      console.warn('help_tickets insert skipped:', ticketError.message)
    }
  }

  return NextResponse.json({
    success: true,
    data: { ticketId, to: TO_EMAIL },
    error: null,
  })
}
