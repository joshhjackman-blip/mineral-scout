import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

export const STRIPE_API_VERSION = '2024-06-20' as const

export type TeamCardStatus = {
  gateReady: boolean
  has_card: boolean
  skip_trace_past_due: boolean
  stripe_customer_id: string | null
  payment_method_brand: string | null
  payment_method_last4: string | null
}

export type SavedCard = {
  brand: string | null
  last4: string | null
}

export function stripeClient(): Stripe {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeKey) {
    throw new Error('Missing STRIPE_SECRET_KEY')
  }
  return new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION })
}

export function emptyTeamCardStatus(): TeamCardStatus {
  return {
    gateReady: false,
    has_card: false,
    skip_trace_past_due: false,
    stripe_customer_id: null,
    payment_method_brand: null,
    payment_method_last4: null,
  }
}

export async function readTeamCardStatus(
  admin: SupabaseClient,
  teamOwnerId: string,
): Promise<TeamCardStatus> {
  const withCard = await admin
    .from('subscriptions')
    .select(
      'has_card, skip_trace_past_due, stripe_customer_id, payment_method_brand, payment_method_last4, stripe_subscription_id',
    )
    .eq('user_id', teamOwnerId)
    .maybeSingle()

  if (!withCard.error) {
    const row = withCard.data as {
      has_card?: boolean | null
      skip_trace_past_due?: boolean | null
      stripe_customer_id?: string | null
      payment_method_brand?: string | null
      payment_method_last4?: string | null
      stripe_subscription_id?: string | null
    } | null
    return {
      gateReady: true,
      has_card:
        Boolean(row?.has_card) || Boolean(String(row?.stripe_subscription_id ?? '').trim()),
      skip_trace_past_due: Boolean(row?.skip_trace_past_due),
      stripe_customer_id: row?.stripe_customer_id ?? null,
      payment_method_brand: row?.payment_method_brand ?? null,
      payment_method_last4: row?.payment_method_last4 ?? null,
    }
  }

  const fallback = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', teamOwnerId)
    .maybeSingle()

  return {
    ...emptyTeamCardStatus(),
    stripe_customer_id:
      (fallback.data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ??
      null,
  }
}

export async function setTeamPastDue(
  admin: SupabaseClient,
  teamOwnerId: string,
  pastDue: boolean,
): Promise<void> {
  const { error } = await admin
    .from('subscriptions')
    .update({
      skip_trace_past_due: pastDue,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', teamOwnerId)
  if (error) {
    console.error('setTeamPastDue:', error.message)
  }
}

export async function ensureStripeCustomer(
  stripe: Stripe,
  admin: SupabaseClient,
  input: { userId: string; email?: string | null },
): Promise<string> {
  const { data } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', input.userId)
    .maybeSingle()
  const existing = String(
    (data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? '',
  ).trim()
  if (existing) return existing

  const customer = await stripe.customers.create({
    email: input.email?.trim() || undefined,
    metadata: { user_id: input.userId, kind: 'skip_trace' },
  })

  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: input.userId,
      stripe_customer_id: customer.id,
      status: 'active',
      team_owner_id: null,
      has_card: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) {
    console.error('ensureStripeCustomer upsert:', error.message)
  }
  return customer.id
}

export async function applyPaymentMethodToCustomer(
  stripe: Stripe,
  customerId: string,
  paymentMethodId: string,
): Promise<SavedCard> {
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId)
  const attachedTo =
    typeof pm.customer === 'string' ? pm.customer : pm.customer?.id ?? null
  if (!attachedTo) {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
  } else if (attachedTo !== customerId) {
    throw new Error('Payment method belongs to a different Stripe customer')
  }
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  })
  return {
    brand: pm.card?.brand ?? pm.type ?? null,
    last4: pm.card?.last4 ?? null,
  }
}

export async function persistTeamCard(
  admin: SupabaseClient,
  input: {
    userId: string
    customerId: string
    card: SavedCard
    clearPastDue?: boolean
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    user_id: input.userId,
    stripe_customer_id: input.customerId,
    has_card: true,
    payment_method_brand: input.card.brand,
    payment_method_last4: input.card.last4,
    updated_at: new Date().toISOString(),
  }
  if (input.clearPastDue) patch.skip_trace_past_due = false
  const { error } = await admin.from('subscriptions').upsert(patch, {
    onConflict: 'user_id',
  })
  if (error) {
    throw new Error(error.message || 'Failed to save card on file')
  }
}

function paymentMethodIdFromSetupIntent(
  setupIntent: Stripe.SetupIntent | string | null | undefined,
): string | null {
  if (!setupIntent || typeof setupIntent === 'string') return null
  const pm = setupIntent.payment_method
  if (typeof pm === 'string') return pm
  return pm?.id ?? null
}

export async function persistCardFromCheckoutSession(
  stripe: Stripe,
  admin: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<SavedCard | null> {
  if (session.mode !== 'setup') return null
  const userId = String(session.metadata?.user_id ?? '').trim()
  if (!userId) return null
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id ?? null
  if (!customerId) return null

  let setupIntent = session.setup_intent
  if (typeof setupIntent === 'string') {
    setupIntent = await stripe.setupIntents.retrieve(setupIntent, {
      expand: ['payment_method'],
    })
  }
  const pmId = paymentMethodIdFromSetupIntent(
    typeof setupIntent === 'string' ? null : setupIntent,
  )
  if (!pmId) return null

  const card = await applyPaymentMethodToCustomer(stripe, customerId, pmId)
  await persistTeamCard(admin, { userId, customerId, card })
  return card
}
