import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@supabase/ssr'

export async function POST(req: NextRequest) {
  console.log('Checkout route hit')

  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY
    const body = (await req.json().catch(() => ({}))) as { priceId?: string }
    const requestedPriceId = body.priceId?.trim()
    const soloPriceId = process.env.STRIPE_PRICE_ID
    const teamPriceId = process.env.NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID
    const allowedPriceIds = [soloPriceId, teamPriceId].filter(
      (value): value is string => Boolean(value)
    )
    const priceId = requestedPriceId || soloPriceId
    const appUrl = process.env.NEXT_PUBLIC_APP_URL

    console.log('Env check:', {
      hasStripeKey: !!stripeKey,
      hasPriceId: !!priceId,
      hasRequestedPriceId: !!requestedPriceId,
      appUrl,
    })

    if (!stripeKey) {
      return NextResponse.json({ error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 })
    }
    if (!priceId) {
      return NextResponse.json({ error: 'Missing STRIPE_PRICE_ID' }, { status: 500 })
    }
    if (!allowedPriceIds.includes(priceId)) {
      return NextResponse.json({ error: 'Invalid price ID' }, { status: 400 })
    }
    if (!appUrl) {
      return NextResponse.json({ error: 'Missing NEXT_PUBLIC_APP_URL' }, { status: 500 })
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' })

    const res = NextResponse.next()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll().map((cookie) => ({
              name: cookie.name,
              value: cookie.value,
            }))
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              req.cookies.set(name, value)
              res.cookies.set(name, value, options)
            })
          },
        },
      }
    )

    const {
      data: { session },
    } = await supabase.auth.getSession()

    console.log('Session:', session?.user?.email ?? 'no session')
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: session.user.email ?? undefined,
      metadata: {
        user_id: session.user.id ?? '',
        stripe_price_id: priceId,
      },
      subscription_data: {
        trial_period_days: 7,
        metadata: {
          user_id: session.user.id ?? '',
          stripe_price_id: priceId,
        },
      },
      success_url: `${appUrl}/api/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing`,
    })

    console.log('Checkout session created:', checkoutSession.id)
    return NextResponse.json({ url: checkoutSession.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Checkout error:', message)
    return NextResponse.json({ error: message || 'Unknown error' }, { status: 500 })
  }
}
