'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

const COOKIE = 'mm-brand-preview'

function readCookieBrand(): 'tech' | 'amber' | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|; )mm-brand-preview=(tech|amber)/)
  return match ? (match[1] as 'tech' | 'amber') : null
}

function applyBrand(brand: 'tech' | 'amber') {
  document.documentElement.dataset.brand = brand
  document.cookie = `${COOKIE}=${brand}; path=/; max-age=2592000; SameSite=Lax`
}

function BrandPreviewSync() {
  const params = useSearchParams()

  useEffect(() => {
    const query = params.get('theme')
    if (query === 'amber' || query === 'tech') {
      applyBrand(query)
      return
    }
    applyBrand(readCookieBrand() ?? 'tech')
  }, [params])

  return null
}

export default function BrandPreviewBanner() {
  const pathname = usePathname() ?? '/'
  const techHref = `${pathname}?theme=tech`
  const amberHref = `${pathname}?theme=amber`

  return (
    <>
      <Suspense fallback={null}>
        <BrandPreviewSync />
      </Suspense>
      <div className="tech-preview-banner" role="status">
        <strong>Texas Tech preview</strong>
        <span> — scarlet &amp; black, not production.</span>
        <a href={techHref}>Scarlet</a>
        <span aria-hidden="true">·</span>
        <a href={amberHref}>Original amber</a>
      </div>
    </>
  )
}
