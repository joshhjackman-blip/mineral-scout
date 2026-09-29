import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { isPlatformOwner } from '@/lib/team'
import { billingMonthKey, estimateMonthlySkipTraceCost } from '@/lib/billing'
import { chargeTeamSkipTraceMonth } from '@/lib/skip-trace-charge'

export const dynamic = 'force-dynamic'

async function requireOwner(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value)
            res.cookies.set(name, value, options)
          })
        },
      },
    },
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isPlatformOwner(user.email)) {
    return {
      user: null as null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return { user, error: null as NextResponse | null }
}

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

type InvoiceRow = {
  team_owner_id: string
  month: string
  billable_count: number
  amount_usd: number
  stripe_customer_id: string | null
  stripe_invoice_id: string | null
  hosted_invoice_url: string | null
  status: string
}

export async function GET(req: NextRequest) {
  const { error } = await requireOwner(req)
  if (error) return error

  const month =
    req.nextUrl.searchParams.get('month')?.trim() || billingMonthKey()
  const adminClient = adminDb()
  const { data, error: listError } = await adminClient
    .from('skip_trace_invoices')
    .select(
      'team_owner_id, month, billable_count, amount_usd, stripe_customer_id, stripe_invoice_id, hosted_invoice_url, status',
    )
    .eq('month', month)

  if (listError) {
    return NextResponse.json({
      success: true,
      data: { month, invoices: [] as InvoiceRow[] },
      error: listError.message,
    })
  }

  return NextResponse.json({
    success: true,
    data: { month, invoices: (data ?? []) as InvoiceRow[] },
    error: null,
  })
}

/**
 * Charge the team's card on file for skip-trace phone hits.
 * Body: { team_owner_id, month? }
 */
export async function POST(req: NextRequest) {
  const { error } = await requireOwner(req)
  if (error) return error

  const body = (await req.json().catch(() => ({}))) as {
    team_owner_id?: string
    month?: string
  }
  const teamOwnerId = String(body.team_owner_id ?? '').trim()
  const month = String(body.month ?? billingMonthKey()).trim()

  if (!teamOwnerId) {
    return NextResponse.json(
      { success: false, data: null, error: 'team_owner_id is required' },
      { status: 400 },
    )
  }

  const adminClient = adminDb()

  try {
    const invoice = await chargeTeamSkipTraceMonth(adminClient, {
      teamOwnerId,
      month,
    })

    if (invoice.skipped && invoice.skipReason === 'waived') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: 'Skip-trace is waived for this owner team (Mineral Map / Great Plains).',
        },
        { status: 400 },
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        ...invoice,
        amount_usd: estimateMonthlySkipTraceCost(invoice.billableCount),
        month,
        team_owner_id: teamOwnerId,
        owner_email: invoice.ownerEmail,
      },
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Skip-trace charge failed:', message)
    return NextResponse.json(
      { success: false, data: null, error: message },
      { status: 500 },
    )
  }
}
