'use client'

import BrandToggle from '@/app/components/BrandToggle'
import ThemeToggle from '@/app/components/ThemeToggle'

type ThemeControlsProps = {
  size?: 'sm' | 'md'
}

export default function ThemeControls({ size = 'sm' }: ThemeControlsProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <ThemeToggle size={size} />
      <BrandToggle size={size} />
    </div>
  )
}
