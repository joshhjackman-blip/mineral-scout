import Stripe from 'stripe'
import { seatPriceId } from '@/lib/billing'

/**
 * Keep the Stripe subscription's licensed seat quantity in sync with
 * our `subscriptions.seat_count` (admin provision / seat changes).
 * No-op when there is no Stripe subscription or seat price configured.
 */
export async function syncStripeSeatQuantity(input: {
  stripeSubscriptionId: string | null | undefined
  seatCount: number
}): Promise<{ ok: boolean; error?: string }> {
  const subId = String(input.stripeSubscriptionId ?? '').trim()
  const seats = Math.max(1, Math.min(100, Math.floor(input.seatCount) || 1))
  if (!subId) return { ok: true }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  const seatPrice = seatPriceId()
  if (!stripeKey || !seatPrice) {
    return { ok: true } // local/manual provision without Stripe catalog
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' })
  try {
    const sub = await stripe.subscriptions.retrieve(subId)
    const seatItem = sub.items.data.find((item) => item.price?.id === seatPrice)
    if (!seatItem) {
      return { ok: false, error: 'Seat price item not found on subscription' }
    }
    if (seatItem.quantity === seats) return { ok: true }

    await stripe.subscriptionItems.update(seatItem.id, {
      quantity: seats,
      proration_behavior: 'create_prorations',
    })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('syncStripeSeatQuantity failed:', message)
    return { ok: false, error: message }
  }
}
