import { isPlatformAdmin } from '@/lib/team'
import { isBillableSubscriptionStatus } from '@/lib/billing'

/**
 * Whether a logged-in user may use the product (map / CRM / etc.).
 *
 * Allowed when:
 *   • platform owner/admin, or
 *   • subscription_status is active/trialing (Stripe checkout OR
 *     admin-provisioned seats — both set this in user_metadata)
 */
export function hasPaidAccess(
  metadata: Record<string, unknown> | null | undefined,
  email?: string | null,
): boolean {
  if (isPlatformAdmin(metadata, email)) return true
  return isBillableSubscriptionStatus(
    typeof metadata?.subscription_status === 'string'
      ? metadata.subscription_status
      : null,
  )
}
