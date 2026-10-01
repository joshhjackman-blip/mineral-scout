'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { readBrand } from '@/app/components/BrandToggle'

type AppLogoProps = {
  width?: number
  variant?: 'default' | 'light'
}

export default function AppLogo({ width = 150, variant = 'default' }: AppLogoProps) {
  const safeWidth = Math.max(40, Math.round(width))
  const safeHeight = Math.round((safeWidth * 100) / 420)
  const [tech, setTech] = useState(false)

  useEffect(() => {
    const sync = () => setTech(readBrand() === 'tech')
    sync()
    window.addEventListener('mm:brand-change', sync)
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-brand'] })
    return () => {
      window.removeEventListener('mm:brand-change', sync)
      observer.disconnect()
    }
  }, [])

  const src =
    variant === 'light'
      ? tech
        ? '/mineral-map-logo-light-tech.svg'
        : '/mineral-map-logo-light.svg'
      : tech
        ? '/mineral-map-logo-tech.svg'
        : '/mineral-map-logo.svg'

  return (
    <Image
      src={src}
      alt="MineralMap logo"
      width={safeWidth}
      height={safeHeight}
      priority
      style={{ display: 'block', height: 'auto', width: safeWidth }}
    />
  )
}
