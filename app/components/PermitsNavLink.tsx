'use client'

/**
 * Permits nav control with a little square "new ingest" bubble.
 *
 * Fetches /api/permits/latest and, when that date is newer than the
 * localStorage stamp written on /permits visits, overlays a compact
 * M/D badge on the top-right corner of the link — classic notification
 * square, not a pill.
 */

import {
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  formatPermitBadgeDate,
  readPermitsLastSeen,
  shouldShowPermitsBadge,
} from '@/lib/permits-seen'

type Props = {
  href?: string
  children?: ReactNode
  style?: CSSProperties
  className?: string
  title?: string
  onMouseEnter?: (e: MouseEvent<HTMLAnchorElement>) => void
  onMouseLeave?: (e: MouseEvent<HTMLAnchorElement>) => void
}

export default function PermitsNavLink({
  href = '/permits',
  children = 'Permits',
  style,
  className,
  title,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const [latestDate, setLatestDate] = useState<string | null>(null)
  const [lastSeen, setLastSeen] = useState<string | null>(null)

  useEffect(() => {
    setLastSeen(readPermitsLastSeen())

    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch('/api/permits/latest', { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as {
          success?: boolean
          data?: { latest_date?: string | null }
        }
        if (cancelled) return
        if (body.success) {
          setLatestDate(body.data?.latest_date ?? null)
          // Re-read in case /permits stamped while this tab was open.
          setLastSeen(readPermitsLastSeen())
        }
      } catch {
        // Badge is best-effort — stay quiet on network blips.
      }
    }

    void tick()
    const onFocus = () => {
      setLastSeen(readPermitsLastSeen())
      void tick()
    }
    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(tick, 5 * 60_000)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
    }
  }, [])

  const show = shouldShowPermitsBadge(latestDate, lastSeen)
  const label = formatPermitBadgeDate(latestDate)

  return (
    <a
      href={href}
      className={className}
      title={
        title ??
        (show && latestDate
          ? `New permits through ${latestDate} — open Recent Permits`
          : 'Recent Permits')
      }
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'relative',
        display: 'inline-block',
        ...style,
      }}
    >
      {children}
      {show && label ? (
        <span
          aria-label={`New permits as of ${latestDate}`}
          style={{
            position: 'absolute',
            top: -7,
            right: -8,
            minWidth: 22,
            height: 16,
            padding: '0 4px',
            borderRadius: 3,
            background: '#DC2626',
            color: '#FFFFFF',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.02em',
            lineHeight: '16px',
            textAlign: 'center',
            fontFamily: 'Geist, Inter, system-ui, sans-serif',
            boxShadow: '0 0 0 2px var(--mm-chrome-bg, #FFFFFF)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      ) : null}
    </a>
  )
}
