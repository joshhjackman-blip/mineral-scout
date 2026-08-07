/**
 * localStorage helpers for the "new permits" nav badge.
 *
 * The map-page Permits button shows a little square bubble with the
 * most-recent permit date when that date is newer than what the user
 * last saw on /permits. Visiting /permits stamps the latest date so
 * the bubble clears until the next scrape lands fresher rows.
 */

export const PERMITS_LAST_SEEN_KEY = 'mineral_map_permits_last_seen'

/** YYYY-MM-DD → compact "M/D" for the square badge. */
export function formatPermitBadgeDate(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate).trim())
  if (!m) return ''
  return `${Number(m[2])}/${Number(m[3])}`
}

export function readPermitsLastSeen(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PERMITS_LAST_SEEN_KEY)
    if (!raw) return null
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim())
    return m ? m[1] : null
  } catch {
    return null
  }
}

export function writePermitsLastSeen(isoDate: string): void {
  if (typeof window === 'undefined') return
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(isoDate).trim())
  if (!m) return
  try {
    window.localStorage.setItem(PERMITS_LAST_SEEN_KEY, m[1])
  } catch {
    // private mode / quota — badge just won't clear
  }
}

/** True when latest ingest date is newer than the user's last visit. */
export function shouldShowPermitsBadge(
  latestDate: string | null | undefined,
  lastSeen: string | null | undefined = readPermitsLastSeen(),
): boolean {
  if (!latestDate) return false
  const latest = String(latestDate).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest)) return false
  if (!lastSeen) return true
  return latest > lastSeen
}
