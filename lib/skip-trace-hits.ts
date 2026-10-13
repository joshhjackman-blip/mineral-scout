import { parseLatestResearchLine, type ResearchReviewRow } from '@/lib/skip-trace-research-stats'

export const SKIP_TRACE_HIT_OPEN_EVENT = 'mineral-map:open-skip-trace-hit'

export type SkipTraceFoundHit = {
  id: string
  ownerName: string
  phones: string[]
  emails: string[]
  dealId: string | null
  foundAt: string
  person: string | null
}

export type SkipTraceHitReview = ResearchReviewRow & {
  phones?: string[] | null
  emails?: string[] | null
  deal_id?: string | null
  requested_by?: string | null
  status?: string | null
}

/** Researcher recovered a phone on a previously missed skip-trace. */
export function reviewToFoundHit(review: SkipTraceHitReview): SkipTraceFoundHit | null {
  if (review.status && review.status !== 'resolved') return null
  const parsed = parseLatestResearchLine(review.notes)
  if (!parsed || parsed.hit !== true) return null
  const phones = (review.phones ?? []).map((p) => String(p ?? '').trim()).filter(Boolean)
  if (phones.length === 0) return null
  return {
    id: review.id,
    ownerName: review.owner_name,
    phones,
    emails: (review.emails ?? []).map((e) => String(e ?? '').trim()).filter(Boolean),
    dealId: review.deal_id ?? null,
    foundAt: parsed.at || review.resolved_at || review.updated_at,
    person: parsed.person,
  }
}

export function unackedFoundHits(
  reviews: SkipTraceHitReview[],
  ackedIds: Iterable<string>,
): SkipTraceFoundHit[] {
  const seen = new Set(Array.from(ackedIds).map((id) => String(id)))
  const hits: SkipTraceFoundHit[] = []
  for (const review of reviews) {
    if (seen.has(review.id)) continue
    const hit = reviewToFoundHit(review)
    if (hit) hits.push(hit)
  }
  hits.sort((a, b) => Date.parse(b.foundAt) - Date.parse(a.foundAt))
  return hits
}

export const PREVIEW_FOUND_HITS: SkipTraceFoundHit[] = [
  {
    id: 'preview-hit-hall',
    ownerName: 'HALL TOYA ELIZABETH',
    phones: ['4322693179', '4327562784'],
    emails: [],
    dealId: null,
    foundAt: new Date().toISOString(),
    person: 'TOYA ELIZABETH HALL',
  },
  {
    id: 'preview-hit-hover',
    ownerName: 'HOVER JANIS B',
    phones: ['4325283544'],
    emails: [],
    dealId: null,
    foundAt: new Date(Date.now() - 60_000).toISOString(),
    person: 'JANIS B HOVER',
  },
]

export function shouldLoadPreviewHits(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('preview') === '1'
}

export function formatHitPhone(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const digits = text.replace(/\D/g, '')
  if (digits.length < 10) return text
  const last10 = digits.slice(-10)
  return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`
}
