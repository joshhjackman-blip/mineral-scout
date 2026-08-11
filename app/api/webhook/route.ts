import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { seatPriceId } from '@/lib/billing'

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
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' })

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
      await supabase.auth.admin.updateUserById(sub.user_id, {
        user_metadata: { subscription_status: 'canceled' },
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
    const skipItem = sub.items.data.find(
      (item) => item.price?.recurring?.usage_type === 'metered',
    )

    await supabase
      .from('subscriptions')
      .update({
        status: sub.status,
        seat_count: seatCount,
        stripe_seat_price_id: seatPrice,
        stripe_skiptrace_price_id: skipItem?.price?.id ?? null,
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
      await supabase.auth.admin.updateUserById(subRow.user_id, {
        user_metadata: {
          subscription_status: active ? 'active' : sub.status,
          seat_count: seatCount,
          stripe_seat_price_id: seatPrice,
        },
      })
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
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
          stripe_skiptrace_price_id: session.metadata.stripe_skiptrace_price_id || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
    }
  }

  return NextResponse.json({ received: true })
}
