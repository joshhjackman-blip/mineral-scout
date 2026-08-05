/**
 * Access roles (highest → lowest):
 *
 * - platform_owner  → Mineral Map software owner (management@…).
 *                     /owner = portfolio of EVERY team’s activity/$.
 *                     /admin = ops (provision, admins, flagged deeds).
 * - platform_admin  → Staff with /admin access (granted by owner via is_admin).
 * - team_admin      → Customer workspace manager.
 *                     /team = that team’s activity/$ only; invites on /account.
 * - team_member     → Invited seat; map/CRM only — never /admin, /owner, or /team.
 */

export type TeamRole =
  | 'platform_owner'
  | 'platform_admin'
  | 'team_admin'
  | 'team_member'
  | 'unprovisioned'

/**
 * Owner account(s) — admin of admins.
 * Always treated as platform owner + platform admin.
 */
export const PLATFORM_OWNER_EMAILS = [
  'management@mineralmapllc.com',
] as const

/** Extra staff emails that are always platform admin (optional hardcodes). */
export const PLATFORM_ADMIN_EMAILS = [
  ...PLATFORM_OWNER_EMAILS,
] as const

export function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? '').toLowerCase().trim()
}

export function isPlatformOwner(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email)
  return (PLATFORM_OWNER_EMAILS as readonly string[]).includes(normalized)
}

export function isAllowlistedPlatformAdmin(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email)
  return (PLATFORM_ADMIN_EMAILS as readonly string[]).includes(normalized)
}

/** True for owner OR staff admin (metadata.is_admin OR allowlist). */
export function isPlatformAdmin(
  metadata: Record<string, unknown> | null | undefined,
  email?: string | null,
): boolean {
  if (isPlatformOwner(email)) return true
  if (Boolean(metadata?.is_admin)) return true
  return isAllowlistedPlatformAdmin(email)
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
  email?: string | null
  subscription?: {
    status?: string | null
    seat_count?: number | null
    team_owner_id?: string | null
  } | null
}): TeamRole {
  if (isPlatformOwner(input.email)) return 'platform_owner'
  if (isPlatformAdmin(input.metadata, input.email)) return 'platform_admin'

  const ownerId = getTeamOwnerId(input.metadata, input.subscription?.team_owner_id)
  if (ownerId) return 'team_member'

  const seats = Number(input.subscription?.seat_count ?? 0)
  const status = String(input.subscription?.status ?? '').toLowerCase()
  if (status === 'active' && seats >= 1) return 'team_admin'

  return 'unprovisioned'
}

export function roleLabel(role: TeamRole): string {
  switch (role) {
    case 'platform_owner':
      return 'Owner'
    case 'platform_admin':
      return 'Admin'
    case 'team_admin':
      return 'Team admin'
    case 'team_member':
      return 'Team member'
    default:
      return 'User'
  }
}

/** Seats available for invites (total seats minus the admin's own seat). */
export function inviteSeatCapacity(seatCount: number | null | undefined): number {
  const seats = Math.max(0, Number(seatCount ?? 0))
  return Math.max(0, seats - 1)
}
