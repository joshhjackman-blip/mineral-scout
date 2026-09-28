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

export function corporateOfficerNames(detail: FtasDetail): string[] {
  const names: string[] = []
  for (const officer of detail.officerInfo ?? []) {
    const raw = String(officer.AGNT_NM ?? '').trim()
    if (raw && isBusinessOwner(raw) && !names.includes(raw)) names.push(raw)
  }
  return names
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

export type LookupEntityPeopleOptions = {
  zip?: string | null
  depth?: number
  maxPeople?: number
}

/**
 * Search TX franchise-tax records for `ownerName` and return people we can
 * skip-trace (officers / RA). Recurses one level when the GP is another entity.
 */
export async function lookupTxEntityPeople(
  ownerName: string,
  options: LookupEntityPeopleOptions = {},
): Promise<EntityPerson[]> {
  const depth = options.depth ?? 0
  const maxPeople = options.maxPeople ?? 4
  const queries = entitySearchQueries(ownerName)
  if (queries.length === 0) return []

  let detail: FtasDetail | null = null
  for (const query of queries) {
    const rows = await searchFtas(query)
    const match = pickBestFtasMatch(query, rows, options.zip ?? undefined)
    if (!match?.taxpayerId) continue
    detail = await fetchFtasDetail(match.taxpayerId)
    if (detail) break
  }
  if (!detail) return []

  const people = peopleFromFtasDetail(detail)
  if (people.length < maxPeople && depth < 1) {
    for (const corpName of corporateOfficerNames(detail)) {
      const nested = await lookupTxEntityPeople(corpName, {
        zip: options.zip,
        depth: depth + 1,
        maxPeople: maxPeople - people.length,
      })
      for (const person of nested) {
        const key = `${person.firstName}|${person.lastName}`.toUpperCase()
        if (people.some((p) => `${p.firstName}|${p.lastName}`.toUpperCase() === key)) continue
        people.push(person)
        if (people.length >= maxPeople) break
      }
      if (people.length >= maxPeople) break
    }
  }

  return people.slice(0, maxPeople)
}
