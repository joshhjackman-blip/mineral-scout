/**
 * Terms of Service versioning + access helpers.
 *
 * Bump CURRENT_AGREEMENT_VERSION when legal/PLATFORM-SERVICES-AGREEMENT.md
 * changes materially — users must re-sign that version before using the app.
 */

export const CURRENT_AGREEMENT_VERSION = '2026-10-06'

/** Gate is on unless explicitly disabled (AGREEMENT_GATE_ENABLED=false). */
export function isAgreementGateEnabled(): boolean {
  return process.env.AGREEMENT_GATE_ENABLED !== 'false'
}

export function hasSignedCurrentAgreement(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  const signed = String(metadata?.agreement_version ?? '').trim()
  return signed.length > 0 && signed === CURRENT_AGREEMENT_VERSION
}
