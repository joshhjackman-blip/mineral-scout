/**
 * Owner-name search helpers for tax-roll names.
 *
 * County rolls store people as LAST FIRST MIDDLE (e.g. "ADAMS JOSEPHINE LUCILLE").
 * Users type first-last ("Josephine Adams") or mixed order. Matching is token
 * based (all words, any order) so either form hits. Scoring prefers an exact
 * last-first reconstruction so the right owner ranks at the top.
 */

const TOKEN_RE = /[A-Za-z0-9]+/g

/** Filler tokens that show up in tax-roll names but users rarely type. */
const SKIP_TOKENS = new Set([
  'AND',
  'ET',
  'AL',
  'UX',
  'THE',
  'OF',
  'A',
  'AN',
])

export function tokenizeName(value: string): string[] {
  const raw = String(value ?? '').toUpperCase().match(TOKEN_RE) ?? []
  return raw.filter((token) => token.length > 1 && !SKIP_TOKENS.has(token))
}

export function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&')
}

/** True when every query token appears in the haystack, in any order. */
export function nameMatchesQuery(haystack: string, query: string): boolean {
  const qTokens = tokenizeName(query)
  if (qTokens.length === 0) return false
  const hTokens = tokenizeName(haystack)
  if (hTokens.length === 0) {
    const blob = String(haystack ?? '').toUpperCase()
    return qTokens.every((token) => blob.includes(token))
  }
  return qTokens.every((token) => hTokens.some((hay) => hay.includes(token)))
}

/**
 * Higher is a better match. Last-first tax-roll order ("ADAMS JOSEPHINE")
 * scores just under an exact first-last / last-first string match so
 * "Josephine Adams" surfaces "ADAMS JOSEPHINE LUCILLE" ahead of other
 * Adams / Josephine rows.
 */
export function nameMatchScore(ownerName: string, query: string): number {
  const qTokens = tokenizeName(query)
  const nTokens = tokenizeName(ownerName)
  if (qTokens.length === 0) return 0
  if (!nameMatchesQuery(ownerName, query)) return 0

  const qJoined = qTokens.join(' ')
  const nJoined = nTokens.join(' ')

  // Tax-roll LAST FIRST: "Josephine Adams" → "ADAMS JOSEPHINE LUCILLE"
  const lastFirstSwap =
    qTokens.length >= 2 &&
    nTokens.length >= 2 &&
    nTokens[0] === qTokens[qTokens.length - 1] &&
    nTokens[1] === qTokens[0]
  if (lastFirstSwap) return 9_500 - nTokens.length

  if (nJoined === qJoined) return 10_000
  if (nJoined.startsWith(qJoined)) return 9_000

  const exactWords = qTokens.filter((token) => nTokens.includes(token)).length
  const prefixWords = qTokens.filter((token) =>
    nTokens.some((hay) => hay.startsWith(token)),
  ).length
  return 1_000 + exactWords * 120 + prefixWords * 40 - nTokens.length
}

export function compareNameMatches(
  aName: string,
  bName: string,
  query: string,
): number {
  const delta = nameMatchScore(bName, query) - nameMatchScore(aName, query)
  if (delta !== 0) return delta
  return String(aName ?? '').localeCompare(String(bName ?? ''))
}
