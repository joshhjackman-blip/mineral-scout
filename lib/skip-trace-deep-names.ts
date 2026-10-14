import {
  parseTaxRollOwner,
  tokenizeOwnerName,
  type PersonTraceCandidate,
} from '@/lib/skip-trace-name'

/** Cheap given-name repairs. Only exact token swaps — no guessing. */
const GIVEN_REPAIRS: Record<string, string[]> = {
  MATHEW: ['MATTHEW'],
  MATT: ['MATTHEW'],
  CAROLING: ['CAROLINE'],
  CAROLYN: ['CAROLINE'],
  BOB: ['ROBERT'],
  BOBBY: ['ROBERT'],
  BILL: ['WILLIAM'],
  BILLY: ['WILLIAM'],
  JIM: ['JAMES'],
  JIMMY: ['JAMES'],
  MIKE: ['MICHAEL'],
  MICKEY: ['MICHAEL'],
  LIZ: ['ELIZABETH'],
  BETTY: ['ELIZABETH'],
  JEANETTE: ['JEANNETTE'],
  JEANNETTE: ['JEANETTE'],
  STEPHEN: ['STEVEN'],
  STEVEN: ['STEPHEN'],
  ERIC: ['ERICK'],
  ERICK: ['ERIC'],
}

const COMMON_GIVEN = new Set([
  'MARY', 'MARIE', 'MARIA', 'ANN', 'ANNE', 'ANNA', 'ELIZABETH', 'ELISABETH',
  'JANE', 'JEAN', 'JEANNE', 'JOHN', 'JAMES', 'ROBERT', 'WILLIAM', 'MICHAEL',
  'DAVID', 'RICHARD', 'THOMAS', 'CHARLES', 'JOSEPH', 'DANIEL', 'PAUL',
  'MARK', 'DONALD', 'GEORGE', 'KENNETH', 'STEVEN', 'STEPHEN', 'EDWARD',
  'BRIAN', 'RONALD', 'ANTHONY', 'KEVIN', 'JASON', 'MATTHEW', 'GARY',
  'TIMOTHY', 'JOSE', 'LARRY', 'JEFFREY', 'FRANK', 'SCOTT', 'ERIC',
  'ANDREW', 'RYAN', 'JUSTIN', 'AMANDA', 'REBECCA', 'SARAH', 'SARA',
  'LINDA', 'PATRICIA', 'JENNIFER', 'SUSAN', 'MARGARET', 'DOROTHY',
  'LISA', 'NANCY', 'KAREN', 'BETTY', 'HELEN', 'SANDRA', 'ASHLEY',
  'KIMBERLY', 'EMILY', 'DONNA', 'MICHELLE', 'CAROL', 'AMANDA', 'MELISSA',
  'DEBORAH', 'STEPHANIE', 'REBECCA', 'SHARON', 'LAURA', 'CYNTHIA',
  'KATHLEEN', 'AMY', 'ANGELA', 'SHIRLEY', 'ANNA', 'BRENDA', 'PAMELA',
  'EMMA', 'NICOLE', 'HEATHER', 'DIANE', 'RACHEL', 'CAROLYN', 'JANET',
  'CATHERINE', 'MARIA', 'FRANCES', 'CHRISTINE', 'SAMANTHA', 'DEBRA',
  'RACHEL', 'CAROLYN', 'JANET', 'CATHERINE', 'FRANCES', 'CHRISTINE',
  'JACQUELINE', 'LESLIE', 'JEANETTE', 'JEANNETTE', 'CAROLINE', 'CAROLING',
  'TOYA', 'BINIE', 'ELINOR',
])

const JUNK_TOKENS = new Set([
  'UNKNOWN',
  'UNK',
  'LSE',
  'LEASE',
  'NONE',
  'NULL',
  'N',
  'A',
])

export function identityKey(firstName: string, lastName: string): string {
  return `${firstName.trim().toUpperCase()}|${lastName.trim().toUpperCase()}`
}

export function parseDeepAttempts(notes: string | null | undefined): {
  attempts: number
  lastAt: number | null
  exhausted: boolean
} {
  let attempts = 0
  let lastAt: number | null = null
  let exhausted = false
  const text = String(notes ?? '')
  const re = /\[deep-research ([^\]]+) attempt=(\d+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    attempts = Math.max(attempts, Number(match[2]) || 0)
    const ts = Date.parse(match[1] ?? '')
    if (Number.isFinite(ts)) lastAt = lastAt == null ? ts : Math.max(lastAt, ts)
    if (/\bexhausted=1\b/.test(match[1] ?? '')) exhausted = true
  }
  if (/\bwill not retry\b/i.test(text) || /\bexhausted=1\b/.test(text)) exhausted = true
  return { attempts, lastAt, exhausted }
}

export function formatDeepMissNote(attempt: number, body: string, exhausted = false): string {
  const flag = exhausted ? ' exhausted=1' : ''
  return `[deep-research ${new Date().toISOString()} attempt=${attempt}${flag} hit=0] ${body}`
}

/** Names that will never yield a person for the phone APIs. */
export function isUntraceableOwner(ownerName: string | null | undefined): boolean {
  const raw = String(ownerName ?? '').trim()
  if (!raw) return true
  const upper = raw.toUpperCase()
  if (/^UNKNOWN\b/.test(upper)) return true
  const tokens = tokenizeOwnerName(upper).filter((token) => !JUNK_TOKENS.has(token) && !/^\d+$/.test(token))
  const real = tokens.filter((token) => token.length >= 2)
  if (real.length === 0) return true
  if (/\bLSE\s*\d+/.test(upper) && real.length <= 1) return true
  return false
}

export function isInitialsGivenName(given: string[]): boolean {
  if (given.length === 0) return false
  if (given.length === 1 && given[0].length <= 2) return true
  return given.every((token) => token.length === 1)
}

/**
 * Identities the fast researcher already sent to providers, parsed from notes.
 * Example: "tried tax-roll-full:MATHEW D DYER | tax-roll-first:MATHEW DYER"
 */
export function triedIdentityKeys(notes: string | null | undefined): Set<string> {
  const keys = new Set<string>()
  const text = String(notes ?? '')
  for (const chunk of text.split(/[|;]/)) {
    const colon = chunk.lastIndexOf(':')
    if (colon < 0) continue
    const person = chunk.slice(colon + 1).trim().toUpperCase()
    if (!person || /NO PHONE|NO PERSON|CACHE WRITE|EXHAUSTED/.test(person)) continue
    const tokens = person.match(/[A-Z]+/g) ?? []
    if (tokens.length < 2) continue
    const last = tokens[tokens.length - 1]
    const first = tokens.slice(0, -1).join(' ')
    if (!first || !last) continue
    keys.add(identityKey(first, last))
  }
  return keys
}

export function deterministicDeepCandidates(
  ownerName: string | null | undefined,
  notes?: string | null,
): PersonTraceCandidate[] {
  if (isUntraceableOwner(ownerName)) return []
  const parsed = parseTaxRollOwner(ownerName)
  if (parsed.kind === 'business' || !parsed.lastName || parsed.givenNames.length === 0) {
    return []
  }
  const tried = triedIdentityKeys(notes)
  const out: PersonTraceCandidate[] = []
  const seen = new Set<string>(tried)
  const push = (firstName: string, lastName: string, label: string) => {
    const first = firstName.trim().toUpperCase()
    const last = lastName.trim().toUpperCase()
    if (!first || !last) return
    if (isInitialsGivenName(first.split(/\s+/))) return
    const key = identityKey(first, last)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ firstName: first, lastName: last, label })
  }

  const given = parsed.givenNames
  const last = parsed.lastName

  for (let i = 0; i < given.length; i += 1) {
    const alts = GIVEN_REPAIRS[given[i]] ?? []
    for (const alt of alts) {
      const next = [...given]
      next[i] = alt
      push(next.join(' '), last, 'deep-spelling')
      push(alt, last, 'deep-spelling-first')
    }
  }

  const maiden = given[given.length - 1]
  const maidenLooksReal =
    maiden &&
    !COMMON_GIVEN.has(maiden) &&
    ((given.length >= 3 && maiden.length >= 3) ||
      (given.length === 2 && maiden.length >= 5))
  if (maidenLooksReal) {
    const rest = given.slice(0, -1)
    push(rest.join(' '), maiden, 'deep-maiden')
    push(rest[0], maiden, 'deep-maiden-first')
  }

  return out.slice(0, 3)
}
