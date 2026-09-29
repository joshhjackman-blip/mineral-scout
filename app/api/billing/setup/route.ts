import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiUser } from '@/lib/api-auth'
import { getTeamOwnerId } from '@/lib/team'
import {
  ensureStripeCustomer,
  stripeClient,
} from '@/lib/stripe-card'
import { stripeBillingConfigured } from '@/lib/skip-trace-gate'

export const dynamic = 'force-dynamic'

/**
 * Stripe Checkout in setup mode — save a card for month-end skip-trace
 * charges. Team members inherit the team admin's card; only the workspace
 * owner (or an unprovisioned individual) can add one.
 */
export async function POST(req: NextRequest) {
  const gate = await requireApiUser(req, { requireAgreement: false })
  if (gate.error) return gate.error

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!stripeBillingConfigured() || !appUrl) {
    return NextResponse.json(
      { success: false, data: null, error: 'Stripe billing is not configured' },
      { status: 500 },
    )
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: sub } = await admin
    .from('subscriptions')
    .select('team_owner_id')
    .eq('user_id', gate.user.id)
    .maybeSingle()

  const workspaceId =
    getTeamOwnerId(
      gate.user.user_metadata as Record<string, unknown>,
      (sub as { team_owner_id?: string | null } | null)?.team_owner_id,
    ) || gate.user.id

  if (workspaceId !== gate.user.id) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error:
          'Your team admin manages the card on file. Ask them to add one on Account.',
      },
      { status: 403 },
    )
  }

  try {
    const stripe = stripeClient()
    const customerId = await ensureStripeCustomer(stripe, admin, {
      userId: gate.user.id,
      email: gate.user.email,
    })

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      payment_method_types: ['card'],
      currency: 'usd',
      metadata: {
        user_id: gate.user.id,
        kind: 'skip_trace_card',
      },
      setup_intent_data: {
        metadata: {
          user_id: gate.user.id,
          kind: 'skip_trace_card',
        },
      },
      success_url: `${appUrl}/api/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/account`,
    })

    return NextResponse.json({
      success: true,
      data: { url: checkoutSession.url },
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Skip-trace card setup failed:', message)
    return NextResponse.json(
      { success: false, data: null, error: message || 'Could not start card setup' },
      { status: 500 },
    )
  }
}
