/**
 * Commercial model:
 *   • Access is free (no seat subscription)
 *   • $1.00 / skip-trace when a phone number comes back
 *     (cache hits, misses, and email-only are free)
 *   • Waived for Mineral Map's team and Jordan's Great Plains team
 *
 * Skip-trace is billed **per customer team**. Hits accumulate as a
 * running total during the calendar month. At month end we charge the
 * card on file (`collection_method: charge_automatically`) for that
 * team's phone-hit total. Live skip-traces require a card unless the
 * workspace is Mineral Map / Great Plains.
 */

export const SEAT_PRICE_USD = 100
export const SKIP_TRACE_PRICE_USD = 1
/** @deprecated Month-end invoices charge the card on file; net-14 send_invoice is retired. */
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

/** Previous calendar month in UTC (`YYYY-MM`), used by the 1st-of-month charge cron. */
export function previousBillingMonthKey(d = new Date()): string {
  return billingMonthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)))
}
