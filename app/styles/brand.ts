/**
 * Brand colors. CSS variables on `:root` / `html[data-brand="tech"]` are
 * the source of truth for in-app chrome. Mapbox paint needs a resolved hex.
 */
export const BRAND_HEX = {
  tech: {
    primary: '#CC0000',
    primaryHot: '#E31C23',
    primaryDeep: '#9B0000',
    ink: '#111111',
  },
  amber: {
    primary: '#EF9F27',
    primaryHot: '#F5B041',
    primaryDeep: '#D97706',
    ink: '#0B2A5C',
  },
} as const

export type BrandName = keyof typeof BRAND_HEX

export function cssBrand(property: '--mm-brand' | '--mm-ink' | '--mm-brand-deep' = '--mm-brand'): string {
  if (typeof document === 'undefined') return BRAND_HEX.amber.primary
  const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim()
  if (value) return value
  return property === '--mm-ink' ? BRAND_HEX.amber.ink : BRAND_HEX.amber.primary
}
