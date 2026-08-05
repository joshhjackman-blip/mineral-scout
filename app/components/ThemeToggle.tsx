'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

type ThemeToggleProps = {
  /** Compact control for the map bottom bar / footer dock. */
  size?: 'sm' | 'md'
  className?: string
}

export default function ThemeToggle({ size = 'sm', className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted && resolvedTheme === 'dark'
  const dim = size === 'sm' ? 28 : 32
  const icon = size === 'sm' ? 14 : 16

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className={className}
      style={{
        width: dim,
        height: dim,
        borderRadius: 8,
        border: '1px solid var(--mm-chrome-border)',
        background: 'var(--mm-chrome-bg)',
        color: 'var(--mm-chrome-fg)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
      }}
    >
      {!mounted ? (
        <span style={{ width: icon, height: icon }} />
      ) : isDark ? (
        <Sun size={icon} strokeWidth={2} />
      ) : (
        <Moon size={icon} strokeWidth={2} />
      )}
    </button>
  )
}
