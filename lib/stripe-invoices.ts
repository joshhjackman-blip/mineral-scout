import Stripe from 'stripe'
import {
  SKIP_TRACE_PRICE_USD,
  estimateMonthlySkipTraceCost,
} from '@/lib/billing'
import { STRIPE_API_VERSION } from '@/lib/stripe-card'

function stripeClient(): Stripe {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeKey) {
    throw new Error('Missing STRIPE_SECRET_KEY')
  }
  return new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION })
}

export function monthLabel(month: string): string {
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
  charged: boolean
}

function isSkipTraceInvoice(
  inv: Stripe.Invoice,
  input: { month: string; teamOwnerId: string },
): boolean {
  return (
    inv.metadata?.kind === 'skip_trace' &&
    inv.metadata?.month === input.month &&
    inv.metadata?.team_owner_id === input.teamOwnerId &&
    inv.status !== 'void'
  )
}

function dueUsd(invoice: Stripe.Invoice): number {
  return Math.round((invoice.amount_due ?? invoice.total ?? 0) / 100)
}

/**
 * Create (or reuse) a Stripe Invoice for one team's skip-trace phone hits
 * and charge the default card on file.
 *
 * Idempotent per (customer, month) via invoice metadata. Paid invoices are
 * reused unless `createAdditional` is set (delta after an early charge).
 */
export async function createTeamSkipTraceInvoice(input: {
  stripeCustomerId: string
  teamOwnerId: string
  ownerEmail?: string | null
  month: string
  billableCount: number
  charge?: boolean
  createAdditional?: boolean
  existingStripeInvoiceId?: string | null
}): Promise<SkipTraceInvoiceResult> {
  const stripe = stripeClient()
  const billableCount = Math.max(0, Math.floor(Number(input.billableCount) || 0))
  const amountUsd = estimateMonthlySkipTraceCost(billableCount)
  const charge = input.charge !== false

  if (billableCount <= 0) {
    throw new Error('No billable skip-traces (phone hits) for this team/month')
  }

  if (input.ownerEmail) {
    await stripe.customers.update(input.stripeCustomerId, {
      email: input.ownerEmail,
    })
  }

  let invoice: Stripe.Invoice | null = null

  if (input.existingStripeInvoiceId && !input.createAdditional) {
    invoice = await stripe.invoices.retrieve(input.existingStripeInvoiceId)
  }

  if (!invoice) {
    const existing = await stripe.invoices.list({
      customer: input.stripeCustomerId,
      limit: 20,
    })
    invoice =
      existing.data.find((inv) => {
        if (!isSkipTraceInvoice(inv, input)) return false
        if (input.createAdditional && inv.status === 'paid') return false
        return true
      }) ?? null
  }

  if (invoice?.status === 'paid' && !input.createAdditional) {
    return {
      stripeInvoiceId: invoice.id,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      status: invoice.status,
      billableCount,
      amountUsd: dueUsd(invoice) || amountUsd,
      charged: true,
    }
  }

  if (invoice?.status === 'draft') {
    if (dueUsd(invoice) !== amountUsd) {
      await stripe.invoices.del(invoice.id)
      invoice = null
    }
  } else if (invoice?.status === 'open' && dueUsd(invoice) !== amountUsd) {
    await stripe.invoices.voidInvoice(invoice.id)
    invoice = null
  }

  if (!invoice) {
    invoice = await stripe.invoices.create({
      customer: input.stripeCustomerId,
      collection_method: 'charge_automatically',
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      metadata: {
        kind: 'skip_trace',
        month: input.month,
        team_owner_id: input.teamOwnerId,
        billable_count: String(billableCount),
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

  if (charge && invoice.status === 'draft') {
    invoice = await stripe.invoices.finalizeInvoice(invoice.id)
  }

  if (charge && invoice.status === 'open') {
    invoice = await stripe.invoices.pay(invoice.id)
  }

  return {
    stripeInvoiceId: invoice.id,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    status: invoice.status ?? 'draft',
    billableCount,
    amountUsd,
    charged: invoice.status === 'paid',
  }
}

export async function retryOpenSkipTraceInvoices(
  stripe: Stripe,
  customerId: string,
): Promise<{ paid: number; failed: number }> {
  const open = await stripe.invoices.list({
    customer: customerId,
    status: 'open',
    limit: 20,
  })
  let paid = 0
  let failed = 0
  for (const inv of open.data) {
    if (inv.metadata?.kind !== 'skip_trace') continue
    try {
      const result = await stripe.invoices.pay(inv.id)
      if (result.status === 'paid') paid += 1
      else failed += 1
    } catch (err) {
      failed += 1
      console.error(
        'retryOpenSkipTraceInvoices:',
        inv.id,
        err instanceof Error ? err.message : err,
      )
    }
  }
  return { paid, failed }
}
