'use client'

// CRM: dashboard home + leads workspace.
//
// Dashboard is the default view (pipeline KPIs, status/county mix,
// follow-up queue). Calendar shows follow-up dates. Leads is the
// existing two-panel workspace:
//   Left  — filterable / searchable leads list, one row per Deal.
//   Right — full-height OwnerDrawer.
// Header search jumps to a lead from any view.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { COUNTIES } from '@/lib/counties'
import type { County, CountyKey } from '@/lib/counties'
import AppLogo from '@/app/components/AppLogo'
import { MapPin, Search, User, Flame, TrendingUp, XCircle, ThumbsDown, CheckCircle2, DollarSign, Clock } from 'lucide-react'
import OwnerDrawer from '@/app/components/OwnerDrawer'
import type { OwnerDetailsPatch, OwnerLike } from '@/app/components/OwnerDrawer'
import {
  deleteOwnerOverride,
  upsertOwnerOverride,
} from '@/lib/owner-overrides'
import { getWorkspaceContext } from '@/lib/workspace'
import { PREVIEW_DEALS, shouldLoadPreviewDeals } from './preview-deals'
import CrmDashboard from './CrmDashboard'
import type { DashboardOpenFilter } from './CrmDashboard'
import CrmCalendar from './CrmCalendar'
import CrmGlobalSearch from './CrmGlobalSearch'
import {
  type Deal,
  filterDeals,
  formatDate,
  getDealCounty,
  isOverdue,
} from './crm-utils'

export const dynamic = 'force-dynamic'

// Small compatibility badge system carried over from the previous
// CRM. Only the badge (label + color) survives — no more clicking
// through pipeline stages, since the user asked to drop that UX.
const TAG_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  hot:            { label: 'Hot',           color: 'text-red-700',     bg: 'bg-red-50 border-red-200',       icon: <Flame size={11} /> },
  nurture:        { label: 'Nurture',       color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',   icon: <TrendingUp size={11} /> },
  prospect:       { label: 'Prospect',      color: 'text-green-700',   bg: 'bg-green-50 border-green-200',   icon: <TrendingUp size={11} /> },
  not_interested: { label: 'Not Interested',color: 'text-slate-400',   bg: 'bg-slate-50 border-slate-100',   icon: <XCircle size={11} /> },
  bad_lead:       { label: 'Bad Lead',      color: 'text-rose-700',    bg: 'bg-rose-50 border-rose-200',     icon: <ThumbsDown size={11} /> },
  skip_traced:    { label: 'Skip Traced',   color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={11} /> },
  offer_sent:     { label: 'Offer Sent',    color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',     icon: <DollarSign size={11} /> },
  closed:         { label: 'Closed',        color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={11} /> },
  // Lead-workspace status designations (set from the lead detail view).
  interested:     { label: 'Interested',    color: 'text-green-700',   bg: 'bg-green-50 border-green-200',    icon: <CheckCircle2 size={11} /> },
  closed_won:     { label: 'Closed Won',    color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={11} /> },
  closed_lost:    { label: 'Closed Lost',   color: 'text-rose-700',    bg: 'bg-rose-50 border-rose-200',     icon: <XCircle size={11} /> },
  call_back:      { label: 'Call Back Later', color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200', icon: <TrendingUp size={11} /> },
}

const TagBadge = ({ tag }: { tag: string }) => {
  const cfg = TAG_CONFIG[tag] ?? TAG_CONFIG.prospect
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color} whitespace-nowrap`}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

// ─── Deal → OwnerLike mapping ────────────────────────────────────────────

// The OwnerDrawer expects an OwnerLike from the map — same shape,
// mostly a subset of Deal columns.
const dealToOwner = (deal: Deal): OwnerLike => ({
  id: deal.id,
  owner_name: deal.owner_name,
  propensity_score: deal.propensity_score ?? undefined,
  operator_name: deal.operator_name,
  mailing_address: deal.mailing_address,
  mailing_city: deal.mailing_city,
  mailing_state: deal.mailing_state,
  mailing_zip: deal.mailing_zip,
  acreage: deal.acreage,
  phone: deal.phone,
  email: deal.email,
  phones: deal.phones,
  emails: deal.emails,
  rrc_lease_id: deal.rrc_lease_id,
})

// ─── Component ────────────────────────────────────────────────────────────

export default function CRM() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [selected, setSelected] = useState<Deal | null>(null)
  const [view, setView] = useState<'dashboard' | 'leads' | 'calendar'>('dashboard')
  const [activeTag, setActiveTag] = useState('all')
  const [countyFilter, setCountyFilter] = useState<'all' | CountyKey>('all')
  const [search, setSearch] = useState('')
  const [followUpFilter, setFollowUpFilter] = useState<'all' | 'overdue' | 'upcoming'>('all')
  const [needContact, setNeedContact] = useState(false)

  useEffect(() => {
    void (async () => {
      const workspace = await getWorkspaceContext()
      if (!workspace) {
        setDeals(shouldLoadPreviewDeals() ? PREVIEW_DEALS : [])
        return
      }
      // RLS also scopes by team_owner_id; filter explicitly so a missing
      // migration can't accidentally paint another team's CRM.
      const { data } = await supabase
        .from('deals')
        .select('*')
        .eq('team_owner_id', workspace.workspaceId)
        .order('updated_at', { ascending: false })
      setDeals((data as Deal[]) ?? [])
    })()
  }, [])

  const filtered = useMemo(
    () =>
      filterDeals(deals, {
        tag: activeTag,
        county: countyFilter,
        search,
        followUp: followUpFilter,
        needContact,
      }),
    [deals, activeTag, countyFilter, search, followUpFilter, needContact],
  )

  const extraFiltersOn = followUpFilter !== 'all' || needContact

  const openLead = useCallback((deal: Deal) => {
    setActiveTag('all')
    setCountyFilter('all')
    setFollowUpFilter('all')
    setNeedContact(false)
    setSearch('')
    setSelected(deal)
    setView('leads')
  }, [])

  const openLeadsFilter = useCallback((next: DashboardOpenFilter) => {
    setActiveTag(next.tag ?? 'all')
    setCountyFilter(next.county ?? 'all')
    setFollowUpFilter(next.followUp ?? 'all')
    setNeedContact(Boolean(next.needContact))
    setSearch('')
    setSelected(null)
    setView('leads')
  }, [])

  const clearExtraFilters = useCallback(() => {
    setFollowUpFilter('all')
    setNeedContact(false)
  }, [])

  const handleSetFollowUp = useCallback(async (deal: Deal, followUpDate: string | null) => {
    const next = { follow_up_date: followUpDate, updated_at: new Date().toISOString() }
    if (!deal.id.startsWith('preview-')) {
      const { error } = await supabase
        .from('deals')
        .update(next)
        .eq('id', deal.id)
      if (error) {
        console.error('Failed to set follow-up:', error)
        return
      }
    }
    setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, ...next } : d)))
    setSelected((prev) => (prev?.id === deal.id ? { ...prev, ...next } : prev))
  }, [])

  const handleSkipTrace = useCallback(async (owner: OwnerLike) => {
    // Kept the CRM-scoped skip-trace flow (writes back to the deal
    // row) rather than delegating to the OwnerDrawer default because
    // we want the deal's `phone`, `email`, and `tag='skip_traced'`
    // to update in one round-trip. This is why the button in the
    // drawer still says "Skip Trace" but the network side effect is
    // the CRM's.
    const deal = deals.find((d) => d.id === owner.id) ?? selected
    if (!deal) return

    const nameParts = (deal.owner_name ?? '').trim().split(/\s+/)
    const lastName = nameParts.length > 1 ? nameParts[0] : ''
    const firstName = nameParts.length > 1 ? nameParts[1] : (nameParts[0] ?? '')

    try {
      const res = await fetch('/api/skiptrace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          address: deal.mailing_address ?? '',
          city: deal.mailing_city ?? '',
          state: deal.mailing_state ?? '',
          zip: deal.mailing_zip ?? '',
          ownerName: deal.owner_name,
        }),
      })
      const result = await res.json()
      const phones: string[] = Array.isArray(result.phones) ? result.phones : []
      const emails: string[] = Array.isArray(result.emails) ? result.emails : []
      const phone = phones[0] ?? null
      const email = emails[0] ?? null

      if (!phone && !email) {
        alert('No contact info found for this owner.')
        return
      }

      const derivedCounty = deal.county ?? (() => {
        const d = getDealCounty(deal)
        return d === 'unknown' ? null : d
      })()

      const updatePayload: Record<string, unknown> = {
        phone,
        email,
        phones,
        emails,
        tag: 'skip_traced',
        updated_at: new Date().toISOString(),
      }
      if (!deal.county && derivedCounty) updatePayload.county = derivedCounty

      await supabase.from('deals').update(updatePayload).eq('id', deal.id)
      const patch: Partial<Deal> = { phone, email, phones, emails, tag: 'skip_traced', county: deal.county ?? derivedCounty ?? null }
      setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, ...patch } : d)))
      setSelected((prev) => (prev?.id === deal.id ? { ...prev, ...patch } as Deal : prev))
    } catch (err) {
      console.error('Skip trace failed:', err)
      alert('Skip trace request failed. Please try again.')
    }
  }, [deals, selected])

  // The OwnerDrawer's "add to pipeline" callback is a no-op here
  // because every deal in the CRM is already in the pipeline (by
  // definition — they wouldn't have a Deal row otherwise). We still
  // hand a callback down because OwnerDrawer's prop is required.
  const handleAddToPipeline = useCallback(() => {
    // No-op. Every deal in the CRM is already in the pipeline.
  }, [])

  // Derive the countyId for the selected deal. OwnerDrawer needs a
  // CountyKey so it knows which per-county tables to query for
  // holdings / wells / notes. When we can't figure out the county
  // (legacy row, no operator match), default to 'martin' — the
  // default county everywhere else in the app.
  const selectedCountyId: CountyKey = useMemo(() => {
    if (!selected) return 'martin' as CountyKey
    const derived = getDealCounty(selected)
    return derived === 'unknown' ? ('martin' as CountyKey) : derived
  }, [selected])

  const handleSaveOwnerDetails = useCallback(
    async (owner: OwnerLike, patch: OwnerDetailsPatch) => {
      const deal = deals.find((d) => d.id === owner.id) ?? selected
      if (!deal) return { success: false, error: 'Deal not found' }

      const countyId = (() => {
        const d = getDealCounty(deal)
        return d === 'unknown' ? selectedCountyId : d
      })()

      const updatePayload: Record<string, unknown> = {
        mailing_address: patch.mailing_address ?? null,
        mailing_city: patch.mailing_city ?? null,
        mailing_state: patch.mailing_state ?? null,
        mailing_zip: patch.mailing_zip ?? null,
        phone: patch.phone ?? null,
        email: patch.email ?? null,
        updated_at: new Date().toISOString(),
      }
      if (patch.phones) updatePayload.phones = patch.phones
      if (patch.emails) updatePayload.emails = patch.emails

      const { error } = await supabase
        .from('deals')
        .update(updatePayload)
        .eq('id', deal.id)
      if (error) return { success: false, error: error.message }

      const { error: overrideError } = await upsertOwnerOverride({
        countyId,
        ownerName: deal.owner_name,
        abstract: deal.tract_abstract,
        status: 'updated',
        patch: {
          ...patch,
          display_name: patch.display_name || deal.owner_name,
        },
      })
      if (overrideError) {
        // Deal write succeeded; override is best-effort.
        console.error('owner_overrides upsert failed:', overrideError)
      }

      const nextPatch: Partial<Deal> = {
        mailing_address: patch.mailing_address ?? null,
        mailing_city: patch.mailing_city ?? null,
        mailing_state: patch.mailing_state ?? null,
        mailing_zip: patch.mailing_zip ?? null,
        phone: patch.phone ?? null,
        email: patch.email ?? null,
        ...(patch.phones ? { phones: patch.phones } : {}),
        ...(patch.emails ? { emails: patch.emails } : {}),
      }
      setDeals((prev) =>
        prev.map((d) => (d.id === deal.id ? { ...d, ...nextPatch } : d)),
      )
      setSelected((prev) =>
        prev?.id === deal.id ? ({ ...prev, ...nextPatch } as Deal) : prev,
      )
      return { success: true }
    },
    [deals, selected, selectedCountyId],
  )

  const handleSetStatus = useCallback(
    async (owner: OwnerLike, status: string) => {
      const deal = deals.find((d) => d.id === owner.id) ?? selected
      if (!deal) return { success: false, error: 'Deal not found' }
      const { error } = await supabase
        .from('deals')
        .update({ tag: status, updated_at: new Date().toISOString() })
        .eq('id', deal.id)
      if (error) return { success: false, error: error.message }
      setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, tag: status } : d)))
      setSelected((prev) => (prev?.id === deal.id ? ({ ...prev, tag: status } as Deal) : prev))
      return { success: true }
    },
    [deals, selected],
  )

  const handleRemoveOwner = useCallback(
    async (
      owner: OwnerLike,
      opts: { status: 'hidden' | 'incorrect'; note?: string },
    ) => {
      const deal = deals.find((d) => d.id === owner.id) ?? selected
      if (!deal) return { success: false, error: 'Deal not found' }

      const countyId = (() => {
        const d = getDealCounty(deal)
        return d === 'unknown' ? selectedCountyId : d
      })()

      const { error } = await supabase
        .from('deals')
        .update({
          tag: 'bad_lead',
          notes: opts.note
            ? `${deal.notes ? `${deal.notes}\n` : ''}Removed: ${opts.note}`
            : deal.notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', deal.id)
      if (error) return { success: false, error: error.message }

      await upsertOwnerOverride({
        countyId,
        ownerName: deal.owner_name,
        abstract: deal.tract_abstract,
        status: opts.status,
        patch: {
          mailing_address: deal.mailing_address,
          mailing_city: deal.mailing_city,
          mailing_state: deal.mailing_state,
          mailing_zip: deal.mailing_zip,
          phone: deal.phone,
          email: deal.email,
          note: opts.note,
        },
      })

      setDeals((prev) =>
        prev.map((d) =>
          d.id === deal.id ? { ...d, tag: 'bad_lead' } : d,
        ),
      )
      setSelected(null)
      return { success: true }
    },
    [deals, selected, selectedCountyId],
  )

  const handleRestoreOwner = useCallback(
    async (owner: OwnerLike) => {
      const deal = deals.find((d) => d.id === owner.id) ?? selected
      if (!deal) return { success: false, error: 'Deal not found' }

      const countyId = (() => {
        const d = getDealCounty(deal)
        return d === 'unknown' ? selectedCountyId : d
      })()

      const { error } = await supabase
        .from('deals')
        .update({
          tag: 'prospect',
          updated_at: new Date().toISOString(),
        })
        .eq('id', deal.id)
      if (error) return { success: false, error: error.message }

      await deleteOwnerOverride({
        countyId,
        ownerName: deal.owner_name,
        abstract: deal.tract_abstract,
      })

      setDeals((prev) =>
        prev.map((d) =>
          d.id === deal.id ? { ...d, tag: 'prospect' } : d,
        ),
      )
      setSelected((prev) =>
        prev?.id === deal.id ? ({ ...prev, tag: 'prospect' } as Deal) : prev,
      )
      return { success: true }
    },
    [deals, selected, selectedCountyId],
  )

  // Memoize the Deal -> OwnerLike mapping so we hand OwnerDrawer a
  // STABLE reference across CRM re-renders. The drawer's internal
  // hooks (useOwnerHoldings, useOwnerWells, useOwnerNote) all have
  // `owner` in their useEffect dependency arrays; passing a fresh
  // object literal every render (e.g. `owner={dealToOwner(selected)}`
  // inline) makes those effects re-fire on every parent re-render,
  // which cancels the in-flight Leases fetch before it can set state.
  // Result: the Leases tab shows "0 leases" forever even though the
  // Supabase query would have returned data. Reported 2026-07-21;
  // Contact fields are included so Update owner / skip-trace patches
  // refresh the drawer without remounting holdings.
  const drawerOwner: OwnerLike | null = useMemo(
    () => (selected ? dealToOwner(selected) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selected?.id,
      selected?.phone,
      selected?.email,
      selected?.mailing_address,
      selected?.mailing_city,
      selected?.mailing_state,
      selected?.mailing_zip,
      selected?.tag,
    ],
  )

  return (
    <div className="h-screen flex flex-col bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center gap-3 px-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3 shrink-0">
          <AppLogo width={130} variant="light" />
          <span className="text-gray-300 text-sm">·</span>
          <span className="text-sm font-medium text-gray-400">CRM</span>
        </div>
        <div className="flex-1 flex justify-center min-w-0 px-2">
          <CrmGlobalSearch deals={deals} onSelect={openLead} />
        </div>
        <nav className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setView('dashboard')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              view === 'dashboard'
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setView('leads')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              view === 'leads'
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            Leads
          </button>
          <button
            type="button"
            onClick={() => setView('calendar')}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              view === 'calendar'
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            Calendar
          </button>
          <span className="w-px h-4 bg-gray-700" aria-hidden="true" />
          <Link href="/" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">
            <MapPin size={13} />Map
          </Link>
        </nav>
      </header>

      {view === 'dashboard' ? (
        <CrmDashboard
          deals={deals}
          onOpenLead={openLead}
          onOpenFilter={openLeadsFilter}
          onOpenCalendar={() => setView('calendar')}
        />
      ) : view === 'calendar' ? (
        <CrmCalendar deals={deals} onOpenLead={openLead} onSetFollowUp={handleSetFollowUp} />
      ) : (
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — leads list, search, filter chips, county filter.
            Preserved from the previous CRM layout because it was already
            the good part; the middle+right panels are what got nuked. */}
        <aside className="w-[260px] shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-200 bg-white">
            <div className="grid grid-cols-3 gap-1">
              {[
                { label: 'Total', val: deals.length },
                { label: 'Hot', val: deals.filter((d) => (d.tag ?? 'prospect') === 'hot').length, color: 'text-red-600' },
                { label: 'Follow up', val: deals.filter((d) => d.follow_up_date && isOverdue(d.follow_up_date)).length, color: 'text-amber-600' },
              ].map((s) => (
                <div key={s.label} className="text-center py-1">
                  <div className={`text-base font-bold font-serif ${s.color ?? 'text-gray-900'}`}>{s.val}</div>
                  <div className="text-xs text-gray-400">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="p-3 border-b border-gray-100">
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter this list..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 focus:bg-white transition-all"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {['all', ...Object.keys(TAG_CONFIG)].map((tag) => (
                <button
                  key={tag}
                  onClick={() => setActiveTag(tag)}
                  className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
                    activeTag === tag
                      ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {tag === 'all' ? 'All' : TAG_CONFIG[tag]?.label}
                  {tag !== 'all' && (
                    <span className="ml-1 text-gray-400">{deals.filter((d) => (d.tag ?? 'prospect') === tag).length}</span>
                  )}
                </button>
              ))}
            </div>
            {extraFiltersOn && (
              <div className="mt-2 flex items-center gap-1 flex-wrap">
                {followUpFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-700">
                    {followUpFilter === 'overdue' ? 'Overdue follow-up' : 'Upcoming follow-up'}
                  </span>
                )}
                {needContact && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-gray-100 border border-gray-200 text-gray-600">
                    Need skip trace
                  </span>
                )}
                <button
                  type="button"
                  onClick={clearExtraFilters}
                  className="text-xs text-gray-500 hover:text-gray-800 underline"
                >
                  Clear
                </button>
              </div>
            )}
            <div className="mt-2">
              <label className="sr-only" htmlFor="crm-county-filter">County</label>
              <div className="relative">
                <MapPin
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
                <select
                  id="crm-county-filter"
                  value={countyFilter}
                  onChange={(e) => setCountyFilter(e.target.value as typeof countyFilter)}
                  className="w-full appearance-none pl-8 pr-7 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-md text-gray-700 hover:border-gray-300 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-colors"
                >
                  <option value="all">All Counties ({deals.length})</option>
                  {(Object.entries(COUNTIES) as Array<[CountyKey, County]>).map(([countyId, county]) => {
                    const count = deals.filter((d) => getDealCounty(d) === countyId).length
                    return (
                      <option key={countyId} value={countyId}>
                        {county.name} ({count})
                      </option>
                    )
                  })}
                </select>
                <svg
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                  width="10" height="10" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>
          </div>

          <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-100 font-semibold">
            {filtered.length} leads
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-sm text-gray-400">No leads found</div>
              </div>
            ) : filtered.map((deal) => (
              <button
                key={deal.id}
                onClick={() => setSelected(deal)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  selected?.id === deal.id ? 'bg-white border-l-2 border-l-amber-500 shadow-sm' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900 leading-tight">{deal.owner_name}</span>
                  <TagBadge tag={deal.tag ?? 'prospect'} />
                </div>
                <div className="text-xs text-gray-400 mb-1">
                  {deal.tract_abstract ?? '--'} · {deal.operator_name ?? '--'}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  {deal.mailing_city && <span>{deal.mailing_city}, {deal.mailing_state}</span>}
                  {deal.acreage ? <span>{deal.acreage} ac</span> : null}
                </div>
                {deal.follow_up_date && (
                  <div className={`mt-1.5 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
                    isOverdue(deal.follow_up_date)
                      ? 'bg-red-50 text-red-600'
                      : 'bg-amber-50 text-amber-600'
                  }`}>
                    <Clock size={10} />
                    {formatDate(deal.follow_up_date)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* Main content — full-screen OwnerDrawer view when a lead is
            selected, empty state otherwise. OwnerDrawer fills whatever
            container we give it via `flex flex-1 h-full`, so a plain
            flex parent is all we need. */}
        <main className="flex-1 overflow-hidden flex bg-white">
          {selected && drawerOwner ? (
            <OwnerDrawer
              open={true}
              owner={drawerOwner}
              countyId={selectedCountyId}
              tractLabel={selected?.tract_abstract ?? null}
              tractLegalDescription={
                [
                  selected?.surv_name ?? selected?.tract_survey,
                  selected?.block ? `BLK ${selected.block}` : null,
                  selected?.surv_sect ? `SEC ${selected.surv_sect}` : null,
                  selected?.tract_abstract ?? null,
                ]
                  .filter(Boolean)
                  .join(' ') || null
              }
              inPipeline={true}
              crmMode={true}
              dealStatus={selected?.tag ?? null}
              onSetStatus={handleSetStatus}
              ownerIsHidden={(selected?.tag ?? '') === 'bad_lead'}
              onClose={() => setSelected(null)}
              onSkipTrace={handleSkipTrace}
              onAddToPipeline={handleAddToPipeline}
              onSaveOwnerDetails={handleSaveOwnerDetails}
              onRemoveOwner={handleRemoveOwner}
              onRestoreOwner={handleRestoreOwner}
            />
          ) : (
            <div className="h-full flex items-center justify-center flex-1">
              <div className="text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <User size={20} className="text-gray-400" />
                </div>
                <div className="text-sm font-medium text-gray-500">Select a lead</div>
                <div className="text-xs text-gray-400 mt-1">Choose a lead from the list to view details and skip trace.</div>
              </div>
            </div>
          )}
        </main>
      </div>
      )}
    </div>
  )
}
