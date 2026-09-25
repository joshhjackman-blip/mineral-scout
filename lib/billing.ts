/**
 * Commercial model:
 *   • $100 / seat / month  — platform access (Stripe Checkout subscription)
 *   • $1.00 / skip-trace   — only when a phone number comes back
 *                            (cache hits, misses, and email-only are free)
 *
 * Skip-trace is billed **per team**, not per user. Hits accumulate as a
 * running total during the calendar month. At month end we create a Stripe
 * Invoice (`collection_method: send_invoice`) for that team's Stripe
 * Customer — not a Billing Meter event on every lookup.
 *
 * Do not use the old $0.50 metered price / STRIPE_SKIPTRACE_METER_EVENT_NAME
 * for this. Meters auto-charge the card on the subscription cycle; the
 * product requirement is a running total + month-end invoice.
 *
 * Stripe catalog (create once in Dashboard, then set env):
 *   1. Product "Mineral Map Seat" → recurring Price $100/mo (licensed)
 *      → STRIPE_SEAT_PRICE_ID / NEXT_PUBLIC_STRIPE_SEAT_PRICE_ID
 *   2. Each team needs a Stripe Customer (created at seat checkout, or
 *      attached later). Month-end skip-trace invoices are Invoice Items
 *      at $1.00 × billable phone hits — no metered Price required.
 */

export const SEAT_PRICE_USD = 100
export const SKIP_TRACE_PRICE_USD = 1
export const SKIP_TRACE_INVOICE_DAYS_UNTIL_DUE = 14

export function seatPriceId(): string | null {
  return (
    process.env.STRIPE_SEAT_PRICE_ID?.trim() ||
    process.env.NEXT_PUBLIC_STRIPE_SEAT_PRICE_ID?.trim() ||
    null
  )
}

/** @deprecated Skip-trace is invoiced monthly, not metered per event. */
export function skipTracePriceId(): string | null {
  return process.env.STRIPE_SKIPTRACE_PRICE_ID?.trim() || null
}

/** @deprecated Skip-trace is invoiced monthly, not metered per event. */
export function skipTraceMeterEventName(): string | null {
  return process.env.STRIPE_SKIPTRACE_METER_EVENT_NAME?.trim() || null
}

/** Public display helpers for UI copy. */
export function formatSeatPrice(): string {
  return `$${SEAT_PRICE_USD}/mo per seat`
}

export function formatSkipTracePrice(): string {
  return `$${SKIP_TRACE_PRICE_USD.toFixed(2)} per skip-trace when a phone number is returned`
}

export function estimateMonthlySkipTraceCost(billableCalls: number): number {
  return Math.max(0, Number(billableCalls) || 0) * SKIP_TRACE_PRICE_USD
}

export function isSkipTraceBillable(input: {
  cached?: boolean
  waived?: boolean
  phoneCount?: number
}): boolean {
  if (input.cached) return false
  if (input.waived) return false
  return (Number(input.phoneCount) || 0) > 0
}

export function isBillableSubscriptionStatus(
  status: string | null | undefined,
): boolean {
  const s = String(status ?? '').toLowerCase()
  return s === 'active' || s === 'trialing'
}

export function billingMonthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7)
}
