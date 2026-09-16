// Two-section horizontals (MARION WEST 36-25 F) name both sections.
// When the clicked tract has no CAD owners, the royalty book is usually
// on the other section in the same block / township.

export function normalizeSection(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/^0+/, '')
}

export function parseGridKey(abstract: string): {
  block: string
  township: string
  section: string
} | null {
  const m = String(abstract ?? '')
    .trim()
    .toUpperCase()
    .match(/^B([A-Z0-9]+)-(T\d+[NS])-S(\d+[A-Z]?)$/)
  if (!m) return null
  return { block: m[1], township: m[2], section: normalizeSection(m[3]) }
}

export function blockVariants(block: string | null | undefined): string[] {
  const raw = String(block ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (!raw) return []
  const township = raw.match(/T\d+[NS]/)?.[0] ?? ''
  const num = raw.replace(/T\d+[NS]/, '').replace(/-/g, ' ').trim().split(/\s+/)[0] ?? ''
  const out = new Set<string>()
  if (raw) out.add(raw)
  if (num && township) {
    out.add(`${num} ${township}`)
    out.add(`${num}-${township}`)
  }
  if (num) out.add(num)
  return Array.from(out)
}

export function sameBlockTownship(a: string | null | undefined, b: string | null | undefined): boolean {
  const aRaw = String(a ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  const bRaw = String(b ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (!aRaw || !bRaw) return false
  const aTwn = aRaw.match(/T\d+[NS]/)?.[0] ?? ''
  const bTwn = bRaw.match(/T\d+[NS]/)?.[0] ?? ''
  if (aTwn && bTwn && aTwn !== bTwn) return false
  const av = blockVariants(aRaw)
  const bv = blockVariants(bRaw)
  return av.some((v) => bv.includes(v))
}

/** Other section number from a lease like "MARION WEST 36-25 F". */
export function pairedSectionFromLease(lease: string, homeSection: string): string | null {
  const home = normalizeSection(homeSection)
  if (!home) return null
  const text = String(lease ?? '').toUpperCase()
  const re = /\b(\d{1,2})\s*[-/]\s*(\d{1,2})\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const a = normalizeSection(match[1])
    const b = normalizeSection(match[2])
    if (a === home && b && b !== home) return b
    if (b === home && a && a !== home) return a
  }
  return null
}

export function pairedSectionsFromLeases(leases: string[], homeSection: string): string[] {
  const found = new Set<string>()
  for (const lease of leases) {
    const other = pairedSectionFromLease(lease, homeSection)
    if (other) found.add(other)
  }
  return Array.from(found)
}
