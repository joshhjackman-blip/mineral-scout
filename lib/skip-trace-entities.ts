/**
 * Unwrap LLC / LP / INC mineral owners via the Texas Comptroller's public
 * franchise-tax search (same JSON the official Account Status page uses).
 * Returns officers + registered agent as skip-trace people. Does not scrape
 * TruePeopleSearch or other consumer people-search sites.
 */

import {
  entitySearchQueries,
  isBusinessOwner,
  normalizeZip,
  parseWesternPersonName,
  scoreEntityNameMatch,
  type PersonTraceCandidate,
} from '@/lib/skip-trace-name'

const TX_FTAS_BASE = 'https://comptroller.texas.gov/data-search/franchise-tax'
const UA = 'Mozilla/5.0 (compatible; MineralMap/1.0 skip-trace-research; +https://getmineralmap.com)'

const CORPORATE_AGENT_RE =
  /\b(CORPORATION SERVICE|C T CORPORATION|CT CORPORATION|NATIONAL REGISTERED AGENTS|INCORP SERVICES|REGISTERED AGENT SOLUTIONS|LEGALINC|NORTHWEST REGISTERED AGENT|CAPITOL CORPORATE|UNITED AGENT GROUP|COGENCY GLOBAL|REGISTERED AGENTS? INC|CSC\b|CT CORP)\b/i

const OFFICER_TITLE_RANK: Record<string, number> = {
  PRESIDENT: 100,
  CEO: 95,
  OWNER: 90,
  MANAGER: 85,
  'MANAGING MEMBER': 85,
  MEMBER: 80,
  'GENERAL PA': 75,
  'GENERAL PARTNER': 75,
  GP: 75,
  VP: 60,
  SECRETARY: 50,
  TREASURER: 50,
  DIRECTOR: 40,
  'ASST SEC': 20,
}

export type EntityPerson = PersonTraceCandidate & {
  title: string | null
  address?: string
  city?: string
  state?: string
  zip?: string
  source: 'tx-comptroller'
}

type FtasSearchRow = {
  name?: string
  taxpayerId?: string
  mailingAddressZip?: string
}

type FtasOfficer = {
  AGNT_NM?: string
  AGNT_TITL_TX?: string
  AD_STR_POB_TX?: string
  CITY_NM?: string
  ST_CD?: string
  AD_ZP?: string
}

type FtasDetail = {
  name?: string
  taxpayerId?: string
  mailingAddressStreet?: string
  mailingAddressCity?: string
  mailingAddressState?: string
  mailingAddressZip?: string
  registeredAgentName?: string
  registeredOfficeAddressStreet?: string
  registeredOfficeAddressCity?: string
  registeredOfficeAddressState?: string
  registeredOfficeAddressZip?: string
  officerInfo?: FtasOfficer[]
}

async function ftasGet(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': UA },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('TX Comptroller FTAS', res.status, url.slice(0, 120))
      return null
    }
    return (await res.json()) as unknown
  } catch (err) {
    console.error('TX Comptroller FTAS error:', err)
    return null
  }
}

function pickBestFtasMatch(
  query: string,
  rows: FtasSearchRow[],
  zip?: string,
): FtasSearchRow | null {
  const wantZip = normalizeZip(zip)
  let best: FtasSearchRow | null = null
  let bestScore = 0
  for (const row of rows) {
    const name = String(row.name ?? '')
    let score = scoreEntityNameMatch(query, name)
    if (wantZip && normalizeZip(row.mailingAddressZip) === wantZip) score += 25
    if (score > bestScore) {
      bestScore = score
      best = row
    }
  }
  if (!best || bestScore < 50) return null
  return best
}

function titleRank(title: string | null | undefined): number {
  const key = String(title ?? '').trim().toUpperCase()
  if (!key) return 10
  return OFFICER_TITLE_RANK[key] ?? 15
}

function isCorporateAgent(name: string): boolean {
  return CORPORATE_AGENT_RE.test(name) || isBusinessOwner(name)
}

export function peopleFromFtasDetail(detail: FtasDetail): EntityPerson[] {
  const people: EntityPerson[] = []
  const seen = new Set<string>()

  const push = (
    rawName: string | null | undefined,
    title: string | null,
    address?: string | null,
    city?: string | null,
    state?: string | null,
    zip?: string | null,
  ) => {
    const parsed = parseWesternPersonName(rawName)
    if (!parsed) return
    if (isCorporateAgent(String(rawName ?? ''))) return
    const key = `${parsed.firstName}|${parsed.lastName}`.toUpperCase()
    if (seen.has(key)) return
    seen.add(key)
    people.push({
      ...parsed,
      title,
      address: address?.trim() || undefined,
      city: city?.trim() || undefined,
      state: state?.trim() || undefined,
      zip: normalizeZip(zip) || undefined,
      source: 'tx-comptroller',
    })
  }

  const officers = [...(detail.officerInfo ?? [])].sort(
    (a, b) => titleRank(b.AGNT_TITL_TX) - titleRank(a.AGNT_TITL_TX),
  )
  for (const officer of officers) {
    push(
      officer.AGNT_NM,
      officer.AGNT_TITL_TX ?? null,
      officer.AD_STR_POB_TX,
      officer.CITY_NM,
      officer.ST_CD,
      officer.AD_ZP,
    )
  }

  push(
    detail.registeredAgentName,
    'REGISTERED AGENT',
    detail.registeredOfficeAddressStreet,
    detail.registeredOfficeAddressCity,
    detail.registeredOfficeAddressState,
    detail.registeredOfficeAddressZip,
  )

  return people
}

export function isGpTitle(title: string | null | undefined): boolean {
  return /\b(GENERAL\s*PA|GENERAL PARTNER|\bGP\b)\b/i.test(String(title ?? ''))
}

export function looksLikeLimitedPartnership(name: string | null | undefined): boolean {
  return /\b(L\.?P\.?|LTD|LIMITED PARTNERSHIP)\b/i.test(String(name ?? ''))
}

export function gpSearchQueries(ownerName: string | null | undefined): string[] {
  const bases = entitySearchQueries(ownerName)
  const out: string[] = []
  const push = (q: string) => {
    const trimmed = q.trim()
    if (trimmed.length >= 4 && trimmed.length <= 50 && !out.includes(trimmed)) out.push(trimmed)
  }
  for (const base of bases) {
    push(`${base} GP`)
    push(`${base} GENERAL PARTNER`)
    push(`${base} MANAGEMENT`)
  }
  return out
}

function entitySeenKey(name: string | null | undefined): string {
  return entitySearchQueries(name)[0] ?? String(name ?? '').trim().toUpperCase()
}

export function corporateOfficerNames(detail: FtasDetail): string[] {
  return corporateOfficersToRecurse(detail).map((row) => row.name)
}

export function corporateOfficersToRecurse(detail: FtasDetail): Array<{
  name: string
  title: string | null
}> {
  const rows: Array<{ name: string; title: string | null }> = []
  const seen = new Set<string>()
  const officers = [...(detail.officerInfo ?? [])].sort((a, b) => {
    const aGp = isGpTitle(a.AGNT_TITL_TX) ? 1 : 0
    const bGp = isGpTitle(b.AGNT_TITL_TX) ? 1 : 0
    if (aGp !== bGp) return bGp - aGp
    return titleRank(b.AGNT_TITL_TX) - titleRank(a.AGNT_TITL_TX)
  })
  for (const officer of officers) {
    const raw = String(officer.AGNT_NM ?? '').trim()
    if (!raw || !isBusinessOwner(raw)) continue
    const key = entitySeenKey(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)
    rows.push({ name: raw, title: officer.AGNT_TITL_TX ?? null })
  }
  return rows
}

function personKey(person: Pick<EntityPerson, 'firstName' | 'lastName'>): string {
  return `${person.firstName}|${person.lastName}`.toUpperCase()
}

function withTitlePrefix(person: EntityPerson, prefix: string | null): EntityPerson {
  if (!prefix) return person
  const title = person.title ? `${prefix}>${person.title}` : prefix
  return { ...person, title }
}

async function fetchFtasDetail(taxpayerId: string): Promise<FtasDetail | null> {
  const payload = await ftasGet(`${TX_FTAS_BASE}/${encodeURIComponent(taxpayerId)}`)
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as { data?: FtasDetail }).data
  return data ?? null
}

async function searchFtas(query: string): Promise<FtasSearchRow[]> {
  const payload = await ftasGet(`${TX_FTAS_BASE}?name=${encodeURIComponent(query)}`)
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: FtasSearchRow[] }).data
  return Array.isArray(data) ? data : []
}

export async function findFtasDetail(
  ownerName: string,
  zip?: string | null,
  extraQueries: string[] = [],
): Promise<FtasDetail | null> {
  const queries = [...entitySearchQueries(ownerName), ...extraQueries]
  if (queries.length === 0) return null
  for (const query of queries) {
    const rows = await searchFtas(query)
    const match = pickBestFtasMatch(query, rows, zip ?? undefined)
    if (!match?.taxpayerId) continue
    const detail = await fetchFtasDetail(match.taxpayerId)
    if (detail) return detail
  }
  return null
}

export type LookupEntityPeopleOptions = {
  zip?: string | null
  depth?: number
  maxPeople?: number
  maxDepth?: number
  seen?: Set<string>
}

export type UnwrapFtasPeopleOptions = LookupEntityPeopleOptions & {
  titlePrefix?: string | null
  lookup: (name: string, zip?: string | null) => Promise<FtasDetail | null>
}

export const MAX_TX_ENTITY_DEPTH = 3

/**
 * Walk officers / RA on a franchise-tax record and, when the GP (or other
 * officer) is another TX entity, recurse until we have people to skip-trace.
 * Depth 3 covers LP → GP LLC → GP LLC → person (Blue Sky-style stacks).
 */
export async function unwrapFtasPeople(
  detail: FtasDetail,
  options: UnwrapFtasPeopleOptions,
): Promise<EntityPerson[]> {
  const maxPeople = options.maxPeople ?? 6
  const depth = options.depth ?? 0
  const maxDepth = options.maxDepth ?? MAX_TX_ENTITY_DEPTH
  const seen = options.seen ?? new Set<string>()
  const titlePrefix = options.titlePrefix ?? null
  const remember = (name: string | null | undefined) => {
    const key = entitySeenKey(name)
    if (key) seen.add(key)
  }
  remember(detail.name)
  if (detail.taxpayerId) seen.add(`tid:${detail.taxpayerId}`)

  const people: EntityPerson[] = []
  const pushPerson = (person: EntityPerson) => {
    const prefixed = withTitlePrefix(person, titlePrefix)
    if (people.some((row) => personKey(row) === personKey(prefixed))) return
    people.push(prefixed)
  }
  for (const person of peopleFromFtasDetail(detail)) pushPerson(person)

  if (people.length >= maxPeople || depth >= maxDepth) {
    return people.slice(0, maxPeople)
  }

  const corps = corporateOfficersToRecurse(detail)
  const lookupNames: Array<{ name: string; title: string | null; zip?: string | null }> = corps.map((row) => ({
    ...row,
    zip: options.zip,
  }))
  if (
    lookupNames.length === 0 &&
    people.length === 0 &&
    looksLikeLimitedPartnership(detail.name)
  ) {
    for (const query of gpSearchQueries(detail.name)) {
      lookupNames.push({ name: query, title: 'GP', zip: options.zip })
    }
  }

  for (const corp of lookupNames) {
    if (people.length >= maxPeople) break
    const key = entitySeenKey(corp.name)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    const child = await options.lookup(corp.name, corp.zip)
    if (!child) continue
    const childTid = child.taxpayerId ? `tid:${child.taxpayerId}` : ''
    if (childTid && seen.has(childTid)) continue
    if (childTid) seen.add(childTid)
    const hopPrefix = isGpTitle(corp.title) || corp.title === 'GP' ? 'GP' : (corp.title || 'ENTITY')
    const nested = await unwrapFtasPeople(child, {
      ...options,
      depth: depth + 1,
      maxPeople: maxPeople - people.length,
      seen,
      titlePrefix: titlePrefix ? `${titlePrefix}>${hopPrefix}` : hopPrefix,
    })
    for (const person of nested) pushPerson(person)
  }

  return people.slice(0, maxPeople)
}

/**
 * Search TX franchise-tax records for `ownerName` and return people we can
 * skip-trace (officers / RA). Recurses GP / officer LLCs a few hops.
 */
export async function lookupTxEntityPeople(
  ownerName: string,
  options: LookupEntityPeopleOptions = {},
): Promise<EntityPerson[]> {
  const seen = options.seen ?? new Set<string>()
  const key = entitySeenKey(ownerName)
  if (key) seen.add(key)
  const extra =
    looksLikeLimitedPartnership(ownerName) ? gpSearchQueries(ownerName) : []
  const detail = await findFtasDetail(ownerName, options.zip, extra)
  if (!detail) return []
  return unwrapFtasPeople(detail, {
    ...options,
    seen,
    lookup: (name, zip) => findFtasDetail(name, zip),
  })
}
