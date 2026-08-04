/**
 * CAD operator filter helpers.
 *
 * Source of truth is tax-roll / mineral ownership `operator_name`
 * (and tract `top_operator`). No Energy Domain dependency.
 */

export function normalizeOperator(raw: string | null | undefined): string {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Loose contains match so "DIAMONDBACK" hits "DIAMONDBACK E&P LLC". */
export function operatorMatches(
  candidate: string | null | undefined,
  filter: string | null | undefined,
): boolean {
  const f = normalizeOperator(filter)
  if (!f) return false
  const c = normalizeOperator(candidate)
  if (!c) return false
  return c.includes(f) || f.includes(c)
}

export function bareAbstract(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/^A-\s*/i, '')
    .toUpperCase()
}

export type OperatorOption = {
  label: string
  count: number
}

/**
 * Build distinct operator options from CAD ownership on loaded tracts.
 * Prefers the most common display spelling for each normalized key.
 */
export function collectOperatorOptions(
  tracts: Array<{
    top_operator?: string | null
    owners_json?: string | unknown
  }>,
  parseOwners: (raw: unknown) => Array<{ operator_name?: string | null }>,
): OperatorOption[] {
  const byKey = new Map<string, { label: string; count: number }>()

  const bump = (raw: string | null | undefined) => {
    const label = String(raw || '').trim()
    const key = normalizeOperator(label)
    if (!key || key === 'UNKNOWN' || key === 'OTHER') return
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { label, count: 1 })
      return
    }
    prev.count += 1
    // Prefer longer/more complete label as display.
    if (label.length > prev.label.length) prev.label = label
  }

  for (const tract of tracts) {
    bump(tract.top_operator)
    for (const owner of parseOwners(tract.owners_json)) {
      bump(owner.operator_name)
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** Abstracts (label + bare) where any CAD owner operator matches the filter. */
export function abstractsMatchingOperator(
  tracts: Array<{
    abstract_label?: string | null
    top_operator?: string | null
    owners_json?: string | unknown
  }>,
  filter: string | null | undefined,
  parseOwners: (raw: unknown) => Array<{ operator_name?: string | null }>,
): string[] {
  if (!filter?.trim()) return []
  const out = new Set<string>()

  for (const tract of tracts) {
    const abstract = String(tract.abstract_label || '').trim()
    if (!abstract) continue

    let hit = operatorMatches(tract.top_operator, filter)
    if (!hit) {
      for (const owner of parseOwners(tract.owners_json)) {
        if (operatorMatches(owner.operator_name, filter)) {
          hit = true
          break
        }
      }
    }
    if (!hit) continue

    out.add(abstract)
    const bare = bareAbstract(abstract)
    if (bare) {
      out.add(bare)
      out.add(`A-${bare}`)
    }
  }

  return Array.from(out)
}
