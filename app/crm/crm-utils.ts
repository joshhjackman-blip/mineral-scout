import { COUNTIES } from '@/lib/counties'
import type { County, CountyKey } from '@/lib/counties'

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
])

const KNOWN_COUNTY_IDS = new Set<CountyKey>(Object.keys(COUNTIES) as CountyKey[])

export const getDealCounty = (deal: Deal): DealCounty => {
  const stored = (deal.county ?? '').toLowerCase().trim() as CountyKey
  if (stored && KNOWN_COUNTY_IDS.has(stored)) return stored
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

export const formatMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

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
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return searchableText(deal).includes(needle)
}

export type CrmListFilter = {
  tag: string
  county: 'all' | CountyKey
  search: string
  followUp: 'all' | 'overdue' | 'upcoming'
  needContact: boolean
}

export const filterDeals = (deals: Deal[], filter: CrmListFilter): Deal[] => {
  return deals.filter((d) => {
    if (filter.tag !== 'all' && dealTag(d) !== filter.tag) return false
    if (filter.county !== 'all' && getDealCounty(d) !== filter.county) return false
    if (filter.search && !dealMatchesQuery(d, filter.search)) return false
    if (filter.needContact && hasContact(d)) return false
    if (filter.followUp === 'overdue') {
      if (!d.follow_up_date || !isOverdue(d.follow_up_date)) return false
    }
    if (filter.followUp === 'upcoming') {
      if (!d.follow_up_date || isOverdue(d.follow_up_date)) return false
    }
    return true
  })
}

export type CrmDashboardStats = {
  total: number
  open: number
  hot: number
  overdue: number
  needContact: number
  offers: number
  closedWon: number
  openAcres: number
  openRoyalty: number
  byStage: { key: string; label: string; count: number }[]
  byCounty: { id: string; label: string; count: number }[]
  followUps: Deal[]
  recent: Deal[]
  missingContact: Deal[]
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

  return {
    total: deals.length,
    open: openDeals.length,
    hot: deals.filter((d) => dealTag(d) === 'hot').length,
    overdue: deals.filter((d) => d.follow_up_date && isOverdue(d.follow_up_date)).length,
    needContact: deals.filter((d) => !hasContact(d)).length,
    offers: deals.filter((d) => dealTag(d) === 'offer_sent').length,
    closedWon: deals.filter((d) => dealTag(d) === 'closed_won' || dealTag(d) === 'closed').length,
    openAcres: openDeals.reduce((sum, d) => sum + (d.acreage ?? 0), 0),
    openRoyalty: openDeals.reduce((sum, d) => sum + (d.monthly_royalty ?? 0), 0),
    byStage,
    byCounty,
    followUps,
    recent,
    missingContact,
  }
}
