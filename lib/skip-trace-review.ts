import type { SupabaseClient } from '@supabase/supabase-js'
import { skipTraceOwnerKey } from '@/lib/workspace'

export type SkipTraceReviewStatus = 'open' | 'resolved' | 'dismissed'

export type SkipTraceReview = {
  id: string
  owner_name: string
  owner_name_key: string
  first_name?: string | null
  last_name?: string | null
  mailing_address?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  county?: string | null
  tract_abstract?: string | null
  deal_id?: string | null
  team_owner_id?: string | null
  requested_by?: string | null
  requested_by_email?: string | null
  emails: string[]
  phones: string[]
  status: SkipTraceReviewStatus
  notes?: string | null
  created_at: string
  updated_at: string
  resolved_at?: string | null
  resolved_by?: string | null
}

export type QueueSkipTraceReviewInput = {
  ownerName: string
  firstName?: string | null
  lastName?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
  tractAbstract?: string | null
  dealId?: string | null
  teamOwnerId?: string | null
  requestedBy?: string | null
  requestedByEmail?: string | null
  emails?: string[]
}

export function parseContactLines(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw.split(/[\n,;]+/)) {
    const value = line.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

export async function queueSkipTraceReview(
  admin: SupabaseClient,
  input: QueueSkipTraceReviewInput,
): Promise<boolean> {
  const ownerName = String(input.ownerName ?? '').trim()
  const ownerNameKey = skipTraceOwnerKey(ownerName)
  if (!ownerNameKey) return false

  const now = new Date().toISOString()
  const dealId =
    input.dealId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.dealId)
      ? input.dealId
      : null
  const row = {
    owner_name: ownerName,
    owner_name_key: ownerNameKey,
    first_name: input.firstName ?? null,
    last_name: input.lastName ?? null,
    mailing_address: input.address ?? null,
    mailing_city: input.city ?? null,
    mailing_state: input.state ?? null,
    mailing_zip: input.zip ?? null,
    county: input.county ?? null,
    tract_abstract: input.tractAbstract ?? null,
    deal_id: dealId,
    team_owner_id: input.teamOwnerId ?? null,
    requested_by: input.requestedBy ?? null,
    requested_by_email: input.requestedByEmail ?? null,
    emails: input.emails ?? [],
    phones: [] as string[],
    status: 'open',
    updated_at: now,
  }

  const { data: existing, error: lookupError } = await admin
    .from('skip_trace_reviews')
    .select('id')
    .eq('owner_name_key', ownerNameKey)
    .eq('status', 'open')
    .maybeSingle()

  if (lookupError) {
    console.error('Skip-trace review lookup failed:', lookupError)
    return false
  }

  if (existing?.id) {
    const { error } = await admin
      .from('skip_trace_reviews')
      .update(row)
      .eq('id', existing.id)
    if (error) {
      console.error('Skip-trace review update failed:', error)
      return false
    }
    return true
  }

  const { error } = await admin.from('skip_trace_reviews').insert(row)
  if (error) {
    console.error('Skip-trace review insert failed:', error)
    return false
  }
  return true
}
