import { isSkipTraceCompedTeam } from '@/lib/team'

/**
 * Platform access is free. Skip-trace is $1 per phone hit except for
 * Mineral Map's team and Jordan's Great Plains team.
 */

/** @deprecated Seat grandfather flag — does not waive skip-trace. */
export function isBillingExempt(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return metadata?.billing_exempt === true
}

/** Logged-in users may use the map/CRM — no seat paywall. */
export function hasPaidAccess(
  _metadata?: Record<string, unknown> | null,
  _email?: string | null,
): boolean {
  return true
}

export function isSkipTraceWaivedFor(input: {
  userEmail?: string | null
  workspaceOwnerEmail?: string | null
}): boolean {
  return (
    isSkipTraceCompedTeam(input.userEmail) ||
    isSkipTraceCompedTeam(input.workspaceOwnerEmail)
  )
}
