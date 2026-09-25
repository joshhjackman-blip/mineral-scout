import type { SupabaseClient } from '@supabase/supabase-js'

export type SkipTraceUsageRow = {
  count: number
  billableCount: number
}

/**
 * Monthly per-user skip-trace counters.
 *   count          — every provider call (cache miss)
 *   billable_count — phone hits that will appear on the team invoice
 *
 * billable_count was added after the original table; if the column is
 * missing we still increment `count` so skip-trace itself never fails.
 */
export async function readSkipTraceUsage(
  adminClient: SupabaseClient,
  userId: string,
  month: string,
): Promise<SkipTraceUsageRow> {
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
  }
}

export async function incrementSkipTraceUsage(
  adminClient: SupabaseClient,
  input: {
    userId: string
    workspaceId: string
    month: string
    currentCount: number
    currentBillable: number
    billable: boolean
  },
): Promise<{ nextCount: number; nextBillable: number }> {
  const nextCount = input.currentCount + 1
  const nextBillable = input.currentBillable + (input.billable ? 1 : 0)

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

  return { nextCount, nextBillable }
}
