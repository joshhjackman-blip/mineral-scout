'use client'

// CRM — leads list + full-screen owner detail view.
//
// Redesigned 2026-07-20 (user ask): "I want the CRM to be the same
// as the overview when you click on a lead. Just with everything on
// one full screen. All leads are in the CRM, the only thing that is
// needed is the user to skiptrace."
//
// So the CRM is now a two-panel view:
//   Left  — filterable / searchable leads list, one row per Deal.
//   Right — full-height OwnerDrawer (the same component that pops
//           over the map when you click an owner) rendered as the
//           main content instead of a bottom drawer.
//
// The pipeline / PSA / deed / tasks / activity-log UI was removed
// because none of it was pulling weight now that Skip Trace is the
// only action a broker takes on this screen. The `deals` table
// schema is preserved (skip trace still writes phone/email/tag/
// county back to the deal row) so we can re-introduce pipeline
// features later without a data migration.

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

export const dynamic = 'force-dynamic'

// ─── Types ────────────────────────────────────────────────────────────────

type Deal = {
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
  created_at?: string | null
  updated_at?: string | null
}

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
}

const TagBadge = ({ tag }: { tag: string }) => {
  const cfg = TAG_CONFIG[tag] ?? TAG_CONFIG.prospect
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color} whitespace-nowrap`}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

const isOverdue = (date: string) => new Date(date) < new Date()

const formatDate = (date: string) => {
  const d = new Date(date)
  const today = new Date()
  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  return `in ${diff}d`
}

// ─── County derivation ────────────────────────────────────────────────────

type DealCounty = CountyKey | 'unknown'
const KNOWN_COUNTY_IDS = new Set<CountyKey>(Object.keys(COUNTIES) as CountyKey[])

// Deals carry a `county` column when they were added to the pipeline
// from the map, but legacy rows may not. Fall back to matching the
// operator name against every county's operatorPatterns list — the
// same pattern the old CRM used so nothing regresses.
const getDealCounty = (deal: Deal): DealCounty => {
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
  rrc_lease_id: deal.rrc_lease_id,
})

// ─── Component ────────────────────────────────────────────────────────────

export default function CRM() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [selected, setSelected] = useState<Deal | null>(null)
  const [activeTag, setActiveTag] = useState('all')
  const [countyFilter, setCountyFilter] = useState<'all' | CountyKey>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.from('deals').select('*').order('updated_at', { ascending: false }).then(({ data }) => {
      setDeals((data as Deal[]) ?? [])
    })
  }, [])

  const filtered = useMemo(() => deals.filter((d) => {
    if (activeTag !== 'all' && (d.tag ?? 'prospect') !== activeTag) return false
    if (countyFilter !== 'all' && getDealCounty(d) !== countyFilter) return false
    if (
      search &&
      !(d.owner_name ?? '').toLowerCase().includes(search.toLowerCase()) &&
      !(d.operator_name ?? '').toLowerCase().includes(search.toLowerCase())
    ) return false
    return true
  }), [deals, activeTag, countyFilter, search])

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
      const phone = result.phones?.[0] ?? null
      const email = result.emails?.[0] ?? null

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
        tag: 'skip_traced',
        updated_at: new Date().toISOString(),
      }
      if (!deal.county && derivedCounty) updatePayload.county = derivedCounty

      await supabase.from('deals').update(updatePayload).eq('id', deal.id)
      const patch: Partial<Deal> = { phone, email, tag: 'skip_traced', county: deal.county ?? derivedCounty ?? null }
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
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <AppLogo width={130} variant="light" />
          <span className="text-gray-300 text-sm">·</span>
          <span className="text-sm font-medium text-gray-400">CRM</span>
        </div>
        <nav className="flex items-center gap-1">
          <Link href="/" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">
            <MapPin size={13} />Map
          </Link>
        </nav>
      </header>

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
                placeholder="Search owners, operators..."
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
              inPipeline={true}
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
    </div>
  )
}
