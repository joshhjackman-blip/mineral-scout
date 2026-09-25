import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@supabase/ssr'
import { seatPriceId } from '@/lib/billing'

/**
 * Start Checkout for N × $100/mo seat price.
 * Skip-trace is NOT on this subscription — $1 phone hits accrue per team
 * and are invoiced through Stripe Invoicing at month end.
 *
 * Body: { seats?: number }  — defaults to 1, max 100.
 */
export async function POST(req: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY
    const seatPrice = seatPriceId()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL

    if (!stripeKey) {
      return NextResponse.json({ error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 })
    }
    if (!seatPrice) {
      return NextResponse.json(
        { error: 'Missing STRIPE_SEAT_PRICE_ID (create a $100/mo seat price in Stripe)' },
        { status: 500 },
      )
    }
    if (!appUrl) {
      return NextResponse.json({ error: 'Missing NEXT_PUBLIC_APP_URL' }, { status: 500 })
    }

    const body = (await req.json().catch(() => ({}))) as { seats?: number }
    const seats = Math.min(100, Math.max(1, Math.floor(Number(body.seats) || 1)))

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
      },
    )

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lineItems: Array<{ price: string; quantity?: number }> = [
      { price: seatPrice, quantity: seats },
    ]

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: lineItems,
      customer_email: user.email ?? undefined,
      allow_promotion_codes: true,
      metadata: {
        user_id: user.id,
        seat_count: String(seats),
        stripe_seat_price_id: seatPrice,
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          seat_count: String(seats),
          stripe_seat_price_id: seatPrice,
        },
      },
      success_url: `${appUrl}/api/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/account`,
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Checkout error:', message)
    return NextResponse.json({ error: message || 'Unknown error' }, { status: 500 })
  }
}
