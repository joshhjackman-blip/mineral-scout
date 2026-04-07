import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

export async function POST(req: NextRequest) {
  try {
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

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: sub, error: subError } = await adminClient
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', session.user.id)
      .maybeSingle()

    if (subError) {
      console.error('Subscription lookup error:', subError)
      return NextResponse.json({ error: subError.message }, { status: 500 })
    }

    if (!sub?.stripe_subscription_id) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
    }

    // Cancel at period end so users keep access until their cycle ends.
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    })

    await adminClient
      .from('subscriptions')
      .update({ status: 'canceling', updated_at: new Date().toISOString() })
      .eq('user_id', session.user.id)

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Cancel error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
