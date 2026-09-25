import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { isPlatformOwner } from '@/lib/team'
import { isBillingExempt } from '@/lib/access'
import { billingMonthKey, estimateMonthlySkipTraceCost } from '@/lib/billing'
import { createTeamSkipTraceInvoice } from '@/lib/stripe-invoices'

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
 * Create a Stripe draft invoice for one team's skip-trace phone hits.
 * Body: { team_owner_id, month?, send? }
 * Default is a draft (not emailed). Set send=true to email the customer.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireOwner(req)
  if (error) return error

  const body = (await req.json().catch(() => ({}))) as {
    team_owner_id?: string
    month?: string
    send?: boolean
  }
  const teamOwnerId = String(body.team_owner_id ?? '').trim()
  const month = String(body.month ?? billingMonthKey()).trim()
  const send = body.send === true

  if (!teamOwnerId) {
    return NextResponse.json(
      { success: false, data: null, error: 'team_owner_id is required' },
      { status: 400 },
    )
  }

  const adminClient = adminDb()
  const { data: ownerUser } = await adminClient.auth.admin.getUserById(teamOwnerId)
  const ownerEmail = ownerUser?.user?.email ?? null
  const ownerMeta = (ownerUser?.user?.user_metadata ?? {}) as Record<string, unknown>
  if (isBillingExempt(ownerMeta)) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'This team is billing-exempt — skip-trace charges are waived.',
      },
      { status: 400 },
    )
  }

  const { data: ownerSub } = await adminClient
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', teamOwnerId)
    .maybeSingle()
  const stripeCustomerId = String(
    (ownerSub as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? '',
  ).trim()
  if (!stripeCustomerId) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error:
          'No Stripe customer on this team. They need a seat subscription (or a customer attached in Stripe) before we can invoice skip-traces.',
      },
      { status: 400 },
    )
  }

  const { data: usageRows, error: usageError } = await adminClient
    .from('skip_trace_usage')
    .select('billable_count, user_id, team_owner_id')
    .eq('month', month)

  if (usageError) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error:
          usageError.message.includes('billable_count')
            ? 'Run the skip_trace_usage.billable_count migration first.'
            : usageError.message,
      },
      { status: 500 },
    )
  }

  const { data: memberRows } = await adminClient
    .from('team_members')
    .select('member_id')
    .eq('owner_id', teamOwnerId)
    .neq('status', 'revoked')
  const teamUserIds = new Set<string>([
    teamOwnerId,
    ...((memberRows ?? []) as Array<{ member_id?: string | null }>)
      .map((m) => String(m.member_id ?? '').trim())
      .filter(Boolean),
  ])

  const billableCount = ((usageRows ?? []) as Array<{
    billable_count?: number | null
    user_id?: string | null
    team_owner_id?: string | null
  }>).reduce((sum, row) => {
    const uid = String(row.user_id ?? '').trim()
    const owner = String(row.team_owner_id ?? '').trim()
    if (owner === teamOwnerId || teamUserIds.has(uid)) {
      return sum + Number(row.billable_count ?? 0)
    }
    return sum
  }, 0)

  if (billableCount <= 0) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'No billable skip-traces (phone hits) for this team this month.',
      },
      { status: 400 },
    )
  }

  const { data: existing } = await adminClient
    .from('skip_trace_invoices')
    .select('stripe_invoice_id, status')
    .eq('team_owner_id', teamOwnerId)
    .eq('month', month)
    .maybeSingle()

  try {
    const invoice = await createTeamSkipTraceInvoice({
      stripeCustomerId,
      teamOwnerId,
      ownerEmail,
      month,
      billableCount,
      send,
      existingStripeInvoiceId:
        (existing as { stripe_invoice_id?: string | null } | null)?.stripe_invoice_id ??
        null,
    })

    const row = {
      team_owner_id: teamOwnerId,
      month,
      billable_count: invoice.billableCount,
      amount_usd: invoice.amountUsd,
      stripe_customer_id: stripeCustomerId,
      stripe_invoice_id: invoice.stripeInvoiceId,
      hosted_invoice_url: invoice.hostedInvoiceUrl,
      status: invoice.status,
      updated_at: new Date().toISOString(),
    }

    const { error: upsertError } = await adminClient
      .from('skip_trace_invoices')
      .upsert(row, { onConflict: 'team_owner_id,month' })
    if (upsertError) {
      console.error('skip_trace_invoices upsert:', upsertError.message)
    }

    return NextResponse.json({
      success: true,
      data: {
        ...invoice,
        amount_usd: estimateMonthlySkipTraceCost(billableCount),
        month,
        team_owner_id: teamOwnerId,
        owner_email: ownerEmail,
      },
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Skip-trace invoice failed:', message)
    return NextResponse.json(
      { success: false, data: null, error: message },
      { status: 500 },
    )
  }
}
