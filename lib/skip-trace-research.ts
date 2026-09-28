/**
 * Background miss researcher. Walks open skip_trace_reviews, unwraps tax-roll
 * trust names and TX Comptroller officers, then re-runs the paid skip-trace
 * chain. Hits are written to skip_trace_cache + every deal for that owner.
 * Not a fifth live-path provider — the user is not billed again.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { skipTraceOwnerKey } from '@/lib/skip-trace-cache'
import { lookupTxEntityPeople, type EntityPerson } from '@/lib/skip-trace-entities'
import {
  enrichPersonTraceArgs,
  normalizeZip,
  parseTaxRollOwner,
  personCandidatesFromTaxRoll,
} from '@/lib/skip-trace-name'
import {
  runSkipTraceChain,
  skipTraceProvidersConfigured,
  type TraceArgs,
} from '@/lib/skip-trace-providers'
import {
  applySkipTracePhones,
  type SkipTraceReview,
} from '@/lib/skip-trace-review'
import { formatResearchHitNote } from '@/lib/skip-trace-research-stats'

const MAX_ATTEMPTS = 3
const RECENT_MS = 6 * 60 * 60 * 1000
const MAX_TARGETS = 5

export type ResearchTarget = TraceArgs & { label: string }

export type ResearchItemResult = {
  ownerName: string
  status: 'hit' | 'miss' | 'skipped' | 'cached'
  source: string
  phones: string[]
  emails: string[]
  tried: string[]
  note: string
}

export function parseResearchAttempts(notes: string | null | undefined): {
  attempts: number
  lastAt: number | null
} {
  let attempts = 0
  let lastAt: number | null = null
  const text = String(notes ?? '')
  const re = /\[research ([^\]]+) attempt=(\d+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    attempts = Math.max(attempts, Number(match[2]) || 0)
    const ts = Date.parse(match[1] ?? '')
    if (Number.isFinite(ts)) lastAt = lastAt == null ? ts : Math.max(lastAt, ts)
  }
  return { attempts, lastAt }
}

export function shouldSkipResearch(
  review: Pick<SkipTraceReview, 'notes'>,
  now = Date.now(),
): { skip: boolean; reason: string } {
  const { attempts, lastAt } = parseResearchAttempts(review.notes)
  if (attempts >= MAX_ATTEMPTS) {
    return { skip: true, reason: `already tried ${attempts} times` }
  }
  if (lastAt != null && now - lastAt < RECENT_MS) {
    return { skip: true, reason: 'researched recently' }
  }
  return { skip: false, reason: '' }
}

function mailingFromReview(review: SkipTraceReview): Pick<TraceArgs, 'address' | 'city' | 'state' | 'zip'> {
  return {
    address: review.mailing_address ?? '',
    city: review.mailing_city ?? '',
    state: review.mailing_state ?? '',
    zip: normalizeZip(review.mailing_zip),
  }
}

function targetKey(target: ResearchTarget): string {
  return [
    (target.firstName ?? '').trim().toUpperCase(),
    (target.lastName ?? '').trim().toUpperCase(),
    (target.address ?? '').trim().toUpperCase(),
    (target.city ?? '').trim().toUpperCase(),
    (target.zip ?? '').trim(),
  ].join('|')
}

export function personTargetsFromReview(review: SkipTraceReview): ResearchTarget[] {
  const parsed = parseTaxRollOwner(review.owner_name)
  if (parsed.kind === 'business') return []

  const mail = mailingFromReview(review)
  const ownerName = review.owner_name
  const targets: ResearchTarget[] = []
  const seen = new Set<string>()
  const push = (target: ResearchTarget) => {
    const key = targetKey(target)
    if (!target.firstName?.trim() || !target.lastName?.trim()) return
    if (seen.has(key)) return
    seen.add(key)
    targets.push(target)
  }

  for (const candidate of personCandidatesFromTaxRoll(ownerName)) {
    push({
      ownerName,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      label: candidate.label,
      ...mail,
    })
  }

  const enriched = enrichPersonTraceArgs({
    ownerName,
    firstName: review.first_name ?? '',
    lastName: review.last_name ?? '',
    ...mail,
  })
  if (enriched.firstName && enriched.lastName) {
    push({
      ownerName,
      firstName: enriched.firstName,
      lastName: enriched.lastName,
      label: 'review-enriched',
      address: enriched.address,
      city: enriched.city,
      state: enriched.state,
      zip: enriched.zip,
    })
  }

  return targets.slice(0, MAX_TARGETS)
}

export function officerToTargets(
  ownerName: string,
  officers: EntityPerson[],
  review: SkipTraceReview,
): ResearchTarget[] {
  const mail = mailingFromReview(review)
  return officers.map((officer) => ({
    ownerName,
    firstName: officer.firstName,
    lastName: officer.lastName,
    address: officer.address || mail.address,
    city: officer.city || mail.city,
    state: officer.state || mail.state,
    zip: officer.zip || mail.zip,
    label: `officer:${officer.title ?? 'person'}`,
  }))
}

export async function collectResearchTargets(
  review: SkipTraceReview,
): Promise<ResearchTarget[]> {
  const parsed = parseTaxRollOwner(review.owner_name)
  const person = personTargetsFromReview(review)
  const needEntity = parsed.kind === 'business' || person.length === 0
  if (!needEntity) return person.slice(0, MAX_TARGETS)

  const officers = await lookupTxEntityPeople(review.owner_name, {
    zip: review.mailing_zip,
    maxPeople: 4,
  })
  const fromOfficers = officerToTargets(review.owner_name, officers, review)
  const merged: ResearchTarget[] = []
  const seen = new Set<string>()
  for (const target of [...fromOfficers, ...person]) {
    const key = targetKey(target)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(target)
    if (merged.length >= MAX_TARGETS) break
  }
  return merged
}

function researchNote(attempt: number, body: string, hit = false): string {
  return `[research ${new Date().toISOString()} attempt=${attempt} hit=${hit ? 1 : 0}] ${body}`
}

async function markResearchMiss(
  admin: SupabaseClient,
  review: SkipTraceReview,
  attempt: number,
  body: string,
): Promise<void> {
  const line = researchNote(attempt, body)
  const notes = [line, review.notes].filter(Boolean).join('\n').slice(0, 2000)
  await admin
    .from('skip_trace_reviews')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', review.id)
}

export async function researchSkipTraceReview(
  admin: SupabaseClient,
  review: SkipTraceReview,
): Promise<ResearchItemResult> {
  const ownerName = review.owner_name
  const cacheKey = skipTraceOwnerKey(ownerName)
  if (cacheKey) {
    const { data: cachedRows } = await admin
      .from('skip_trace_cache')
      .select('phones, emails, source')
      .eq('owner_name', cacheKey)
      .order('updated_at', { ascending: false })
      .limit(1)
    const cached = cachedRows?.[0] as
      | { phones?: string[]; emails?: string[]; source?: string }
      | undefined
    const cachedPhones = cached?.phones ?? []
    if (cachedPhones.length > 0) {
      await applySkipTracePhones(admin, {
        ownerName,
        mailingAddress: review.mailing_address ?? '',
        phones: cachedPhones,
        emails: cached?.emails ?? review.emails ?? [],
        source: cached?.source || 'cache',
        dealId: review.deal_id,
        reviewId: review.id,
        notes: formatResearchHitNote({
          attempt: 1,
          provider: 'cache',
          method: 'cache',
          person: ownerName,
          phones: cachedPhones,
          tried: ['cache'],
        }),
      })
      return {
        ownerName,
        status: 'cached',
        source: cached?.source || 'cache',
        phones: cachedPhones,
        emails: cached?.emails ?? [],
        tried: [],
        note: 'cache hit',
      }
    }
  }

  const gate = shouldSkipResearch(review)
  if (gate.skip) {
    return {
      ownerName,
      status: 'skipped',
      source: 'none',
      phones: [],
      emails: [],
      tried: [],
      note: gate.reason,
    }
  }

  if (!skipTraceProvidersConfigured()) {
    return {
      ownerName,
      status: 'skipped',
      source: 'none',
      phones: [],
      emails: [],
      tried: [],
      note: 'skip-trace providers are not configured',
    }
  }

  const { attempts } = parseResearchAttempts(review.notes)
  const attempt = attempts + 1
  const targets = await collectResearchTargets(review)
  if (targets.length === 0) {
    const note = 'no person candidates after unwrap'
    await markResearchMiss(admin, review, attempt, note)
    return {
      ownerName,
      status: 'miss',
      source: 'none',
      phones: [],
      emails: [],
      tried: [],
      note,
    }
  }

  const triedLabels: string[] = []
  let bestEmails: string[] = review.emails ?? []
  for (const target of targets) {
    triedLabels.push(
      `${target.label}:${target.firstName} ${target.lastName}`.trim(),
    )
    try {
      const result = await runSkipTraceChain(target)
      if (result.emails.length > 0) {
        bestEmails = Array.from(new Set([...bestEmails, ...result.emails]))
      }
      if (result.phones.length > 0) {
        const note = formatResearchHitNote({
          attempt,
          provider: result.source,
          method: target.label,
          person: `${target.firstName} ${target.lastName}`.trim(),
          phones: result.phones,
          tried: triedLabels,
        })
        await applySkipTracePhones(admin, {
          ownerName,
          mailingAddress: target.address || review.mailing_address || '',
          phones: result.phones,
          emails: result.emails.length > 0 ? result.emails : bestEmails,
          source: `research-${result.source}`,
          dealId: review.deal_id,
          reviewId: review.id,
          notes: note,
        })
        return {
          ownerName,
          status: 'hit',
          source: result.source,
          phones: result.phones,
          emails: result.emails,
          tried: triedLabels,
          note,
        }
      }
    } catch (err) {
      console.error('Skip-trace research target failed:', ownerName, target.label, err)
    }
  }

  const note = `tried ${triedLabels.join(' | ')}; no phone`
  await markResearchMiss(admin, review, attempt, note)
  return {
    ownerName,
    status: 'miss',
    source: 'none',
    phones: [],
    emails: bestEmails,
    tried: triedLabels,
    note,
  }
}

export async function researchOpenSkipTraceReviews(
  admin: SupabaseClient,
  options: { limit?: number; ownerName?: string | null } = {},
): Promise<{ processed: number; results: ResearchItemResult[] }> {
  const limit = Math.max(1, Math.min(options.limit ?? 6, 20))
  let query = admin
    .from('skip_trace_reviews')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(limit * 3)

  if (options.ownerName) {
    query = query.eq('owner_name_key', skipTraceOwnerKey(options.ownerName))
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }
  const reviews = (data ?? []) as SkipTraceReview[]
  const results: ResearchItemResult[] = []
  for (const review of reviews) {
    if (results.filter((r) => r.status !== 'skipped').length >= limit) break
    const result = await researchSkipTraceReview(admin, review)
    results.push(result)
  }
  return { processed: results.length, results }
}
