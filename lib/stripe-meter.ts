import Stripe from 'stripe'
import { skipTraceMeterEventName } from '@/lib/billing'

/**
 * @deprecated Skip-trace is billed as a month-end Stripe Invoice per team
 * ($1 only when a phone number is returned). Do not report meter events —
 * that would auto-charge the card on the subscription cycle and double-bill
 * against the invoice ledger.
 *
 * Kept so existing Dashboard meters can be removed later without breaking
 * imports. See lib/stripe-invoices.ts.
 */
export async function reportSkipTraceMeterEvent(input: {
  stripeCustomerId: string
  idempotencyKey: string
}): Promise<{ ok: boolean; error?: string }> {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  const eventName = skipTraceMeterEventName()
  if (!stripeKey) {
    return { ok: false, error: 'Missing STRIPE_SECRET_KEY' }
  }
  if (!eventName) {
    return { ok: false, error: 'Missing STRIPE_SKIPTRACE_METER_EVENT_NAME' }
  }
  if (!input.stripeCustomerId) {
    return { ok: false, error: 'Missing stripe_customer_id' }
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' })

  try {
    await stripe.billing.meterEvents.create(
      {
        event_name: eventName,
        payload: {
          stripe_customer_id: input.stripeCustomerId,
          value: '1',
        },
        identifier: input.idempotencyKey.slice(0, 100),
      },
      { idempotencyKey: input.idempotencyKey.slice(0, 255) },
    )
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Stripe meter event failed:', message)
    return { ok: false, error: message }
  }
}
