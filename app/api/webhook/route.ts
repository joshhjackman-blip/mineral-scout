import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { seatPriceId } from '@/lib/billing'
import {
  persistCardFromCheckoutSession,
  setTeamPastDue,
  STRIPE_API_VERSION,
} from '@/lib/stripe-card'
import { retryOpenSkipTraceInvoices } from '@/lib/stripe-invoices'

function seatQuantityFromSubscription(sub: Stripe.Subscription): number {
  const seatPrice = seatPriceId()
  if (seatPrice) {
    const seatItem = sub.items.data.find((item) => item.price?.id === seatPrice)
    if (seatItem?.quantity && seatItem.quantity > 0) return seatItem.quantity
  }
  // Fallback: largest licensed quantity on the subscription.
  let maxQty = 1
  for (const item of sub.items.data) {
    if (item.price?.recurring?.usage_type === 'metered') continue
    const q = Number(item.quantity ?? 0)
    if (q > maxQty) maxQty = q
  }
  return maxQty
}

export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }
  const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION })

  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Webhook signature failed' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  if (
    event.type === 'customer.subscription.deleted' ||
    event.type === 'customer.subscription.paused'
  ) {
    const subscription = event.data.object as Stripe.Subscription
    await supabase
      .from('subscriptions')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', subscription.id)

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_subscription_id', subscription.id)
      .maybeSingle()

    if (sub?.user_id) {
      const { data: authUser } = await supabase.auth.admin.getUserById(sub.user_id)
      const existingMeta = (authUser?.user?.user_metadata ?? {}) as Record<string, unknown>
      // Grandfathered users keep complimentary access even if a Stripe sub ends.
      const nextStatus =
        existingMeta.billing_exempt === true ? 'active' : 'canceled'
      await supabase.auth.admin.updateUserById(sub.user_id, {
        user_metadata: {
          ...existingMeta,
          subscription_status: nextStatus,
        },
      })
    }
  }

  if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.created'
  ) {
    const sub = event.data.object as Stripe.Subscription
    const seatCount = seatQuantityFromSubscription(sub)
    const seatPrice = seatPriceId()

    await supabase
      .from('subscriptions')
      .update({
        status: sub.status,
        seat_count: seatCount,
        stripe_seat_price_id: seatPrice,
        stripe_skiptrace_price_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_subscription_id', sub.id)

    const { data: subRow } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_subscription_id', sub.id)
      .maybeSingle()

    if (subRow?.user_id) {
      const active = sub.status === 'active' || sub.status === 'trialing'
      const { data: authUser } = await supabase.auth.admin.getUserById(subRow.user_id)
      const existingMeta = (authUser?.user?.user_metadata ?? {}) as Record<string, unknown>
      await supabase.auth.admin.updateUserById(subRow.user_id, {
        user_metadata: {
          ...existingMeta,
          // Legacy seat-paywall flag — access is free; keep status in sync.
          subscription_status:
            existingMeta.billing_exempt === true || active
              ? 'active'
              : sub.status,
          seat_count: seatCount,
          stripe_seat_price_id: seatPrice,
        },
      })
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.mode === 'setup' && session.metadata?.kind === 'skip_trace_card') {
      try {
        const full = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['setup_intent.payment_method'],
        })
        const card = await persistCardFromCheckoutSession(stripe, supabase, full)
        const userId = String(full.metadata?.user_id ?? '').trim()
        const customerId =
          typeof full.customer === 'string' ? full.customer : full.customer?.id
        if (card && customerId) {
          const retried = await retryOpenSkipTraceInvoices(stripe, customerId)
          if (userId && retried.paid > 0 && retried.failed === 0) {
            await setTeamPastDue(supabase, userId, false)
          }
        }
      } catch (err) {
        console.error(
          'Skip-trace card webhook failed:',
          err instanceof Error ? err.message : err,
        )
      }
    }
    if (session.mode === 'subscription' && session.metadata?.user_id) {
      const userId = session.metadata.user_id
      const seats = Math.max(1, Number(session.metadata.seat_count) || 1)
      await supabase.from('subscriptions').upsert(
        {
          user_id: userId,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
          status: 'active',
          seat_count: seats,
          team_owner_id: null,
          stripe_seat_price_id: session.metadata.stripe_seat_price_id || seatPriceId(),
          stripe_skiptrace_price_id: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
    }
  }

  if (
    event.type === 'invoice.paid' ||
    event.type === 'invoice.payment_failed' ||
    event.type === 'invoice.marked_uncollectible'
  ) {
    const invoice = event.data.object as Stripe.Invoice
    await syncSkipTraceInvoiceEvent(supabase, invoice, event.type)
  }

  return NextResponse.json({ received: true })
}

async function syncSkipTraceInvoiceEvent(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice,
  eventType: string,
): Promise<void> {
  if (invoice.metadata?.kind !== 'skip_trace') return
  const teamOwnerId = String(invoice.metadata.team_owner_id ?? '').trim()
  const month = String(invoice.metadata.month ?? '').trim()
  const paid = eventType === 'invoice.paid'
  const status = paid
    ? 'paid'
    : eventType === 'invoice.marked_uncollectible'
      ? 'uncollectible'
      : invoice.status ?? 'open'

  if (teamOwnerId && month) {
    const billed = Number(invoice.metadata?.billable_count ?? 0)
    const row: Record<string, unknown> = {
      team_owner_id: teamOwnerId,
      month,
      stripe_customer_id:
        typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id ?? null,
      stripe_invoice_id: invoice.id,
      hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      status,
      amount_usd: Math.round((invoice.amount_paid || invoice.amount_due || 0) / 100),
      updated_at: new Date().toISOString(),
    }
    if (billed > 0) row.billable_count = billed
    await supabase.from('skip_trace_invoices').upsert(row, {
      onConflict: 'team_owner_id,month',
    })
  }

  if (teamOwnerId) {
    await setTeamPastDue(supabase, teamOwnerId, !paid)
  }
}
