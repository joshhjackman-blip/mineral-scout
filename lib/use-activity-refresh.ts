'use client'

/**
 * Shared refresh tick for map activity layers (rig dots, permit
 * halos, sidebar New Permits) — same cadence as the Permits nav badge
 * (/api/permits/latest poll): every 5 minutes + on window focus.
 *
 * Also bumps when the latest filed/approved permit date changes, so
 * an overnight scrape shows up without waiting for the next interval.
 *
 * Returns a monotonically increasing number. Consumers treat a change
 * as "invalidate + refetch". Initial value is 0 (mount); first bump
 * is usually from the latest-date probe shortly after load.
 */

import { useEffect, useRef, useState } from 'react'

const POLL_MS = 5 * 60_000

export function useActivityRefreshTick(): number {
  const [tick, setTick] = useState(0)
  const latestDateRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const bump = () => {
      if (!cancelled) setTick((n) => n + 1)
    }

    const probeLatest = async () => {
      try {
        const res = await fetch('/api/permits/latest', { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const body = (await res.json()) as {
          success?: boolean
          data?: { latest_date?: string | null }
        }
        const next = body.success ? (body.data?.latest_date ?? null) : null
        if (cancelled) return
        if (latestDateRef.current === null) {
          // First successful probe — remember the date but don't force
          // a refetch; the mount effects already loaded current data.
          latestDateRef.current = next
          return
        }
        if (next && next !== latestDateRef.current) {
          latestDateRef.current = next
          bump()
        }
      } catch {
        // best-effort
      }
    }

    const onFocus = () => {
      bump()
      void probeLatest()
    }

    void probeLatest()
    const interval = window.setInterval(() => {
      bump()
      void probeLatest()
    }, POLL_MS)
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return tick
}
