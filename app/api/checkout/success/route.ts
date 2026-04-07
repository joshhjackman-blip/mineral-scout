import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('session_id')

  if (!sessionId) {
    return NextResponse.redirect(new URL('/pricing', req.url))
  }

  const stripeSession = await stripe.checkout.sessions.retrieve(sessionId)
  const userId = stripeSession.metadata?.user_id

  if (userId && stripeSession.status === 'complete') {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const stripeCustomerId =
      typeof stripeSession.customer === 'string'
        ? stripeSession.customer
        : stripeSession.customer?.id ?? null
    const stripeSubscriptionId =
      typeof stripeSession.subscription === 'string'
        ? stripeSession.subscription
        : stripeSession.subscription?.id ?? null

    await supabase.from('subscriptions').upsert(
      {
        user_id: userId,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { subscription_status: 'active' },
    })

    console.log('Subscription activated for user:', userId)
  }

  return NextResponse.redirect(new URL('/', req.url))
}
