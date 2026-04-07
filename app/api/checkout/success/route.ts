import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  console.log('Success route hit')
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('session_id')
  console.log('Session ID:', sessionId)

  if (!sessionId) {
    console.log('No session ID - redirecting to pricing')
    return NextResponse.redirect(new URL('/pricing', req.url))
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
  const stripeSession = await stripe.checkout.sessions.retrieve(sessionId)
  console.log('Stripe session status:', stripeSession.status)
  console.log('Stripe session metadata:', stripeSession.metadata)
  console.log('Stripe subscription:', stripeSession.subscription)
  const userId = stripeSession.metadata?.user_id
  console.log('User ID:', userId)

  if (!userId) {
    console.log('No user ID in metadata')
    return NextResponse.redirect(new URL('/pricing', req.url))
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error: subError } = await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: stripeSession.customer as string,
      stripe_subscription_id: stripeSession.subscription as string,
      status: 'active',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  console.log('Subscription upsert error:', subError)

  const { error: metaError } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { subscription_status: 'active' },
  })
  console.log('Metadata update error:', metaError)

  console.log('Redirecting to map')
  return NextResponse.redirect(new URL('/', req.url))
}
