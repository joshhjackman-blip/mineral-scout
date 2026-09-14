export const CALL_OUTCOMES = [
  { key: 'no_answer', label: 'No answer' },
  { key: 'voicemail', label: 'Voicemail' },
  { key: 'connected', label: 'Picked up' },
  { key: 'wrong_number', label: 'Wrong #' },
  { key: 'busy', label: 'Busy' },
  { key: 'do_not_call', label: 'DNC' },
] as const

export type CallOutcome = (typeof CALL_OUTCOMES)[number]['key']

export type PhoneActivityEntry = {
  lastCalledAt: string
  lastOutcome: CallOutcome
  lastCalledBy?: string | null
  lastCalledByName?: string | null
  connected?: boolean
}

export type PhoneActivityMap = Record<string, PhoneActivityEntry>

export function phoneKey(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

export function parsePhoneActivity(raw: unknown): PhoneActivityMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PhoneActivityMap = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = phoneKey(key)
    if (!normalized || !value || typeof value !== 'object') continue
    const row = value as Partial<PhoneActivityEntry>
    if (!row.lastCalledAt || !row.lastOutcome) continue
    if (!CALL_OUTCOMES.some((o) => o.key === row.lastOutcome)) continue
    out[normalized] = {
      lastCalledAt: row.lastCalledAt,
      lastOutcome: row.lastOutcome,
      lastCalledBy: row.lastCalledBy ?? null,
      lastCalledByName: row.lastCalledByName ?? null,
      connected: Boolean(row.connected),
    }
  }
  return out
}

export function applyCallOutcome(
  current: PhoneActivityMap,
  rawPhone: string,
  outcome: CallOutcome,
  input: {
    at?: string
    calledBy?: string | null
    calledByName?: string | null
  } = {},
): { activity: PhoneActivityMap; connectedPhone: string | null } {
  const key = phoneKey(rawPhone)
  const at = input.at ?? new Date().toISOString()
  const next: PhoneActivityMap = { ...current }
  if (outcome === 'connected') {
    for (const [existingKey, entry] of Object.entries(next)) {
      next[existingKey] = { ...entry, connected: existingKey === key }
    }
  }
  next[key] = {
    lastCalledAt: at,
    lastOutcome: outcome,
    lastCalledBy: input.calledBy ?? null,
    lastCalledByName: input.calledByName ?? null,
    connected: outcome === 'connected',
  }
  const connectedPhone =
    outcome === 'connected'
      ? key
      : Object.entries(next).find(([, entry]) => entry.connected)?.[0] ?? null
  return { activity: next, connectedPhone }
}

export function outcomeLabel(outcome: CallOutcome | null | undefined): string {
  return CALL_OUTCOMES.find((o) => o.key === outcome)?.label ?? ''
}

export function formatLastCalled(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const delta = Math.max(0, now - then)
  const minutes = Math.round(delta / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function hasPhone(deal: {
  phone?: string | null
  phones?: (string | null)[] | null
}): boolean {
  if (String(deal.phone ?? '').trim()) return true
  return (deal.phones ?? []).some((p) => Boolean(String(p ?? '').trim()))
}

/** Skip-traced (or queued) and still missing a number. */
export function waitingOnNumber(deal: {
  phone?: string | null
  phones?: (string | null)[] | null
  tag?: string | null
  source?: string | null
  needs_phone?: boolean | null
}): boolean {
  if (hasPhone(deal)) return false
  if (deal.needs_phone) return true
  if (deal.tag === 'skip_traced') return true
  if (deal.source === 'skip_trace') return true
  return false
}

export function waitingOnNumberCopy(count: number): string {
  if (count === 1) return '1 lead waiting on a number'
  return `${count} leads waiting on a number`
}
