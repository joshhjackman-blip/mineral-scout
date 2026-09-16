/** Strip a well API down to digits (8-digit county+well or 10-digit with 42). */
export function normalizeApi(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '')
}

export function apiLookupVariants(raw: unknown): string[] {
  const digits = normalizeApi(raw)
  if (!digits) return []
  const out = new Set<string>([digits])
  if (digits.length === 10 && digits.startsWith('42')) out.add(digits.slice(2))
  if (digits.length === 8) out.add(`42${digits}`)
  return Array.from(out)
}

export function normalizeLeaseId(raw: unknown): string {
  return String(raw ?? '').replace(/^0+/, '').trim()
}

export function leaseLookupVariants(raw: unknown): string[] {
  const text = String(raw ?? '').trim()
  if (!text) return []
  const stripped = text.replace(/^0+/, '') || '0'
  return Array.from(new Set([text, stripped]))
}
