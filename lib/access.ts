import { isPlatformAdmin } from '@/lib/team'
import { isBillableSubscriptionStatus } from '@/lib/billing'

/**
 * Whether a logged-in user may use the product (map / CRM / etc.).
 *
 * Allowed when:
 *   • platform owner/admin, or
 *   • billing_exempt (grandfathered pre-billing accounts — no seat fee), or
 *   • subscription_status is active/trialing (Stripe checkout OR
 *     admin-provisioned seats — both set this in user_metadata)
 */
export function isBillingExempt(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return metadata?.billing_exempt === true
}

export function hasPaidAccess(
  metadata: Record<string, unknown> | null | undefined,
  email?: string | null,
): boolean {
  if (isPlatformAdmin(metadata, email)) return true
  if (isBillingExempt(metadata)) return true
  return isBillableSubscriptionStatus(
    typeof metadata?.subscription_status === 'string'
      ? metadata.subscription_status
      : null,
  )
}
