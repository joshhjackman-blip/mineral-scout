/**
 * Client-safe researcher stats. Kept out of skip-trace-research.ts so the
 * owner dashboard does not bundle undici / skip-trace providers.
 */

export type ResearchHitRow = {
  id: string
  ownerName: string
  phones: string[]
  emails: string[]
  provider: string
  method: string
  person: string | null
  at: string
}

export type ResearchStats = {
  queued: number
  hits: number
  misses: number
  hitsToday: number
  byProvider: Array<{ name: string; count: number }>
  byMethod: Array<{ name: string; count: number }>
  recentHits: ResearchHitRow[]
}

export type ResearchReviewRow = {
  id: string
  owner_name: string
  phones?: string[] | null
  emails?: string[] | null
  notes?: string | null
  resolved_at?: string | null
  updated_at: string
}

const PROVIDER_LABELS: Record<string, string> = {
  idicore: 'idiCORE',
  accurateappend: 'Accurate Append',
  batchdata: 'BatchData',
  tracerfy: 'Tracerfy',
  cache: 'Cache',
}

export function providerLabel(source: string | null | undefined): string {
  const raw = String(source ?? '')
    .replace(/^research-/, '')
    .trim()
    .toLowerCase()
  if (!raw || raw === 'none') return 'Unknown'
  return PROVIDER_LABELS[raw] ?? raw
}

export function methodLabel(method: string | null | undefined): string {
  const raw = String(method ?? '').trim()
  if (!raw) return 'Name retry'
  if (raw.startsWith('officer:')) {
    const title = raw.slice('officer:'.length).replace(/_/g, ' ')
    if (/registered agent/i.test(title)) return 'TX registered agent'
    if (title.includes('>') || /\bGP\b/.test(title)) {
      const leaf = title.split('>').filter(Boolean).pop()?.trim() || ''
      return leaf && leaf !== 'GP' ? `TX GP · ${leaf}` : 'TX GP unwrap'
    }
    return `TX officer · ${title}`
  }
  if (raw === 'tax-roll-full') return 'Tax-roll full name'
  if (raw === 'tax-roll-first') return 'First name only'
  if (raw === 'review-enriched') return 'Enriched name'
  if (raw === 'cache') return 'Already in cache'
  return raw.replace(/_/g, ' ')
}

function attrValue(header: string, key: string): string | null {
  const quoted = header.match(new RegExp(`${key}="([^"]*)"`))
  if (quoted) return quoted[1]
  const plain = header.match(new RegExp(`${key}=([^\\s]+)`))
  return plain ? plain[1] : null
}

export function parseLatestResearchLine(notes: string | null | undefined): {
  at: string | null
  attempt: number
  hit: boolean | null
  provider: string | null
  method: string | null
  person: string | null
  body: string
} | null {
  const text = String(notes ?? '')
  const re = /\[research ([^\]]+)\]([^\n[]*)/g
  let last: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) last = match
  if (!last) return null
  const header = last[1] ?? ''
  const body = String(last[2] ?? '').trim()
  const atToken = header.split(/\s+/)[0] ?? ''
  const at = Number.isFinite(Date.parse(atToken)) ? atToken : null
  const attempt = Number(attrValue(header, 'attempt') ?? '0') || 0
  const hitAttr = attrValue(header, 'hit')
  let hit: boolean | null = hitAttr == null ? null : hitAttr === '1'
  const via = body.match(/hit via ([a-z0-9-]+) on ([^\s(]+)\s*\(([^)]+)\)/i)
  const provider =
    attrValue(header, 'provider') ||
    via?.[1] ||
    (body.includes('resolved from cache') ? 'cache' : null)
  const method =
    attrValue(header, 'method') ||
    via?.[2] ||
    (body.includes('resolved from cache') ? 'cache' : null)
  const person = attrValue(header, 'person') || via?.[3] || null
  if (hit == null && (via || body.includes('resolved from cache'))) hit = true
  if (hit == null && /no phone|no person candidates/i.test(body)) hit = false
  return { at, attempt, hit, provider, method, person, body }
}

export function formatResearchHitNote(input: {
  attempt: number
  provider: string
  method: string
  person: string
  phones: string[]
  tried: string[]
}): string {
  const at = new Date().toISOString()
  const person = input.person.replace(/"/g, '').trim()
  const method = input.method.replace(/\s+/g, '_')
  const phones = input.phones.join(',')
  return `[research ${at} attempt=${input.attempt} hit=1 provider=${input.provider} method=${method} person="${person}"] ${phones} tried ${input.tried.join(' | ')}`
}

export function emptyResearchStats(): ResearchStats {
  return {
    queued: 0,
    hits: 0,
    misses: 0,
    hitsToday: 0,
    byProvider: [],
    byMethod: [],
    recentHits: [],
  }
}

export function summarizeResearchReviews(
  openReviews: ResearchReviewRow[],
  resolvedReviews: ResearchReviewRow[],
  now = Date.now(),
): ResearchStats {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const todayMs = startOfToday.getTime()

  const providerCounts = new Map<string, number>()
  const methodCounts = new Map<string, number>()
  const bump = (map: Map<string, number>, key: string) => {
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  const recentHits: ResearchHitRow[] = []
  for (const review of resolvedReviews) {
    const parsed = parseLatestResearchLine(review.notes)
    if (!parsed || parsed.hit !== true) continue
    const at = parsed.at || review.resolved_at || review.updated_at
    const provider = parsed.provider || 'unknown'
    const method = parsed.method || 'name-retry'
    bump(providerCounts, providerLabel(provider))
    bump(methodCounts, methodLabel(method))
    recentHits.push({
      id: review.id,
      ownerName: review.owner_name,
      phones: review.phones ?? [],
      emails: review.emails ?? [],
      provider,
      method,
      person: parsed.person,
      at,
    })
  }
  recentHits.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  let misses = 0
  for (const review of openReviews) {
    const parsed = parseLatestResearchLine(review.notes)
    if (parsed && parsed.hit === false) misses += 1
  }

  const toList = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return {
    queued: openReviews.length,
    hits: recentHits.length,
    misses,
    hitsToday: recentHits.filter((hit) => Date.parse(hit.at) >= todayMs).length,
    byProvider: toList(providerCounts),
    byMethod: toList(methodCounts),
    recentHits: recentHits.slice(0, 40),
  }
}
