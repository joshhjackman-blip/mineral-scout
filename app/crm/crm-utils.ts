import { COUNTIES } from '@/lib/counties'
import type { County, CountyKey } from '@/lib/counties'
import { nameMatchesQuery, tokenizeName } from '@/lib/name-search'
import {
  hasPhone,
  parsePhoneActivity,
  waitingOnNumber,
  type PhoneActivityMap,
} from '@/lib/phone-activity'

export type Deal = {
  id: string
  owner_name: string
  tract_abstract?: string | null
  tract_survey?: string | null
  rrc_lease_id?: string | null
  operator_name?: string | null
  county?: string | null
  surv_name?: string | null
  block?: string | null
  surv_sect?: string | null
  mailing_address?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  acreage?: number | null
  monthly_royalty?: number | null
  propensity_score?: number | null
  tag?: string | null
  offer_amount?: number | null
  follow_up_date?: string | null
  source?: string | null
  notes?: string | null
  phone?: string | null
  email?: string | null
  phones?: string[] | null
  emails?: string[] | null
  phone_activity?: PhoneActivityMap | null
  connected_phone?: string | null
  needs_phone?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

export type DealCounty = CountyKey | 'unknown'

export const TAG_LABELS: Record<string, string> = {
  hot: 'Hot',
  nurture: 'Nurture',
  prospect: 'Prospect',
  not_interested: 'Not Interested',
  bad_lead: 'Bad Lead',
  skip_traced: 'Skip Traced',
  offer_sent: 'Offer Sent',
  offer_declined: 'Offer Declined',
  already_sold: 'Already Sold',
  closed: 'Closed',
  interested: 'Interested',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
  call_back: 'Call Back Later',
}

export const PIPELINE_STAGES: { key: string; label: string }[] = [
  { key: 'prospect', label: 'Prospect' },
  { key: 'hot', label: 'Hot' },
  { key: 'skip_traced', label: 'Skip Traced' },
  { key: 'interested', label: 'Interested' },
  { key: 'nurture', label: 'Nurture' },
  { key: 'call_back', label: 'Call Back' },
  { key: 'offer_sent', label: 'Offer Sent' },
  { key: 'closed_won', label: 'Closed Won' },
]

export const CLOSED_OUT_TAGS = new Set([
  'closed',
  'closed_won',
  'closed_lost',
  'not_interested',
  'bad_lead',
  'offer_declined',
  'already_sold',
])

const KNOWN_COUNTY_IDS = new Set<CountyKey>(Object.keys(COUNTIES) as CountyKey[])

/** Accept "glasscock", "Glasscock County", or "Glasscock County, TX". */
export const parseCountyField = (raw: string | null | undefined): CountyKey | null => {
  const stored = (raw ?? '').toLowerCase().trim()
  if (!stored) return null
  if (KNOWN_COUNTY_IDS.has(stored as CountyKey)) return stored as CountyKey
  const bare = stored
    .replace(/,/g, ' ')
    .replace(/\btx\b/g, '')
    .replace(/\bcounty\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (bare && KNOWN_COUNTY_IDS.has(bare as CountyKey)) return bare as CountyKey
  for (const [countyId, county] of Object.entries(COUNTIES) as Array<[CountyKey, County]>) {
    if (county.displayName.toLowerCase() === stored) return countyId
    if (county.name.toLowerCase() === stored || county.name.toLowerCase() === bare) {
      return countyId
    }
  }
  return null
}

export const getDealCounty = (deal: Deal): DealCounty => {
  const fromField = parseCountyField(deal.county)
  if (fromField) return fromField
  const op = (deal.operator_name ?? '').toLowerCase()
  if (op) {
    for (const [countyId, county] of Object.entries(COUNTIES) as Array<[CountyKey, County]>) {
      if (county.operatorPatterns.some((p) => op.includes(p))) {
        return countyId
      }
    }
  }
  return 'unknown'
}

export const countyLabel = (deal: Deal): string => {
  const id = getDealCounty(deal)
  if (id === 'unknown') return 'Unknown county'
  return COUNTIES[id]?.name ?? id
}

export const dealTag = (deal: Deal): string => deal.tag ?? 'prospect'

export const isOverdue = (date: string) => new Date(date) < new Date()

export const formatDate = (date: string) => {
  const d = new Date(date)
  const today = new Date()
  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  return `in ${diff}d`
}

export const hasContact = (deal: Deal): boolean => {
  if (deal.phone || deal.email) return true
  if ((deal.phones ?? []).some(Boolean)) return true
  if ((deal.emails ?? []).some(Boolean)) return true
  return false
}

const searchableText = (deal: Deal): string => {
  const county = countyLabel(deal)
  const parts = [
    deal.owner_name,
    deal.operator_name,
    deal.tract_abstract,
    deal.tract_survey,
    deal.surv_name,
    deal.block,
    deal.surv_sect,
    deal.rrc_lease_id,
    deal.mailing_address,
    deal.mailing_city,
    deal.mailing_state,
    deal.mailing_zip,
    deal.phone,
    deal.email,
    deal.notes,
    deal.tag,
    TAG_LABELS[dealTag(deal)] ?? '',
    county,
    ...(deal.phones ?? []),
    ...(deal.emails ?? []),
  ]
  return parts.filter(Boolean).join(' ').toLowerCase()
}

export const dealMatchesQuery = (deal: Deal, query: string): boolean => {
  const needle = query.trim()
  if (!needle) return true
  if (nameMatchesQuery(deal.owner_name, needle)) return true
  const blob = searchableText(deal)
  if (blob.includes(needle.toLowerCase())) return true
  const tokens = tokenizeName(needle)
  if (tokens.length <= 1) return false
  const blobTokens = tokenizeName(blob)
  return tokens.every((token) =>
    blobTokens.some((hay) => hay.includes(token)) || blob.includes(token.toLowerCase()),
  )
}

export type CrmListFilter = {
  tag: string
  county: 'all' | CountyKey
  search: string
  followUp: 'all' | 'overdue' | 'upcoming'
  needContact: boolean
  waitingOnNumber: boolean
}

export const filterDeals = (deals: Deal[], filter: CrmListFilter): Deal[] => {
  return deals.filter((d) => {
    if (filter.tag !== 'all' && dealTag(d) !== filter.tag) return false
    if (filter.county !== 'all' && getDealCounty(d) !== filter.county) return false
    if (filter.search && !dealMatchesQuery(d, filter.search)) return false
    if (filter.needContact && hasContact(d)) return false
    if (filter.waitingOnNumber && !waitingOnNumber(d)) return false
    if (filter.followUp === 'overdue') {
      if (!d.follow_up_date || !isOverdue(d.follow_up_date)) return false
    }
    if (filter.followUp === 'upcoming') {
      if (!d.follow_up_date || isOverdue(d.follow_up_date)) return false
    }
    return true
  })
}

export const toDateKey = (value: string | Date): string => {
  const d = value instanceof Date ? value : new Date(value)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const dateKeyToIso = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).toISOString()
}

export const formatDateKey = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export type CalendarCell = {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
}

export const buildMonthCells = (year: number, month: number): CalendarCell[] => {
  const todayKey = toDateKey(new Date())
  const first = new Date(year, month, 1)
  const startDow = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: CalendarCell[] = []

  for (let i = 0; i < startDow; i += 1) {
    const d = new Date(year, month, 1 - (startDow - i))
    cells.push({
      key: toDateKey(d),
      day: d.getDate(),
      inMonth: false,
      isToday: toDateKey(d) === todayKey,
    })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const d = new Date(year, month, day)
    cells.push({
      key: toDateKey(d),
      day,
      inMonth: true,
      isToday: toDateKey(d) === todayKey,
    })
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]
    const [y, m, d] = last.key.split('-').map(Number)
    const next = new Date(y, m - 1, d + 1)
    cells.push({
      key: toDateKey(next),
      day: next.getDate(),
      inMonth: false,
      isToday: toDateKey(next) === todayKey,
    })
  }
  return cells
}

export const groupDealsByDate = (deals: Deal[]): Map<string, Deal[]> => {
  const map = new Map<string, Deal[]>()
  for (const deal of deals) {
    if (!deal.follow_up_date) continue
    const key = toDateKey(deal.follow_up_date)
    const list = map.get(key) ?? []
    list.push(deal)
    map.set(key, list)
  }
  return map
}

export type CrmDashboardStats = {
  total: number
  open: number
  hot: number
  overdue: number
  needContact: number
  waitingOnNumber: number
  offers: number
  closedWon: number
  byStage: { key: string; label: string; count: number }[]
  byCounty: { id: string; label: string; count: number }[]
  followUps: Deal[]
  recent: Deal[]
  missingContact: Deal[]
  waitingOnNumberDeals: Deal[]
}

export const buildDashboardStats = (deals: Deal[]): CrmDashboardStats => {
  const openDeals = deals.filter((d) => !CLOSED_OUT_TAGS.has(dealTag(d)))
  const byStage = PIPELINE_STAGES.map((stage) => ({
    ...stage,
    count: deals.filter((d) => dealTag(d) === stage.key).length,
  }))

  const countyCounts = new Map<string, number>()
  for (const deal of deals) {
    const id = getDealCounty(deal)
    countyCounts.set(id, (countyCounts.get(id) ?? 0) + 1)
  }
  const byCounty = Array.from(countyCounts.entries())
    .map(([id, count]) => ({
      id,
      label: id === 'unknown' ? 'Unknown' : (COUNTIES[id as CountyKey]?.name ?? id),
      count,
    }))
    .sort((a, b) => b.count - a.count)

  const followUps = deals
    .filter((d) => d.follow_up_date)
    .sort((a, b) => new Date(a.follow_up_date ?? 0).getTime() - new Date(b.follow_up_date ?? 0).getTime())
    .slice(0, 8)

  const recent = [...deals]
    .sort((a, b) => new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime())
    .slice(0, 8)

  const missingContact = deals.filter((d) => !hasContact(d)).slice(0, 8)
  const waitingOnNumberDeals = deals.filter((d) => waitingOnNumber(d)).slice(0, 8)

  return {
    total: deals.length,
    open: openDeals.length,
    hot: deals.filter((d) => dealTag(d) === 'hot').length,
    overdue: deals.filter((d) => d.follow_up_date && isOverdue(d.follow_up_date)).length,
    needContact: deals.filter((d) => !hasContact(d)).length,
    waitingOnNumber: deals.filter((d) => waitingOnNumber(d)).length,
    offers: deals.filter((d) => dealTag(d) === 'offer_sent').length,
    closedWon: deals.filter((d) => dealTag(d) === 'closed_won' || dealTag(d) === 'closed').length,
    byStage,
    byCounty,
    followUps,
    recent,
    missingContact,
    waitingOnNumberDeals,
  }
}

export { hasPhone, parsePhoneActivity, waitingOnNumber }
