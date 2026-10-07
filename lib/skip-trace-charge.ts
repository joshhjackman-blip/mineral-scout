import type { SupabaseClient } from '@supabase/supabase-js'
import { estimateMonthlySkipTraceCost } from '@/lib/billing'
import { isGreatPlainsMember, isSkipTraceCompedTeam } from '@/lib/team'
import { createTeamSkipTraceInvoice, type SkipTraceInvoiceResult } from '@/lib/stripe-invoices'
import { setTeamPastDue, stripeClient } from '@/lib/stripe-card'

export type ChargeTeamResult = SkipTraceInvoiceResult & {
  teamOwnerId: string
  month: string
  ownerEmail: string | null
  skipped?: boolean
  skipReason?: string
}

async function teamMemberIds(
  admin: SupabaseClient,
  teamOwnerId: string,
): Promise<Set<string>> {
  const { data: memberRows } = await admin
    .from('team_members')
    .select('member_id')
    .eq('owner_id', teamOwnerId)
    .neq('status', 'revoked')
  return new Set<string>([
    teamOwnerId,
    ...((memberRows ?? []) as Array<{ member_id?: string | null }>)
      .map((m) => String(m.member_id ?? '').trim())
      .filter(Boolean),
  ])
}

export async function teamBillableSkipTraceCount(
  admin: SupabaseClient,
  teamOwnerId: string,
  month: string,
): Promise<number> {
  const { data: usageRows, error } = await admin
    .from('skip_trace_usage')
    .select('billable_count, user_id, team_owner_id')
    .eq('month', month)
  if (error) {
    throw new Error(
      error.message.includes('billable_count')
        ? 'Run the skip_trace_usage.billable_count migration first.'
        : error.message,
    )
  }
  const teamUserIds = await teamMemberIds(admin, teamOwnerId)
  return ((usageRows ?? []) as Array<{
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
}

export async function listTeamsWithBillableUsage(
  admin: SupabaseClient,
  month: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('skip_trace_usage')
    .select('user_id, team_owner_id, billable_count')
    .eq('month', month)
  if (error) {
    throw new Error(error.message)
  }
  const ids = new Set<string>()
  for (const row of (data ?? []) as Array<{
    user_id?: string | null
    team_owner_id?: string | null
    billable_count?: number | null
  }>) {
    if (Number(row.billable_count ?? 0) <= 0) continue
    const owner = String(row.team_owner_id ?? '').trim()
    const uid = String(row.user_id ?? '').trim()
    ids.add(owner || uid)
  }
  return Array.from(ids).filter(Boolean)
}

async function persistInvoiceRow(
  admin: SupabaseClient,
  input: {
    teamOwnerId: string
    month: string
    stripeCustomerId: string
    invoice: SkipTraceInvoiceResult
    billableCount: number
  },
): Promise<void> {
  const { error } = await admin.from('skip_trace_invoices').upsert(
    {
      team_owner_id: input.teamOwnerId,
      month: input.month,
      billable_count: input.billableCount,
      amount_usd: estimateMonthlySkipTraceCost(input.billableCount),
      stripe_customer_id: input.stripeCustomerId,
      stripe_invoice_id: input.invoice.stripeInvoiceId,
      hosted_invoice_url: input.invoice.hostedInvoiceUrl,
      status: input.invoice.status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'team_owner_id,month' },
  )
  if (error) {
    console.error('skip_trace_invoices upsert:', error.message)
  }
}

/**
 * Charge one team's month-end skip-trace total to the card on file.
 * Idempotent when the existing invoice is already paid for this count.
 */
export async function chargeTeamSkipTraceMonth(
  admin: SupabaseClient,
  input: { teamOwnerId: string; month: string },
): Promise<ChargeTeamResult> {
  const { data: ownerUser } = await admin.auth.admin.getUserById(input.teamOwnerId)
  const ownerEmail = ownerUser?.user?.email ?? null
  if (isSkipTraceCompedTeam(ownerEmail) || isGreatPlainsMember(ownerEmail)) {
    return {
      stripeInvoiceId: '',
      hostedInvoiceUrl: null,
      status: 'skipped',
      billableCount: 0,
      amountUsd: 0,
      charged: false,
      teamOwnerId: input.teamOwnerId,
      month: input.month,
      ownerEmail,
      skipped: true,
      skipReason: 'waived',
    }
  }

  const { data: ownerSub } = await admin
    .from('subscriptions')
    .select('stripe_customer_id, has_card, stripe_subscription_id')
    .eq('user_id', input.teamOwnerId)
    .maybeSingle()
  const stripeCustomerId = String(
    (ownerSub as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? '',
  ).trim()
  const hasCard = Boolean(
    (ownerSub as { has_card?: boolean | null } | null)?.has_card ||
      String(
        (ownerSub as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id ??
          '',
      ).trim(),
  )
  if (!stripeCustomerId) {
    throw new Error('No Stripe customer on this team. They need to add a card on Account.')
  }
  if (!hasCard) {
    throw new Error('No card on file for this team. They need to add a card on Account.')
  }

  const billableCount = await teamBillableSkipTraceCount(
    admin,
    input.teamOwnerId,
    input.month,
  )
  if (billableCount <= 0) {
    throw new Error('No billable skip-traces (phone hits) for this team this month.')
  }

  const { data: existing } = await admin
    .from('skip_trace_invoices')
    .select('stripe_invoice_id, status, billable_count')
    .eq('team_owner_id', input.teamOwnerId)
    .eq('month', input.month)
    .maybeSingle()

  const existingStatus = String(
    (existing as { status?: string | null } | null)?.status ?? '',
  )
  const alreadyBilled = Number(
    (existing as { billable_count?: number | null } | null)?.billable_count ?? 0,
  )
  if (existingStatus === 'paid' && billableCount <= alreadyBilled) {
    return {
      stripeInvoiceId:
        (existing as { stripe_invoice_id?: string | null } | null)?.stripe_invoice_id ?? '',
      hostedInvoiceUrl: null,
      status: 'paid',
      billableCount,
      amountUsd: estimateMonthlySkipTraceCost(billableCount),
      charged: true,
      teamOwnerId: input.teamOwnerId,
      month: input.month,
      ownerEmail,
      skipped: true,
      skipReason: 'already_paid',
    }
  }

  const createAdditional = existingStatus === 'paid' && billableCount > alreadyBilled
  const chargeCount = createAdditional ? billableCount - alreadyBilled : billableCount

  try {
    const invoice = await createTeamSkipTraceInvoice({
      stripeCustomerId,
      teamOwnerId: input.teamOwnerId,
      ownerEmail,
      month: input.month,
      billableCount: chargeCount,
      charge: true,
      createAdditional,
      existingStripeInvoiceId: createAdditional
        ? null
        : (existing as { stripe_invoice_id?: string | null } | null)?.stripe_invoice_id ??
          null,
    })

    await persistInvoiceRow(admin, {
      teamOwnerId: input.teamOwnerId,
      month: input.month,
      stripeCustomerId,
      invoice: {
        ...invoice,
        billableCount,
        amountUsd: estimateMonthlySkipTraceCost(billableCount),
      },
      billableCount,
    })

    if (invoice.status === 'paid') {
      await setTeamPastDue(admin, input.teamOwnerId, false)
    } else {
      await setTeamPastDue(admin, input.teamOwnerId, true)
    }

    return {
      ...invoice,
      billableCount,
      amountUsd: estimateMonthlySkipTraceCost(billableCount),
      teamOwnerId: input.teamOwnerId,
      month: input.month,
      ownerEmail,
    }
  } catch (err) {
    await setTeamPastDue(admin, input.teamOwnerId, true)
    try {
      const stripe = stripeClient()
      const listed = await stripe.invoices.list({
        customer: stripeCustomerId,
        limit: 10,
      })
      const open = listed.data.find(
        (inv) =>
          inv.metadata?.kind === 'skip_trace' &&
          inv.metadata?.month === input.month &&
          inv.metadata?.team_owner_id === input.teamOwnerId &&
          (inv.status === 'open' || inv.status === 'uncollectible'),
      )
      if (open) {
        await persistInvoiceRow(admin, {
          teamOwnerId: input.teamOwnerId,
          month: input.month,
          stripeCustomerId,
          invoice: {
            stripeInvoiceId: open.id,
            hostedInvoiceUrl: open.hosted_invoice_url ?? null,
            status: open.status ?? 'open',
            billableCount,
            amountUsd: estimateMonthlySkipTraceCost(billableCount),
            charged: false,
          },
          billableCount,
        })
      }
    } catch (persistErr) {
      console.error(
        'chargeTeamSkipTraceMonth persist after failure:',
        persistErr instanceof Error ? persistErr.message : persistErr,
      )
    }
    throw err
  }
}
