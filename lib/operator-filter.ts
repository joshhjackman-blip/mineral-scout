/**
 * CAD operator filter helpers.
 *
 * Source of truth is tax-roll / mineral ownership `operator_name`
 * (and tract `top_operator`). No Energy Domain dependency.
 */

/** Trailing legal / entity tokens (incl. CAD truncations). */
const TRAILING_JUNK = new Set([
  'LLC',
  'LL',
  'L',
  'INC',
  'INCORPORATED',
  'CORP',
  'CORPORATION',
  'COR',
  'CO',
  'COMPANY',
  'COMPANIES',
  'COMPAN',
  'COMP',
  'LP',
  'LTD',
  'LIMITED',
  'PLLC',
  'PC',
  'USA',
  'US',
  'THE',
  'OPERATING',
  'OPERATOR',
  'OPERATORS',
  'OPERATION',
  'OPERATIONS',
  'OPERATIN',
  'OPERATI',
  'OPERAT',
  'OPER',
  'OPR',
  'OP',
  'OPS',
  'OPCO',
  'HOLDINGS',
  'HOLDING',
  'HOLDIN',
  'HOLDI',
  'GROUP',
  'GRP',
])

/** Trailing business descriptors stripped only when ≥1 distinctive token remains. */
const TRAILING_SOFT = new Set([
  'ENERGY',
  'ENERG',
  'RESOURCES',
  'RESOURCE',
  'RESOURC',
  'RESOUR',
  'RES',
  'PETROLEUM',
  'PETROLEU',
  'PETROL',
  'PETRO',
  'PET',
  'PRODUCTION',
  'PRODUCING',
  'PRODUC',
  'EXPLORATION',
  'EXPLORATIO',
  'EXPLORATI',
  'EXPLOR',
  'EXPL',
  'MANAGEMENT',
  'MANAGEMEN',
  'MANAGE',
  'MANA',
  'SERVICES',
  'SERVICE',
  'SERV',
  'PARTNERS',
  'PARTNER',
  'PARTNERSHIP',
  'NATURAL',
  'NAT',
])

/** Trailing two-token industry pairs (E&P, O&G, …). */
const TRAILING_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['E', 'P'],
  ['B', 'P'],
  ['E', 'O'],
  ['O', 'G'],
  ['E', 'PES'], // CAD junk: E&PES
]

export function normalizeOperator(raw: string | null | undefined): string {
  return String(raw || '')
    .toUpperCase()
    .replace(/&/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Collapse spelling variants to a stable root so
 * "EXTEX OPERATING COMP" and "EXTEX OPERATORS" share one option.
 */
export function operatorRoot(raw: string | null | undefined): string {
  const normalized = normalizeOperator(raw)
  if (!normalized) return ''

  const tokens = normalized.split(' ')

  const stripOnce = (): boolean => {
    if (tokens.length <= 1) return false
    const last = tokens[tokens.length - 1]
    if (TRAILING_JUNK.has(last)) {
      tokens.pop()
      return true
    }
    if (tokens.length >= 2) {
      const a = tokens[tokens.length - 2]
      const b = tokens[tokens.length - 1]
      for (const [x, y] of TRAILING_PAIRS) {
        if (a === x && b === y) {
          tokens.pop()
          tokens.pop()
          return true
        }
      }
    }
    // Soft descriptors only when a distinctive head token remains.
    if (tokens.length >= 2 && TRAILING_SOFT.has(last) && tokens[0].length >= 4) {
      tokens.pop()
      return true
    }
    return false
  }

  while (stripOnce()) {
    /* keep stripping */
  }

  return tokens.join(' ').trim()
}

/** True when candidate belongs to the same operator family as filter. */
export function operatorMatches(
  candidate: string | null | undefined,
  filter: string | null | undefined,
): boolean {
  const fRoot = operatorRoot(filter)
  if (!fRoot) return false
  const cRoot = operatorRoot(candidate)
  if (!cRoot) return false
  if (cRoot === fRoot) return true
  // Partial toolbar typing / truncated CAD rows.
  if (fRoot.length >= 4 && (cRoot.startsWith(fRoot) || fRoot.startsWith(cRoot))) {
    return true
  }
  const cNorm = normalizeOperator(candidate)
  const fNorm = normalizeOperator(filter)
  return cNorm.includes(fNorm) || fNorm.includes(cNorm)
}

export function operatorMatchesAny(
  candidate: string | null | undefined,
  filters: ReadonlyArray<string> | null | undefined,
): boolean {
  if (!filters || filters.length === 0) return false
  return filters.some((f) => operatorMatches(candidate, f))
}

export function bareAbstract(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/^A-\s*/i, '')
    .toUpperCase()
}

export type OperatorOption = {
  /** Stable cluster key (operator root). */
  key: string
  /** Best display spelling for the cluster. */
  label: string
  /** Combined occurrence count across aliases. */
  count: number
  /** Distinct raw CAD spellings merged into this option. */
  aliases: string[]
}

function preferLabel(current: string, next: string, nextCount: number, currentCount: number): string {
  // Prefer higher-count spelling; tie-break longer (less truncated), then A-Z.
  if (nextCount !== currentCount) return nextCount > currentCount ? next : current
  if (next.length !== current.length) return next.length > current.length ? next : current
  return next.localeCompare(current) < 0 ? next : current
}

/** Merge roots where one is a prefix/truncation of the other (A-Z pass). */
function mergeRootKeys(roots: string[]): Map<string, string> {
  const sorted = Array.from(new Set(roots.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  )
  // parent[root] = canonical root after merges
  const parent = new Map<string, string>()
  for (const r of sorted) parent.set(r, r)

  const find = (r: string): string => {
    let cur = r
    while (parent.get(cur) !== cur) cur = parent.get(cur) as string
    return cur
  }
  const union = (a: string, b: string) => {
    const pa = find(a)
    const pb = find(b)
    if (pa === pb) return
    // Prefer shorter root as canonical ("DIAMONDBACK" over "DIAMONDBACK B P")
    const canon = pa.length <= pb.length ? pa : pb
    const other = canon === pa ? pb : pa
    parent.set(other, canon)
  }

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]
      const b = sorted[j]
      // Once b no longer shares a's prefix, later entries won't either (sorted).
      if (!b.startsWith(a.slice(0, Math.min(a.length, 4)))) break
      const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
      if (shorter.length < 4) continue
      if (longer === shorter) {
        union(a, b)
        continue
      }
      if (longer.startsWith(shorter + ' ')) {
        union(a, b)
        continue
      }
      // Truncation: "CALLON PET" vs "CALLON PETRO"
      if (longer.startsWith(shorter) && shorter.length >= 8) {
        union(a, b)
      }
    }
  }

  const out = new Map<string, string>()
  for (const r of sorted) out.set(r, find(r))
  return out
}

/**
 * Build distinct operator options from CAD ownership on loaded tracts.
 * Sorts A-Z and merges spelling / truncation duplicates into one option.
 */
export function collectOperatorOptions(
  tracts: Array<{
    top_operator?: string | null
    owners_json?: string | unknown
  }>,
  parseOwners: (raw: unknown) => Array<{ operator_name?: string | null }>,
): OperatorOption[] {
  type AliasAgg = { label: string; count: number }
  const byRaw = new Map<string, AliasAgg>()

  const bump = (raw: string | null | undefined) => {
    const label = String(raw || '').trim()
    const key = normalizeOperator(label)
    if (!key || key === 'UNKNOWN' || key === 'OTHER') return
    const prev = byRaw.get(key)
    if (!prev) {
      byRaw.set(key, { label, count: 1 })
      return
    }
    prev.count += 1
    if (label.length > prev.label.length) prev.label = label
  }

  for (const tract of tracts) {
    bump(tract.top_operator)
    for (const owner of parseOwners(tract.owners_json)) {
      bump(owner.operator_name)
    }
  }

  // First collapse each raw name to a root, then merge near-duplicate roots.
  const rootByRaw = new Map<string, string>()
  const initialRoots: string[] = []
  Array.from(byRaw.keys()).forEach((norm) => {
    const root = operatorRoot(norm)
    if (!root) return
    rootByRaw.set(norm, root)
    initialRoots.push(root)
  })
  const canonByRoot = mergeRootKeys(initialRoots)

  type Cluster = {
    key: string
    label: string
    labelCount: number
    count: number
    aliases: string[]
  }
  const clusters = new Map<string, Cluster>()

  Array.from(byRaw.entries()).forEach(([norm, agg]) => {
    const root = rootByRaw.get(norm)
    if (!root) return
    const key = canonByRoot.get(root) || root
    const prev = clusters.get(key)
    if (!prev) {
      clusters.set(key, {
        key,
        label: agg.label,
        labelCount: agg.count,
        count: agg.count,
        aliases: [agg.label],
      })
      return
    }
    prev.count += agg.count
    prev.aliases.push(agg.label)
    const nextLabel = preferLabel(prev.label, agg.label, agg.count, prev.labelCount)
    if (nextLabel !== prev.label) {
      prev.label = nextLabel
      prev.labelCount = agg.count
    }
  })

  return Array.from(clusters.values())
    .map((c) => ({
      key: c.key,
      label: c.label,
      count: c.count,
      aliases: Array.from(new Set(c.aliases)).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Abstracts (label + bare) where any CAD owner operator matches any selected filter. */
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
  return abstractsMatchingOperators(tracts, [filter], parseOwners)
}

export function abstractsMatchingOperators(
  tracts: Array<{
    abstract_label?: string | null
    top_operator?: string | null
    owners_json?: string | unknown
  }>,
  filters: ReadonlyArray<string> | null | undefined,
  parseOwners: (raw: unknown) => Array<{ operator_name?: string | null }>,
): string[] {
  const active = (filters || []).map((f) => f.trim()).filter(Boolean)
  if (active.length === 0) return []
  const out = new Set<string>()

  for (const tract of tracts) {
    const abstract = String(tract.abstract_label || '').trim()
    if (!abstract) continue

    let hit = operatorMatchesAny(tract.top_operator, active)
    if (!hit) {
      for (const owner of parseOwners(tract.owners_json)) {
        if (operatorMatchesAny(owner.operator_name, active)) {
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
