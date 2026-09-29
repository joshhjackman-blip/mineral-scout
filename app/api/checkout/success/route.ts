import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { seatPriceId } from '@/lib/billing'
import { requireApiUser } from '@/lib/api-auth'
import { STRIPE_API_VERSION, persistCardFromCheckoutSession, setTeamPastDue } from '@/lib/stripe-card'
import { retryOpenSkipTraceInvoices } from '@/lib/stripe-invoices'

function seatQuantityFromSubscription(sub: Stripe.Subscription, fallback: number): number {
  const seatPrice = seatPriceId()
  if (!seatPrice) return fallback
  const seatItem = sub.items.data.find((item) => item.price?.id === seatPrice)
  if (seatItem?.quantity && seatItem.quantity > 0) return seatItem.quantity
  return fallback
}

export async function GET(req: NextRequest) {
  // Allow completing checkout before agreement signing.
  const gate = await requireApiUser(req, { requireAgreement: false })
  if (gate.error) {
    return NextResponse.redirect(new URL('/auth', req.url))
  }

  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('session_id')

  if (!sessionId) {
    return NextResponse.redirect(new URL('/account', req.url))
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION })
  const stripeSession = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription', 'setup_intent.payment_method'],
  })

  const userId = stripeSession.metadata?.user_id
  if (!userId || userId !== gate.user.id) {
    return NextResponse.redirect(new URL('/account', req.url))
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  if (stripeSession.mode === 'setup') {
    try {
      const card = await persistCardFromCheckoutSession(stripe, supabase, stripeSession)
      const customerId =
        typeof stripeSession.customer === 'string'
          ? stripeSession.customer
          : stripeSession.customer?.id
      if (card && customerId) {
        const retried = await retryOpenSkipTraceInvoices(stripe, customerId)
        if (retried.paid > 0 && retried.failed === 0) {
          await setTeamPastDue(supabase, userId, false)
        }
      }
    } catch (err) {
      console.error(
        'Skip-trace card setup success failed:',
        err instanceof Error ? err.message : err,
      )
    }
    return NextResponse.redirect(new URL('/account?card=saved', req.url))
  }

  const metaSeats = Math.max(1, Number(stripeSession.metadata?.seat_count) || 1)
  let seatCount = metaSeats
  let subscriptionId =
    typeof stripeSession.subscription === 'string'
      ? stripeSession.subscription
      : stripeSession.subscription?.id ?? null

  if (subscriptionId) {
    const sub =
      typeof stripeSession.subscription === 'object' && stripeSession.subscription
        ? stripeSession.subscription
        : await stripe.subscriptions.retrieve(subscriptionId)
    seatCount = seatQuantityFromSubscription(sub, metaSeats)
    subscriptionId = sub.id
  }

  const seatPrice = seatPriceId()

  await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: stripeSession.customer as string,
      stripe_subscription_id: subscriptionId,
      status: 'active',
      seat_count: seatCount,
      team_owner_id: null,
      stripe_seat_price_id: seatPrice,
      stripe_skiptrace_price_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  const { data: authUser } = await supabase.auth.admin.getUserById(userId)
  const existingMeta = (authUser?.user?.user_metadata ?? {}) as Record<string, unknown>
  await supabase.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...existingMeta,
      subscription_status: 'active',
      seat_count: seatCount,
      stripe_seat_price_id: seatPrice,
    },
  })

  // Pay → sign agreement → map. Account remains available from the app.
  return NextResponse.redirect(
    new URL('/legal/agreement/sign?from=checkout', req.url),
  )
}
