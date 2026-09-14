/**
 * Tract acreage and interest math for Permian section-grid counties.
 *
 * A regular square T&P / PSL section is 640 acres. Aliquot calls
 * (N/2, SE/4, N/2SW/4, …) are fractions of that section. CAD rolls
 * often leave `acreage` at 0 on royalty lines, so the UI falls back
 * to this when the legal / grid tells us the tract size.
 *
 * Mineral-owner NRI (not working-interest NRI):
 *   NRI = mineral interest × lease royalty
 *   100% minerals on a 1/8 (12.5%) lease → 12.5% NRI
 * The lessee's NRI would be WI × (1 − royalty) = 87.5% at 1/8.
 * This product shows the mineral owner's royalty NRI.
 */

export const SECTION_ACRES = 640
export const DEFAULT_LEASE_ROYALTY = 0.125

export type AcreageSource = 'cad' | 'aliquot' | 'section' | 'shape'

export type GrossAcresEstimate = {
  acres: number | null
  source: AcreageSource | null
  estimated: boolean
}

const IRREGULAR_SURVEY =
  /\b(LEAGUE|LABOR|PORCION|PORCIÓN|LGE\b|SITIO|VARA)\b/i

const ALIQUOT_TOKEN =
  /(NE|NW|SE|SW|N|S|E|W)\s*\/?\s*(2|4|8|16)(?!\d)/gi

const GRID_CUTOFF =
  /\b(?:SEC(?:TION|T)?\.?|BLK|BLOCK|T\d+[NS]|A(?:B)?[-\s]?\d)/i

const STANDARD_ACRES = [640, 320, 160, 80, 40, 20, 10]

export function parseAliquotFraction(raw: string | null | undefined): number | null {
  const text = String(raw ?? '').trim()
  if (!text) return null

  const head = text.split(GRID_CUTOFF)[0] ?? ''
  if (!head.trim()) return null

  const groups = head.split(/\bAND\b|&/i)
  let sum = 0
  let found = false
  for (const group of groups) {
    const fraction = aliquotGroupFraction(group)
    if (fraction == null) continue
    sum += fraction
    found = true
  }
  return found ? sum : null
}

function aliquotGroupFraction(group: string): number | null {
  ALIQUOT_TOKEN.lastIndex = 0
  let product = 1
  let count = 0
  let match: RegExpExecArray | null
  while ((match = ALIQUOT_TOKEN.exec(group)) !== null) {
    const denom = Number(match[2])
    if (!Number.isFinite(denom) || denom <= 0) continue
    product *= 1 / denom
    count += 1
  }
  return count > 0 ? product : null
}

export function looksLikeRegularSection(input: {
  legal?: string | null
  survey?: string | null
  section?: string | null
  block?: string | null
  township?: string | null
}): boolean {
  const blob = [input.legal, input.survey, input.section, input.block, input.township]
    .filter(Boolean)
    .join(' ')
  if (!blob.trim()) return false
  if (IRREGULAR_SURVEY.test(blob)) return false

  const hasSection =
    Boolean(String(input.section ?? '').trim()) ||
    /\bSEC(?:TION|T)?\.?[:\s]*[0-9A-Z]+/i.test(blob)
  const hasBlock =
    Boolean(String(input.block ?? '').trim()) ||
    /\b(?:BLK|BLOCK)[:.\s]*[0-9A-Z]+/i.test(blob)
  const hasTownship =
    Boolean(String(input.township ?? '').trim()) ||
    /\bT\d+[NS]\b/i.test(blob)

  return hasSection && (hasBlock || hasTownship)
}

function snapToStandardAcres(acres: number, tolerance = 0.08): number | null {
  if (!Number.isFinite(acres) || acres <= 0) return null
  for (const standard of STANDARD_ACRES) {
    if (Math.abs(acres - standard) / standard <= tolerance) return standard
  }
  return null
}

function firstPositive(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function estimateGrossAcres(input: {
  cadAcres?: number | null
  legal?: string | null
  survey?: string | null
  section?: string | null
  block?: string | null
  township?: string | null
  shapeAcres?: number | null
}): GrossAcresEstimate {
  const cad = firstPositive(input.cadAcres)
  if (cad != null) {
    return { acres: cad, source: 'cad', estimated: false }
  }

  const text = [input.legal, input.survey].filter(Boolean).join(' ')
  const aliquot = parseAliquotFraction(text)
  if (aliquot != null && aliquot > 0 && aliquot <= 1) {
    return {
      acres: roundAcres(SECTION_ACRES * aliquot),
      source: 'aliquot',
      estimated: true,
    }
  }

  if (looksLikeRegularSection(input)) {
    return { acres: SECTION_ACRES, source: 'section', estimated: true }
  }

  const shape = firstPositive(input.shapeAcres)
  if (shape != null) {
    const snapped = snapToStandardAcres(shape)
    return {
      acres: snapped ?? roundAcres(shape),
      source: snapped ? 'section' : 'shape',
      estimated: true,
    }
  }

  return { acres: null, source: null, estimated: false }
}

export function netMineralAcres(grossAcres: number, ownershipPct: number): number {
  return grossAcres * (ownershipPct / 100)
}

/** Mineral-owner NRI percent at a lease royalty (default 1/8). */
export function mineralOwnerNriPct(
  ownershipPct: number,
  royalty: number = DEFAULT_LEASE_ROYALTY,
): number {
  return ownershipPct * royalty
}

export function formatAcres(acres: number): string {
  const nearest = Math.round(acres)
  if (Math.abs(acres - nearest) < 0.05) {
    return nearest.toLocaleString(undefined, { maximumFractionDigits: 0 })
  }
  return acres.toLocaleString(undefined, {
    minimumFractionDigits: acres < 10 ? 2 : 1,
    maximumFractionDigits: acres < 10 ? 2 : 1,
  })
}

function roundAcres(acres: number): number {
  return Math.round(acres * 1000) / 1000
}
