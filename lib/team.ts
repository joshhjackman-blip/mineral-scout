/**
 * Team seat helpers.
 *
 * Roles:
 * - platform admin  → user_metadata.is_admin (Mineral Map staff only)
 * - team admin      → owns the workspace (subscriptions.team_owner_id IS NULL,
 *                     provisioned with seat_count); can invite members
 * - team member     → subscriptions.team_owner_id / user_metadata.team_owner_id set
 *
 * Platform /admin stays locked to is_admin. Team admins manage seats on /account.
 */

export type TeamRole = 'platform_admin' | 'team_admin' | 'team_member' | 'unprovisioned'

export function isPlatformAdmin(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return Boolean(metadata?.is_admin)
}

export function getTeamOwnerId(
  metadata: Record<string, unknown> | null | undefined,
  subscriptionTeamOwnerId?: string | null,
): string | null {
  const fromMeta = String(metadata?.team_owner_id ?? '').trim()
  if (fromMeta) return fromMeta
  const fromSub = String(subscriptionTeamOwnerId ?? '').trim()
  return fromSub || null
}

export function resolveTeamRole(input: {
  metadata?: Record<string, unknown> | null
  subscription?: {
    status?: string | null
    seat_count?: number | null
    team_owner_id?: string | null
  } | null
}): TeamRole {
  if (isPlatformAdmin(input.metadata)) return 'platform_admin'

  const ownerId = getTeamOwnerId(input.metadata, input.subscription?.team_owner_id)
  if (ownerId) return 'team_member'

  const seats = Number(input.subscription?.seat_count ?? 0)
  const status = String(input.subscription?.status ?? '').toLowerCase()
  // Provisioned team admin: active (or free) sub with at least 2 seats
  // (admin + 1 member) OR explicit seat_count >= 1 with status active.
  if (status === 'active' && seats >= 1) return 'team_admin'

  return 'unprovisioned'
}

/** Seats available for invites (total seats minus the admin's own seat). */
export function inviteSeatCapacity(seatCount: number | null | undefined): number {
  const seats = Math.max(0, Number(seatCount ?? 0))
  return Math.max(0, seats - 1)
}
