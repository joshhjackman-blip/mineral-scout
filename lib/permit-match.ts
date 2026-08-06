/**
 * Shared helpers for attaching RRC permits to a tract.
 *
 * Fresh rows from scrape_rrc_permits_realtime.py have NO lat/lon and
 * usually NO abstract_number until compute_development_status.py runs.
 * Matching therefore has to fall back to operator + lease-name against
 * wells already known on the tract — same idea as /permits tier 4,
 * but scoped to one clicked abstract.
 */

export type PermitLike = {
  permit_number?: string | null
  api_number?: string | null
  operator_name?: string | null
  lease_name?: string | null
  latitude?: number | string | null
  longitude?: number | string | null
  filed_date?: string | null
  approved_date?: string | null
  abstract_number?: string | null
}

export type WellLike = {
  lease_name?: string | null
  operator_name?: string | null
  api_number?: string | null
}

export function bareAbstract(raw: unknown): string {
  return String(raw ?? '')
    .replace(/^A-\s*/i, '')
    .replace(/^\d{5}-/, '')
    .trim()
    .toUpperCase()
}

/** Latest of filed_date / approved_date (YYYY-MM-DD), or null. */
export function permitBestDate(permit: PermitLike): string | null {
  const filed = String(permit.filed_date ?? '').slice(0, 10)
  const approved = String(permit.approved_date ?? '').slice(0, 10)
  if (filed && approved) return filed >= approved ? filed : approved
  return filed || approved || null
}

export function cleanLeaseName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\bUNIT\b/g, ' ')
    .replace(/\b(THE|A|AN|LEASE)\b/g, ' ')
    .replace(/[^A-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Score how closely a permit lease matches a well lease (0 / 10 / 50 / 100). */
export function leaseMatchScore(permitLease: string, wellLease: string): number {
  const permitClean = cleanLeaseName(permitLease)
  const wellClean = cleanLeaseName(wellLease)
  if (!permitClean || !wellClean) return 0
  if (wellClean === permitClean) return 100
  const permitTokens = permitClean.split(' ').filter(Boolean)
  if (permitTokens.length === 0) return 0
  const permitHead = permitTokens.slice(0, 2).join(' ')
  if (wellClean.startsWith(permitHead) || permitClean.startsWith(wellClean.split(' ').slice(0, 2).join(' '))) {
    return 50
  }
  if (wellClean.split(' ')[0] === permitTokens[0]) return 10
  return 0
}

function operatorLooselyMatches(
  permitOp: string | null | undefined,
  wellOp: string | null | undefined,
): boolean {
  const a = String(permitOp ?? '').trim().toUpperCase()
  const b = String(wellOp ?? '').trim().toUpperCase()
  if (!a || !b) return true
  const a0 = a.split(/\s+/)[0] ?? ''
  const b0 = b.split(/\s+/)[0] ?? ''
  if (!a0 || !b0) return true
  return a.includes(b0) || b.includes(a0)
}

/**
 * True when the permit belongs on this tract via its wells
 * (lease/operator), without relying on lat/lon or abstract_number.
 */
export function permitMatchesTractWells(
  permit: PermitLike,
  wells: WellLike[],
): boolean {
  if (!wells.length) return false
  const lease = String(permit.lease_name ?? '').trim()
  const api = String(permit.api_number ?? '').replace(/\D/g, '')

  for (const well of wells) {
    const wellApi = String(well.api_number ?? '').replace(/\D/g, '')
    if (api && wellApi && api === wellApi) return true
  }

  if (!lease) return false
  for (const well of wells) {
    if (!operatorLooselyMatches(permit.operator_name, well.operator_name)) continue
    if (leaseMatchScore(lease, String(well.lease_name ?? '')) >= 50) return true
  }
  return false
}

/**
 * Weak legal-description fallback: permit lease mentions this tract's
 * section (and block when available), and operator loosely matches the
 * tract's top operator. Kept strict to avoid cross-tract noise.
 */
export function permitMatchesTractLegal(
  permit: PermitLike,
  opts: {
    section?: string | null
    block?: string | null
    operator?: string | null
  },
): boolean {
  const lease = cleanLeaseName(String(permit.lease_name ?? ''))
  if (!lease) return false
  if (!operatorLooselyMatches(permit.operator_name, opts.operator)) return false

  const section = String(opts.section ?? '')
    .replace(/^0+/, '')
    .trim()
    .toUpperCase()
  if (!section) return false

  const tokens = lease.split(/[\s-]+/).filter(Boolean)
  const hasSection = tokens.includes(section)
  if (!hasSection) return false

  const blockRaw = String(opts.block ?? '').toUpperCase()
  const blockNum = blockRaw.replace(/T\d+[NS]/i, '').trim().split(/\s+/)[0] ?? ''
  if (!blockNum) return false
  return (
    tokens.includes(blockNum) ||
    lease.includes(`BLK ${blockNum}`) ||
    lease.includes(`BLOCK ${blockNum}`)
  )
}
