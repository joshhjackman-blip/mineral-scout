import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch {
    return NextResponse.json({ error: 'Webhook signature failed' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
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
      .single()

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
    await supabase
      .from('subscriptions')
      .update({ status: sub.status, updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.id)

    const { data: subRow } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_subscription_id', sub.id)
      .single()

    if (subRow?.user_id) {
      await supabase.auth.admin.updateUserById(subRow.user_id, {
        user_metadata: {
          subscription_status: sub.status === 'active' || sub.status === 'trialing'
            ? 'active'
            : sub.status,
        },
      })
    }
  }

  return NextResponse.json({ received: true })
}
