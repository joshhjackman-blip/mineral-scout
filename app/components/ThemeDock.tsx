'use client'

import { usePathname } from 'next/navigation'
import ThemeToggle from '@/app/components/ThemeToggle'

/**
 * Fixed footer theme control for pages that don't have the map bottom bar.
 * Hidden on the map (`/`) where the toggle lives in the filter footer,
 * and on marketing/auth surfaces that keep their own look.
 */
export default function ThemeDock() {
  const pathname = usePathname() ?? '/'
  const hide =
    pathname === '/' ||
    pathname.startsWith('/landing') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/demo') ||
    pathname.startsWith('/book-demo') ||
    pathname.startsWith('/legal')

  if (hide) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        zIndex: 45,
      }}
    >
      <ThemeToggle size="md" />
    </div>
  )
}
