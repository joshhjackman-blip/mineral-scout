import type { SupabaseClient } from '@supabase/supabase-js'
import { phoneKey } from '@/lib/phone-activity'

function skipTraceOwnerKey(ownerName: string | null | undefined): string {
  return String(ownerName ?? '')
    .trim()
    .toUpperCase()
}

export type SkipTraceReviewStatus = 'open' | 'resolved' | 'dismissed'
export type SkipTraceReviewReason = 'no_phone' | 'wrong_number'

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
  reason?: SkipTraceReviewReason | null
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
  phones?: string[]
  reason?: SkipTraceReviewReason
  notes?: string | null
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

export function mergeContactLines(existing: string[] | null | undefined, incoming: string[] | null | undefined): string[] {
  return parseContactLines([...(existing ?? []), ...(incoming ?? [])].join('\n'))
}

export function reviewReasonLabel(reason: string | null | undefined): string {
  return reason === 'wrong_number' ? 'Wrong #' : 'No phone'
}

function uuidOrNull(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

async function writeReview(
  admin: SupabaseClient,
  row: Record<string, unknown>,
  existingId?: string | null,
): Promise<boolean> {
  const withReason = { ...row }
  const withoutReason = { ...row }
  delete withoutReason.reason

  const attempt = async (payload: Record<string, unknown>) => {
    if (existingId) {
      return admin.from('skip_trace_reviews').update(payload).eq('id', existingId)
    }
    return admin.from('skip_trace_reviews').insert(payload)
  }

  const first = await attempt(withReason)
  if (!first.error) return true
  if (!String(first.error.message ?? '').includes('reason')) {
    console.error('Skip-trace review write failed:', first.error)
    return false
  }
  const fallback = await attempt(withoutReason)
  if (fallback.error) {
    console.error('Skip-trace review write failed:', fallback.error)
    return false
  }
  return true
}

export async function queueSkipTraceReview(
  admin: SupabaseClient,
  input: QueueSkipTraceReviewInput,
): Promise<boolean> {
  const ownerName = String(input.ownerName ?? '').trim()
  const ownerNameKey = skipTraceOwnerKey(ownerName)
  if (!ownerNameKey) return false

  const now = new Date().toISOString()
  const reason: SkipTraceReviewReason = input.reason === 'wrong_number' ? 'wrong_number' : 'no_phone'
  const incomingPhones = parseContactLines((input.phones ?? []).join('\n'))

  const { data: existing, error: lookupError } = await admin
    .from('skip_trace_reviews')
    .select('id, phones, emails, reason, notes')
    .eq('owner_name_key', ownerNameKey)
    .eq('status', 'open')
    .maybeSingle()

  if (lookupError) {
    console.error('Skip-trace review lookup failed:', lookupError)
    return false
  }

  const existingRow = existing as {
    id?: string
    phones?: string[] | null
    emails?: string[] | null
    reason?: string | null
    notes?: string | null
  } | null

  const mergedReason: SkipTraceReviewReason =
    existingRow?.reason === 'wrong_number' || reason === 'wrong_number'
      ? 'wrong_number'
      : 'no_phone'
  const phones = mergeContactLines(existingRow?.phones, incomingPhones)
  const emails = mergeContactLines(existingRow?.emails, input.emails)
  const notes = input.notes ?? existingRow?.notes ?? null

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
    deal_id: uuidOrNull(input.dealId),
    team_owner_id: uuidOrNull(input.teamOwnerId),
    requested_by: uuidOrNull(input.requestedBy),
    requested_by_email: input.requestedByEmail ?? null,
    emails,
    phones,
    reason: mergedReason,
    notes,
    status: 'open',
    updated_at: now,
  }

  return writeReview(admin, row, existingRow?.id)
}

/** Drop a bad number from the shared skip-trace cache so other teams don't get it. */
export async function stripPhoneFromSkipTraceCache(
  admin: SupabaseClient,
  ownerName: string,
  phone: string,
): Promise<void> {
  const cacheKey = skipTraceOwnerKey(ownerName)
  const bad = phoneKey(phone)
  if (!cacheKey || !bad) return

  const { data, error } = await admin
    .from('skip_trace_cache')
    .select('phones, emails, mailing_address, source')
    .eq('owner_name', cacheKey)
    .maybeSingle()
  if (error || !data) return

  const remaining = ((data as { phones?: string[] }).phones ?? []).filter(
    (value) => phoneKey(value) !== bad,
  )
  await admin.from('skip_trace_cache').delete().eq('owner_name', cacheKey)
  if (remaining.length === 0) return

  const now = new Date().toISOString()
  await admin.from('skip_trace_cache').insert({
    owner_name: cacheKey,
    mailing_address: (data as { mailing_address?: string }).mailing_address ?? '',
    phones: remaining,
    emails: (data as { emails?: string[] }).emails ?? [],
    source: (data as { source?: string }).source ?? 'owner_manual',
    updated_at: now,
  })
}
