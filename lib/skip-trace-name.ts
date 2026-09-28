/**
 * Tax-roll owner names are LAST FIRST MIDDLE plus fiduciary / entity tags
 * ("FOSTER MICHAEL DAVID LVG TR", "BROWN ROYALTIES INC"). The live skip-trace
 * UI only sends the second token as firstName, so middle names and trustee
 * tags get dropped and Accurate Append treats many trusts as businesses.
 *
 * These helpers unwrap a roll name into skip-trace first/last candidates
 * without scraping people-search sites.
 */

const TOKEN_RE = /[A-Za-z0-9]+/g

const FIDUCIARY_TOKENS = new Set([
  'TR',
  'TRS',
  'TRST',
  'TRSTE',
  'TRSTEE',
  'TTEE',
  'TTEES',
  'TRUSTEE',
  'TRUSTEES',
  'TRUST',
  'TST',
  'LVG',
  'LIVING',
  'REV',
  'REVOCABLE',
  'IRREV',
  'IRREVOCABLE',
  'FAM',
  'FAMILY',
  'FBO',
  'UWO',
  'UAD',
  'DTD',
  'DATED',
  'LIFE',
  'EST',
  'ESTATE',
])

/** Marital / tenancy tags on an individual — strip, but still a person. */
const PERSON_TAG_TOKENS = new Set([
  'SNP',
  'SEP',
  'SEPARATE',
  'JTWROS',
  'TIC',
  'JT',
  'TEN',
  'TENANT',
  'TENANTS',
  'ET',
  'AL',
  'UX',
  'VIR',
  'SPL',
  'NDS',
])

const NAME_SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'VI', 'MD', 'DDS', 'PHD', 'ESQ'])

const FILLER_TOKENS = new Set(['AND', 'THE', 'OF', 'A', 'AN', 'DBA'])

/** Tokens that mean this is a company, not a person or family trust. */
const BUSINESS_TOKENS = new Set([
  'LLC',
  'LLP',
  'LP',
  'PLLC',
  'INC',
  'INCORPORATED',
  'CORP',
  'CORPORATION',
  'COMPANY',
  'CO',
  'LTD',
  'LIMITED',
  'PARTNERSHIP',
  'HOLDINGS',
  'ROYALTY',
  'ROYALTIES',
  'MINERALS',
  'ENERGY',
  'OPERATING',
  'FUND',
  'BANK',
  'CHURCH',
  'FOUNDATION',
  'RESOURCES',
  'PRODUCTION',
  'PETROLEUM',
  'EXPLORATION',
  'VENTURES',
  'ENTERPRISES',
  'ENTERPRISE',
  'ASSOCIATION',
  'ASSN',
  'INVESTMENTS',
  'INVESTMENT',
  'MANAGEMENT',
  'PARTNERS',
  'PC',
  'PA',
  'BIBLE',
  'SOCIETY',
  'UNIVERSITY',
  'HOSPITAL',
  'DISTRICT',
  'AUTHORITY',
  'PROPERTIES',
])

const LEGAL_SUFFIX_TOKENS = new Set([
  'LLC',
  'LLP',
  'LP',
  'PLLC',
  'INC',
  'INCORPORATED',
  'CORP',
  'CORPORATION',
  'COMPANY',
  'CO',
  'LTD',
  'LIMITED',
  'PARTNERSHIP',
  'PC',
  'PA',
])

const SOFT_BUSINESS_TOKENS = new Set([
  'GROUP',
  'INTERESTS',
  'MINERAL',
  'OIL',
  'GAS',
  'VENTURE',
  'TRACT',
  'TOWER',
])

export type OwnerKind = 'person' | 'trust' | 'business'

export type ParsedTaxRollOwner = {
  kind: OwnerKind
  original: string
  lastName: string | null
  givenNames: string[]
  firstName: string | null
  suffixes: string[]
}

export type PersonTraceCandidate = {
  firstName: string
  lastName: string
  label: string
}

export function tokenizeOwnerName(value: string | null | undefined): string[] {
  return String(value ?? '')
    .toUpperCase()
    .match(TOKEN_RE) ?? []
}

export function normalizeZip(zip: string | null | undefined): string {
  const digits = String(zip ?? '').replace(/\D/g, '')
  if (digits.length >= 5) return digits.slice(0, 5)
  return String(zip ?? '').trim()
}

export function isBusinessOwner(
  ownerName?: string | null,
  firstName?: string | null,
  lastName?: string | null,
): boolean {
  const tokens = tokenizeOwnerName(`${ownerName ?? ''} ${firstName ?? ''} ${lastName ?? ''}`)
  if (tokens.some((token) => BUSINESS_TOKENS.has(token))) return true
  const soft = tokens.filter((token) => SOFT_BUSINESS_TOKENS.has(token))
  if (soft.length >= 2) return true
  if (tokens.includes('OIL') && tokens.includes('GAS')) return true
  return false
}

function classifyTokens(tokens: string[]): OwnerKind {
  if (isBusinessOwner(tokens.join(' '))) return 'business'
  if (tokens.some((token) => FIDUCIARY_TOKENS.has(token))) return 'trust'
  return 'person'
}

export function parseTaxRollOwner(ownerName: string | null | undefined): ParsedTaxRollOwner {
  const original = String(ownerName ?? '').trim()
  const tokens = tokenizeOwnerName(original)
  const kind = classifyTokens(tokens)
  const suffixes = tokens.filter((token) => NAME_SUFFIXES.has(token))
  const meaningful = tokens.filter(
    (token) =>
      !FIDUCIARY_TOKENS.has(token) &&
      !PERSON_TAG_TOKENS.has(token) &&
      !NAME_SUFFIXES.has(token) &&
      !FILLER_TOKENS.has(token),
  )

  if (kind === 'business') {
    return {
      kind,
      original,
      lastName: null,
      givenNames: [],
      firstName: null,
      suffixes,
    }
  }

  const lastName = meaningful[0] ?? null
  const givenNames = meaningful.slice(1)
  return {
    kind,
    original,
    lastName,
    givenNames,
    firstName: givenNames.length > 0 ? givenNames.join(' ') : null,
    suffixes,
  }
}

/**
 * Person skip-trace attempts derived from a tax-roll name.
 * Full given names first (the live UI currently drops middle names), then
 * first-token-only as a fallback.
 */
export function personCandidatesFromTaxRoll(
  ownerName: string | null | undefined,
): PersonTraceCandidate[] {
  const parsed = parseTaxRollOwner(ownerName)
  if (parsed.kind === 'business' || !parsed.lastName || parsed.givenNames.length === 0) {
    return []
  }
  const out: PersonTraceCandidate[] = []
  const seen = new Set<string>()
  const push = (firstName: string, lastName: string, label: string) => {
    const first = firstName.trim()
    const last = lastName.trim()
    if (!first || !last) return
    const key = `${first.toUpperCase()}|${last.toUpperCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ firstName: first, lastName: last, label })
  }

  push(parsed.givenNames.join(' '), parsed.lastName, 'tax-roll-full')
  if (parsed.givenNames.length > 1) {
    push(parsed.givenNames[0], parsed.lastName, 'tax-roll-first')
  }
  return out
}

/** Officer / registered-agent names from SOS/Comptroller are FIRST MIDDLE LAST. */
export function parseWesternPersonName(
  name: string | null | undefined,
): PersonTraceCandidate | null {
  const raw = String(name ?? '').trim()
  if (!raw) return null
  if (isBusinessOwner(raw)) return null
  const tokens = tokenizeOwnerName(raw).filter(
    (token) =>
      !FILLER_TOKENS.has(token) &&
      !FIDUCIARY_TOKENS.has(token) &&
      !PERSON_TAG_TOKENS.has(token),
  )
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop()
  }
  if (tokens.length < 2) return null
  const lastName = tokens[tokens.length - 1]
  const firstName = tokens.slice(0, -1).join(' ')
  if (!firstName || !lastName) return null
  return { firstName, lastName, label: 'officer' }
}

export type TraceNameArgs = {
  firstName?: string
  lastName?: string
  ownerName?: string
  address?: string
  city?: string
  state?: string
  zip?: string
}

/**
 * Upgrade a live skip-trace payload when the UI sent only the second tax-roll
 * token as firstName (dropping middle names / initials).
 */
export function enrichPersonTraceArgs<T extends TraceNameArgs>(args: T): T {
  const zip = normalizeZip(args.zip)
  const parsed = parseTaxRollOwner(args.ownerName)
  if (parsed.kind === 'business' || !parsed.lastName || parsed.givenNames.length === 0) {
    return zip === args.zip ? args : { ...args, zip }
  }
  const incomingFirst = String(args.firstName ?? '').trim().toUpperCase()
  const fullGiven = parsed.givenNames.join(' ')
  const shouldUpgrade =
    !incomingFirst ||
    incomingFirst === parsed.givenNames[0] ||
    incomingFirst === parsed.givenNames.join(' ')
  if (!shouldUpgrade) {
    return zip === args.zip ? args : { ...args, zip }
  }
  return {
    ...args,
    firstName: fullGiven,
    lastName: parsed.lastName,
    zip,
  }
}

export function entitySearchQueries(ownerName: string | null | undefined): string[] {
  const tokens = tokenizeOwnerName(ownerName).filter((token) => token !== 'DBA')
  const withoutEntitySuffix = [...tokens]
  while (
    withoutEntitySuffix.length > 1 &&
    (LEGAL_SUFFIX_TOKENS.has(withoutEntitySuffix[withoutEntitySuffix.length - 1]) ||
      FIDUCIARY_TOKENS.has(withoutEntitySuffix[withoutEntitySuffix.length - 1]) ||
      PERSON_TAG_TOKENS.has(withoutEntitySuffix[withoutEntitySuffix.length - 1]))
  ) {
    withoutEntitySuffix.pop()
  }
  const queries: string[] = []
  const push = (parts: string[]) => {
    const q = parts.join(' ').trim()
    if (q.length >= 2 && q.length <= 50 && !queries.includes(q)) queries.push(q)
  }
  push(withoutEntitySuffix)
  if (tokens.length >= 2) push(tokens.slice(0, 3))
  return queries
}

export function scoreEntityNameMatch(query: string, resultName: string): number {
  const drop = (token: string) =>
    LEGAL_SUFFIX_TOKENS.has(token) || FILLER_TOKENS.has(token)
  const qTokens = tokenizeOwnerName(query).filter((token) => !drop(token))
  const rTokens = tokenizeOwnerName(resultName).filter((token) => !drop(token))
  if (qTokens.length === 0 || rTokens.length === 0) return 0
  const qJoined = qTokens.join(' ')
  const rJoined = rTokens.join(' ')
  if (qJoined === rJoined) return 100
  if (rJoined.startsWith(qJoined) || qJoined.startsWith(rJoined)) return 80
  const overlap = qTokens.filter((token) => rTokens.includes(token)).length
  if (overlap === 0) return 0
  if (overlap === qTokens.length) return 70 + Math.min(10, overlap)
  return overlap * 15
}
