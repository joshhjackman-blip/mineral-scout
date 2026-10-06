import { supabase } from '@/lib/supabase'
import { getTeamOwnerId, isGreatPlainsMember } from '@/lib/team'

export type WorkspaceContext = {
  userId: string
  /** Team admin / solo user id, or the inviting team owner's id for members. */
  workspaceId: string
}

let cached: WorkspaceContext | null = null
let inflight: Promise<WorkspaceContext | null> | null = null

/**
 * Resolve the current user's CRM workspace.
 *
 * Solo / team-admin → their own user id.
 * Invited team member → their team_owner_id (from JWT metadata or subscriptions).
 *
 * Used to stamp deals / notes / overrides. Skip-trace *cache* is intentionally
 * NOT scoped by workspace — it's shared so we only pay the provider once.
 */
export async function getWorkspaceContext(
  force = false,
): Promise<WorkspaceContext | null> {
  if (!force && cached) return cached
  if (!inflight) {
    inflight = (async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()
      if (error || !user) {
        cached = null
        return null
      }

      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
      let fromTeam = getTeamOwnerId(metadata, null)

      if (!fromTeam) {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('team_owner_id')
          .eq('user_id', user.id)
          .maybeSingle()
        fromTeam = getTeamOwnerId(
          metadata,
          (sub as { team_owner_id?: string | null } | null)?.team_owner_id,
        )
      }

      if (!fromTeam && isGreatPlainsMember(user.email)) {
        try {
          const res = await fetch('/api/workspace', { cache: 'no-store' })
          const payload = (await res.json()) as {
            data?: { workspaceId?: string }
          }
          const seeded = String(payload.data?.workspaceId ?? '').trim()
          if (seeded && seeded !== user.id) fromTeam = seeded
        } catch {
          // Fall through to solo workspace; skip-trace waiver still applies.
        }
      }

      const ctx: WorkspaceContext = {
        userId: user.id,
        workspaceId: fromTeam || user.id,
      }
      cached = ctx
      return ctx
    })().finally(() => {
      inflight = null
    })
  }
  return inflight
}

export function clearWorkspaceCache(): void {
  cached = null
}

/** Normalize owner names for the shared skip_trace_cache primary key. */
export { skipTraceOwnerKey } from '@/lib/skip-trace-cache'
