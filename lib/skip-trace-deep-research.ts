/**
 * Slow second-pass researcher for misses the 15-minute agent already exhausted.
 * Cheap deterministic name repairs first; Claude only when that yields nothing
 * and the roll looks like a person. One pass. If it still misses, stop.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { skipTraceOwnerKey } from '@/lib/skip-trace-cache'
import {
  deterministicDeepCandidates,
  formatDeepMissNote,
  identityKey,
  isInitialsGivenName,
  isUntraceableOwner,
  parseDeepAttempts,
  triedIdentityKeys,
} from '@/lib/skip-trace-deep-names'
import {
  normalizeZip,
  parseTaxRollOwner,
  type PersonTraceCandidate,
} from '@/lib/skip-trace-name'
import { isFastResearchExhausted } from '@/lib/skip-trace-research'
import { formatResearchHitNote } from '@/lib/skip-trace-research-stats'
import {
  runSkipTraceChain,
  skipTraceProvidersConfigured,
} from '@/lib/skip-trace-providers'
import {
  applySkipTracePhones,
  type SkipTraceReview,
} from '@/lib/skip-trace-review'

const OPEN_REVIEW_SCAN = 200
const MAX_DEEP_ATTEMPTS = 1
const MAX_IDENTITIES = 3
const DEEP_MODEL = process.env.ANTHROPIC_DEEP_MODEL || 'claude-haiku-4-5-20251001'

export type DeepResearchResult = {
  ownerName: string
  status: 'hit' | 'miss' | 'skipped' | 'cached' | 'untraceable'
  source: string
  phones: string[]
  tried: string[]
  note: string
}

export function pickReviewsForDeepResearch(
  reviews: Array<Pick<SkipTraceReview, 'notes' | 'owner_name' | 'created_at'>>,
  options: { limit: number; now?: number },
): typeof reviews {
  const now = options.now ?? Date.now()
  const ready = reviews.filter((review) => {
    if (!isFastResearchExhausted(review, now)) return false
    const deep = parseDeepAttempts(review.notes)
    if (deep.exhausted || deep.attempts >= MAX_DEEP_ATTEMPTS) return false
    return true
  })
  return ready
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(0, Math.max(1, options.limit))
}

function mailing(review: SkipTraceReview) {
  return {
    address: review.mailing_address ?? '',
    city: review.mailing_city ?? '',
    state: review.mailing_state ?? '',
    zip: normalizeZip(review.mailing_zip),
  }
}

async function markDeepMiss(
  admin: SupabaseClient,
  review: SkipTraceReview,
  attempt: number,
  body: string,
  exhausted = true,
): Promise<void> {
  const line = formatDeepMissNote(attempt, body, exhausted)
  const notes = [line, review.notes].filter(Boolean).join('\n').slice(0, 2000)
  await admin
    .from('skip_trace_reviews')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', review.id)
}

function parseClaudePeople(raw: string): PersonTraceCandidate[] {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      people?: Array<{ firstName?: string; lastName?: string; why?: string }>
    }
    const out: PersonTraceCandidate[] = []
    for (const person of parsed.people ?? []) {
      const first = String(person.firstName ?? '').trim().toUpperCase()
      const last = String(person.lastName ?? '').trim().toUpperCase()
      if (!first || !last) continue
      if (isInitialsGivenName(first.split(/\s+/))) continue
      const why = String(person.why ?? 'claude').replace(/\s+/g, '-').slice(0, 24)
      out.push({ firstName: first, lastName: last, label: `deep-${why || 'claude'}` })
    }
    return out
  } catch {
    return []
  }
}

export async function claudeDeepCandidates(
  review: SkipTraceReview,
  already: PersonTraceCandidate[],
): Promise<PersonTraceCandidate[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return []
  const parsed = parseTaxRollOwner(review.owner_name)
  if (parsed.kind === 'business') return []

  const tried = [
    ...Array.from(triedIdentityKeys(review.notes)).map((key) => key.replace('|', ' ')),
    ...already.map((c) => `${c.firstName} ${c.lastName}`),
  ]

  const prompt = [
    'Skip-trace missed this mineral-roll owner. Suggest up to 3 person names to search.',
    'JSON only: {"people":[{"firstName":"","lastName":"","why":"spelling|maiden|initials"}]}',
    'Only real likely identities. Empty people array if you should not guess.',
    'Do not invent company officers. Do not repeat names already tried.',
    `Owner: ${review.owner_name}`,
    `Mailing: ${[review.mailing_address, review.mailing_city, review.mailing_state, review.mailing_zip].filter(Boolean).join(', ')}`,
    `County: ${review.county || 'unknown'}`,
    `Already tried: ${tried.join('; ') || 'none'}`,
  ].join('\n')

  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model: DEEP_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = msg.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
  return parseClaudePeople(text)
}

export async function collectDeepIdentities(
  review: SkipTraceReview,
  options: { askClaude?: boolean } = {},
): Promise<PersonTraceCandidate[]> {
  const tried = triedIdentityKeys(review.notes)
  const seen = new Set(tried)
  const out: PersonTraceCandidate[] = []
  const pushAll = (rows: PersonTraceCandidate[]) => {
    for (const row of rows) {
      const key = identityKey(row.firstName, row.lastName)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
      if (out.length >= MAX_IDENTITIES) return
    }
  }

  pushAll(deterministicDeepCandidates(review.owner_name, review.notes))
  const parsed = parseTaxRollOwner(review.owner_name)
  const needClaude =
    options.askClaude !== false &&
    parsed.kind !== 'business' &&
    out.length === 0 &&
    isInitialsGivenName(parsed.givenNames)
  if (needClaude && out.length < MAX_IDENTITIES) {
    try {
      pushAll(await claudeDeepCandidates(review, out))
    } catch (err) {
      console.error('deep-research Claude:', err)
    }
  }
  return out.slice(0, MAX_IDENTITIES)
}

export async function researchDeepSkipTraceReview(
  admin: SupabaseClient,
  review: SkipTraceReview,
): Promise<DeepResearchResult> {
  const ownerName = review.owner_name
  const attempt = parseDeepAttempts(review.notes).attempts + 1

  if (isUntraceableOwner(ownerName)) {
    const note = 'not a person — will not retry'
    await markDeepMiss(admin, review, attempt, note, true)
    return { ownerName, status: 'untraceable', source: 'none', phones: [], tried: [], note }
  }

  if (!skipTraceProvidersConfigured()) {
    return {
      ownerName,
      status: 'skipped',
      source: 'none',
      phones: [],
      tried: [],
      note: 'skip-trace providers are not configured',
    }
  }

  const parsed = parseTaxRollOwner(ownerName)
  if (parsed.kind === 'business') {
    const note = 'entity with no person on the first pass — will not retry'
    await markDeepMiss(admin, review, attempt, note, true)
    return { ownerName, status: 'untraceable', source: 'none', phones: [], tried: [], note }
  }

  const identities = await collectDeepIdentities(review)
  if (identities.length === 0) {
    const note = 'no new identities — will not retry'
    await markDeepMiss(admin, review, attempt, note, true)
    return { ownerName, status: 'miss', source: 'none', phones: [], tried: [], note }
  }

  const mail = mailing(review)
  const triedLabels: string[] = []
  for (const person of identities) {
    const label = `${person.label}:${person.firstName} ${person.lastName}`
    triedLabels.push(label)
    try {
      const result = await runSkipTraceChain({
        ownerName,
        firstName: person.firstName,
        lastName: person.lastName,
        ...mail,
      })
      if (result.phones.length > 0) {
        const note = formatResearchHitNote({
          attempt,
          provider: result.source,
          method: person.label,
          person: `${person.firstName} ${person.lastName}`,
          phones: result.phones,
          tried: triedLabels,
        })
        await applySkipTracePhones(admin, {
          ownerName,
          mailingAddress: mail.address,
          phones: result.phones,
          emails: result.emails,
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
          tried: triedLabels,
          note,
        }
      }
    } catch (err) {
      console.error('deep-research target failed:', ownerName, label, err)
    }
  }

  const note = `tried ${triedLabels.join(' | ')}; no phone — will not retry`
  await markDeepMiss(admin, review, attempt, note, true)
  return { ownerName, status: 'miss', source: 'none', phones: [], tried: triedLabels, note }
}

export async function researchExhaustedSkipTraceReviews(
  admin: SupabaseClient,
  options: { limit?: number; ownerName?: string | null } = {},
): Promise<{ processed: number; results: DeepResearchResult[] }> {
  const limit = Math.max(1, Math.min(options.limit ?? 2, 6))
  let query = admin
    .from('skip_trace_reviews')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(OPEN_REVIEW_SCAN)

  if (options.ownerName) {
    query = query.eq('owner_name_key', skipTraceOwnerKey(options.ownerName))
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  const reviews = (data ?? []) as SkipTraceReview[]
  const selected = options.ownerName
    ? reviews.slice(0, limit)
    : (pickReviewsForDeepResearch(reviews, { limit }) as SkipTraceReview[])
  const results: DeepResearchResult[] = []
  for (const review of selected) {
    results.push(await researchDeepSkipTraceReview(admin, review))
  }
  return { processed: results.length, results }
}
