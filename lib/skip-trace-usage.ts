import type { SupabaseClient } from '@supabase/supabase-js'

export type SkipTraceUsageRow = {
  count: number
  billableCount: number
  hitCount: number
}

/**
 * Monthly per-user skip-trace counters.
 *   count          — every provider call (cache miss)
 *   hit_count      — phone came back (successful), including waived teams
 *   billable_count — phone hits that will appear on the team invoice
 *
 * billable_count / hit_count were added after the original table; if a
 * column is missing we still increment `count` so skip-trace itself never fails.
 */
export async function readSkipTraceUsage(
  adminClient: SupabaseClient,
  userId: string,
  month: string,
): Promise<SkipTraceUsageRow> {
  const withHits = await adminClient
    .from('skip_trace_usage')
    .select('count, billable_count, hit_count')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle()

  if (!withHits.error) {
    const row = withHits.data as {
      count?: number
      billable_count?: number
      hit_count?: number
    } | null
    return {
      count: Number(row?.count ?? 0),
      billableCount: Number(row?.billable_count ?? 0),
      hitCount: Number(row?.hit_count ?? 0),
    }
  }

  const withBillable = await adminClient
    .from('skip_trace_usage')
    .select('count, billable_count')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle()

  if (!withBillable.error) {
    return {
      count: Number((withBillable.data as { count?: number } | null)?.count ?? 0),
      billableCount: Number(
        (withBillable.data as { billable_count?: number } | null)?.billable_count ?? 0,
      ),
      hitCount: 0,
    }
  }

  const fallback = await adminClient
    .from('skip_trace_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle()

  if (fallback.error) {
    throw new Error(fallback.error.message || 'Failed to read skip trace usage')
  }

  return {
    count: Number((fallback.data as { count?: number } | null)?.count ?? 0),
    billableCount: 0,
    hitCount: 0,
  }
}

/**
 * Waived teams never increment billable_count, so owner dashboards cannot
 * use that column as "successful." Prefer stored hit_count when it is
 * consistent with this month's lookups; otherwise derive hits as
 * lookups minus original no-phone reviews (before researcher recoveries).
 */
export function deriveSkipTraceHits(
  count: number,
  storedHits: number,
  reviewMisses: number,
): { hits: number; misses: number } {
  const lookups = Math.max(0, Number(count) || 0)
  const misses = Math.max(0, Number(reviewMisses) || 0)
  const hitsStored = Math.max(0, Number(storedHits) || 0)
  const derived = Math.max(0, lookups - misses)
  // Trust the stored counter when it already reconciles with this month's
  // lookups. Otherwise prefer the larger of stored vs derived so a mid-month
  // hit_count rollout (waived teams start at 0) does not hide earlier hits.
  if (hitsStored + misses === lookups) {
    return { hits: hitsStored, misses }
  }
  return { hits: Math.max(hitsStored, derived), misses }
}

export async function incrementSkipTraceUsage(
  adminClient: SupabaseClient,
  input: {
    userId: string
    workspaceId: string
    month: string
    currentCount: number
    currentBillable: number
    currentHit?: number
    billable: boolean
    hit?: boolean
  },
): Promise<{ nextCount: number; nextBillable: number; nextHit: number }> {
  const nextCount = input.currentCount + 1
  const nextBillable = input.currentBillable + (input.billable ? 1 : 0)
  const nextHit = (input.currentHit ?? 0) + (input.hit ? 1 : 0)

  const { error: usageUpdateError } = await adminClient.from('skip_trace_usage').upsert(
    {
      user_id: input.userId,
      team_owner_id: input.workspaceId,
      month: input.month,
      count: nextCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,month' },
  )

  if (usageUpdateError) {
    throw new Error(usageUpdateError.message || 'Failed to update skip trace usage')
  }

  if (nextBillable !== input.currentBillable) {
    const { error: billableError } = await adminClient
      .from('skip_trace_usage')
      .update({ billable_count: nextBillable })
      .eq('user_id', input.userId)
      .eq('month', input.month)
    if (billableError) {
      console.error('skip_trace_usage.billable_count:', billableError.message)
    }
  }

  if (nextHit !== (input.currentHit ?? 0)) {
    const { error: hitError } = await adminClient
      .from('skip_trace_usage')
      .update({ hit_count: nextHit })
      .eq('user_id', input.userId)
      .eq('month', input.month)
    if (hitError) {
      console.error('skip_trace_usage.hit_count:', hitError.message)
    }
  }

  return { nextCount, nextBillable, nextHit }
}
