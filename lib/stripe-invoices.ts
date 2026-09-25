import Stripe from 'stripe'
import {
  SKIP_TRACE_INVOICE_DAYS_UNTIL_DUE,
  SKIP_TRACE_PRICE_USD,
  estimateMonthlySkipTraceCost,
} from '@/lib/billing'

function stripeClient(): Stripe {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeKey) {
    throw new Error('Missing STRIPE_SECRET_KEY')
  }
  return new Stripe(stripeKey, { apiVersion: '2024-06-20' })
}

function monthLabel(month: string): string {
  const [year, mm] = month.split('-')
  const date = new Date(Date.UTC(Number(year), Number(mm) - 1, 1))
  if (Number.isNaN(date.getTime())) return month
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export type SkipTraceInvoiceResult = {
  stripeInvoiceId: string
  hostedInvoiceUrl: string | null
  status: string
  billableCount: number
  amountUsd: number
}

/**
 * Create (or reuse) a Stripe Invoice for one team's skip-trace phone hits.
 *
 * Uses Invoicing (`send_invoice`), not Billing Meters: the total sits as a
 * draft until we send it at month end. Idempotent per (customer, month)
 * via invoice metadata — callers should also persist skip_trace_invoices.
 */
export async function createTeamSkipTraceInvoice(input: {
  stripeCustomerId: string
  teamOwnerId: string
  ownerEmail?: string | null
  month: string
  billableCount: number
  send?: boolean
  existingStripeInvoiceId?: string | null
}): Promise<SkipTraceInvoiceResult> {
  const stripe = stripeClient()
  const billableCount = Math.max(0, Math.floor(Number(input.billableCount) || 0))
  const amountUsd = estimateMonthlySkipTraceCost(billableCount)

  if (billableCount <= 0) {
    throw new Error('No billable skip-traces (phone hits) for this team/month')
  }

  if (input.ownerEmail) {
    await stripe.customers.update(input.stripeCustomerId, {
      email: input.ownerEmail,
    })
  }

  let invoice: Stripe.Invoice | null = null

  if (input.existingStripeInvoiceId) {
    invoice = await stripe.invoices.retrieve(input.existingStripeInvoiceId)
  }

  if (!invoice) {
    const existing = await stripe.invoices.list({
      customer: input.stripeCustomerId,
      limit: 20,
    })
    invoice =
      existing.data.find(
        (inv) =>
          inv.metadata?.kind === 'skip_trace' &&
          inv.metadata?.month === input.month &&
          inv.metadata?.team_owner_id === input.teamOwnerId &&
          inv.status !== 'void',
      ) ?? null
  }

  if (invoice?.status === 'draft') {
    const dueUsd = Math.round((invoice.amount_due ?? invoice.total ?? 0) / 100)
    if (dueUsd !== amountUsd) {
      await stripe.invoices.del(invoice.id)
      invoice = null
    }
  }

  if (!invoice) {
    invoice = await stripe.invoices.create({
      customer: input.stripeCustomerId,
      collection_method: 'send_invoice',
      days_until_due: SKIP_TRACE_INVOICE_DAYS_UNTIL_DUE,
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      metadata: {
        kind: 'skip_trace',
        month: input.month,
        team_owner_id: input.teamOwnerId,
      },
      description: `Skip-trace phone hits — ${monthLabel(input.month)}`,
    })

    await stripe.invoiceItems.create({
      customer: input.stripeCustomerId,
      invoice: invoice.id,
      currency: 'usd',
      amount: Math.round(SKIP_TRACE_PRICE_USD * 100) * billableCount,
      description: `${billableCount} skip-trace lookup${billableCount === 1 ? '' : 's'} × $${SKIP_TRACE_PRICE_USD.toFixed(2)} (phone number returned, ${monthLabel(input.month)})`,
    })

    invoice = await stripe.invoices.retrieve(invoice.id)
  }

  if (input.send && invoice.status === 'draft') {
    invoice = await stripe.invoices.sendInvoice(invoice.id)
  }

  return {
    stripeInvoiceId: invoice.id,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    status: invoice.status ?? 'draft',
    billableCount,
    amountUsd,
  }
}
