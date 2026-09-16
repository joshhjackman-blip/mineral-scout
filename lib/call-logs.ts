import { CALL_OUTCOMES, outcomeLabel, type CallOutcome } from '@/lib/phone-activity'

export const CALL_LOG_DESIGNATIONS = [
  { key: 'interested', label: 'Interested' },
  { key: 'not_interested', label: 'Not interested' },
  { key: 'call_back', label: 'Call back later' },
  { key: 'nurture', label: 'Nurture' },
  { key: 'offer_sent', label: 'Offer sent' },
  { key: 'offer_declined', label: 'Offer declined' },
  { key: 'already_sold', label: 'Already sold' },
  { key: 'closed_won', label: 'Closed won' },
  { key: 'closed_lost', label: 'Closed lost' },
] as const

export type CallLogDesignation = (typeof CALL_LOG_DESIGNATIONS)[number]['key']

export type CallLogRow = {
  id: string
  called_at: string
  designation: string | null
  notes: string | null
  outcome: string | null
  phone_display: string | null
  called_by_name: string | null
}

const DESIGNATION_KEYS = new Set<string>(CALL_LOG_DESIGNATIONS.map((d) => d.key))

export function isCallLogDesignation(value: string | null | undefined): value is CallLogDesignation {
  return Boolean(value && DESIGNATION_KEYS.has(value))
}

export function designationLabel(key: string | null | undefined): string {
  if (!key) return ''
  const fromLead = CALL_LOG_DESIGNATIONS.find((d) => d.key === key)
  if (fromLead) return fromLead.label
  return outcomeLabel(key as CallOutcome) || key.replace(/_/g, ' ')
}

export function formatCallLogDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatCallLogTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function splitCallLogDateTime(iso?: string): { date: string; time: string } {
  const d = iso ? new Date(iso) : new Date()
  if (!Number.isFinite(d.getTime())) {
    return splitCallLogDateTime()
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

export function joinCallLogDateTime(date: string, time: string): string {
  const raw = `${date}T${time || '00:00'}`
  const d = new Date(raw)
  if (!Number.isFinite(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

export function callLogDisplayLabel(row: Pick<CallLogRow, 'designation' | 'outcome'>): string {
  if (row.designation) return designationLabel(row.designation)
  if (row.outcome && row.outcome !== 'logged') {
    return CALL_OUTCOMES.some((o) => o.key === row.outcome)
      ? outcomeLabel(row.outcome as CallOutcome)
      : designationLabel(row.outcome)
  }
  return 'Call logged'
}

export function parseCallLogRows(raw: unknown): CallLogRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const calledAt = String(row.called_at ?? '')
      if (!calledAt) return null
      return {
        id: String(row.id ?? `log-${idx}`),
        called_at: calledAt,
        designation: row.designation == null ? null : String(row.designation),
        notes: row.notes == null || String(row.notes).trim() === '' ? null : String(row.notes),
        outcome: row.outcome == null ? null : String(row.outcome),
        phone_display: row.phone_display == null ? null : String(row.phone_display),
        called_by_name: row.called_by_name == null ? null : String(row.called_by_name),
      } satisfies CallLogRow
    })
    .filter((row): row is CallLogRow => Boolean(row))
    .sort((a, b) => new Date(b.called_at).getTime() - new Date(a.called_at).getTime())
}
