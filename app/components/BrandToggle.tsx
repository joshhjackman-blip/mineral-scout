'use client'

import { useEffect, useState } from 'react'

export const BRAND_STORAGE_KEY = 'mineral-map-brand'

export type BrandName = 'amber' | 'tech'

export function applyBrand(brand: BrandName) {
  if (typeof document === 'undefined') return
  if (brand === 'tech') {
    document.documentElement.dataset.brand = 'tech'
  } else {
    delete document.documentElement.dataset.brand
  }
  try {
    localStorage.setItem(BRAND_STORAGE_KEY, brand)
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new Event('mm:brand-change'))
}

export function readBrand(): BrandName {
  if (typeof document === 'undefined') return 'amber'
  return document.documentElement.dataset.brand === 'tech' ? 'tech' : 'amber'
}

type BrandToggleProps = {
  size?: 'sm' | 'md'
  className?: string
}

export default function BrandToggle({ size = 'sm', className }: BrandToggleProps) {
  const [mounted, setMounted] = useState(false)
  const [tech, setTech] = useState(false)

  useEffect(() => {
    setMounted(true)
    setTech(readBrand() === 'tech')
    const sync = () => setTech(readBrand() === 'tech')
    window.addEventListener('mm:brand-change', sync)
    return () => window.removeEventListener('mm:brand-change', sync)
  }, [])

  const on = mounted && tech
  const dim = size === 'sm' ? 28 : 32
  const font = size === 'sm' ? 10 : 11

  return (
    <button
      type="button"
      onClick={() => {
        const next: BrandName = on ? 'amber' : 'tech'
        applyBrand(next)
        setTech(next === 'tech')
      }}
      aria-pressed={on}
      aria-label={on ? 'Turn off Texas Tech colors' : 'Texas Tech colors'}
      title="Texas Tech colors"
      className={className}
      style={{
        width: dim,
        height: dim,
        borderRadius: 8,
        border: on ? '1px solid #CC0000' : '1px solid var(--mm-chrome-border)',
        background: on ? '#CC0000' : 'var(--mm-chrome-bg)',
        color: on ? '#ffffff' : 'var(--mm-chrome-fg)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        fontSize: font,
        fontWeight: 800,
        letterSpacing: '-0.02em',
        fontFamily: 'Geist, Inter, system-ui, sans-serif',
        lineHeight: 1,
      }}
    >
      TT
    </button>
  )
}
