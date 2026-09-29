/**
 * Skip-trace payment gate. Access stays free; live lookups need a card
 * on the team admin so month-end $1 phone-hit charges can collect.
 *
 * Fail-open when Stripe is not configured (local / preview) or when the
 * has_card columns are not migrated yet — skip-trace must not 500.
 */

export const SKIP_TRACE_CARD_ACCOUNT_PATH = '/account'

export type SkipTraceGateError = 'card_required' | 'payment_failed'

export type SkipTraceGate =
  | { ok: true }
  | {
      ok: false
      error: SkipTraceGateError
      status: 402
      message: string
      redirect: typeof SKIP_TRACE_CARD_ACCOUNT_PATH
    }

export const SKIP_TRACE_CARD_REQUIRED_MESSAGE =
  'Add a card on Account to run skip-traces. We charge $1 per phone hit at month end — cache hits, misses, and email-only stay free.'

export const SKIP_TRACE_PAYMENT_FAILED_MESSAGE =
  "Last month's skip-trace charge did not go through. Update the card on Account, then try again."

export function skipTracePaymentGate(input: {
  waived?: boolean
  stripeConfigured?: boolean
  gateReady?: boolean
  hasCard?: boolean
  pastDue?: boolean
  /** false for shared-cache hits (free). Live provider calls need a card. */
  liveLookup?: boolean
}): SkipTraceGate {
  if (input.waived) return { ok: true }
  if (!input.stripeConfigured) return { ok: true }
  if (!input.gateReady) return { ok: true }
  if (input.pastDue) {
    return {
      ok: false,
      error: 'payment_failed',
      status: 402,
      message: SKIP_TRACE_PAYMENT_FAILED_MESSAGE,
      redirect: SKIP_TRACE_CARD_ACCOUNT_PATH,
    }
  }
  if (input.liveLookup === false) return { ok: true }
  if (!input.hasCard) {
    return {
      ok: false,
      error: 'card_required',
      status: 402,
      message: SKIP_TRACE_CARD_REQUIRED_MESSAGE,
      redirect: SKIP_TRACE_CARD_ACCOUNT_PATH,
    }
  }
  return { ok: true }
}

export function stripeBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}
