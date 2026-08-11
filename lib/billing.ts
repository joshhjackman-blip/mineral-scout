/**
 * Commercial model (2026-08-11):
 *   • $100 / seat / month  — platform access
 *   • $0.50 / skip-trace   — only when we actually call the provider
 *                            (shared cache hits are free)
 *
 * Stripe catalog (create once in Dashboard, then set env):
 *   1. Product "Mineral Map Seat" → recurring Price $100/mo (licensed)
 *      → STRIPE_SEAT_PRICE_ID / NEXT_PUBLIC_STRIPE_SEAT_PRICE_ID
 *   2. Billing Meter event_name e.g. "skip_trace"
 *      → metered Price $0.50/unit linked to that meter
 *      → STRIPE_SKIPTRACE_PRICE_ID
 *      → STRIPE_SKIPTRACE_METER_EVENT_NAME
 */

export const SEAT_PRICE_USD = 100
export const SKIP_TRACE_PRICE_USD = 0.5

export function seatPriceId(): string | null {
  return (
    process.env.STRIPE_SEAT_PRICE_ID?.trim() ||
    process.env.NEXT_PUBLIC_STRIPE_SEAT_PRICE_ID?.trim() ||
    null
  )
}

export function skipTracePriceId(): string | null {
  return process.env.STRIPE_SKIPTRACE_PRICE_ID?.trim() || null
}

export function skipTraceMeterEventName(): string | null {
  return process.env.STRIPE_SKIPTRACE_METER_EVENT_NAME?.trim() || null
}

/** Public display helpers for UI copy. */
export function formatSeatPrice(): string {
  return `$${SEAT_PRICE_USD}/mo per seat`
}

export function formatSkipTracePrice(): string {
  return `$${SKIP_TRACE_PRICE_USD.toFixed(2)} per skip-trace`
}

export function estimateMonthlySkipTraceCost(billableCalls: number): number {
  return Math.max(0, Number(billableCalls) || 0) * SKIP_TRACE_PRICE_USD
}

export function isBillableSubscriptionStatus(
  status: string | null | undefined,
): boolean {
  const s = String(status ?? '').toLowerCase()
  return s === 'active' || s === 'trialing'
}
