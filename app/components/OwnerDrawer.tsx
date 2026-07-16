'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CountyKey, County } from '@/lib/counties'
import { COUNTIES } from '@/lib/counties'

// A CRM-style detail panel for a mineral owner. Renders as an inline
// flex sibling below the map+sidebar row (not a modal overlay) so the
// map above stays fully usable while the user works the call. The
// parent (app/page.tsx) is responsible for reserving the vertical
// space and collapsing the tract sidebar when this panel is open.
//
// Design matches app/crm/page.tsx: white cards, thin gray borders,
// rounded-xl, uppercase micro-labels ("QUICK ACTIONS", "NOTES", …),
// amber accents on the CTAs. The drawer intentionally avoids
// hand-rolled inline color themes and leans on Tailwind classes so
// visual drift with the CRM stays low.

export type OwnerLike = {
  id?: string | number
  owner_name: string
  propensity_score?: number
  operator_name?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  address_1?: string | null
  mailing_address?: string | null
  out_of_state?: boolean
  motivated?: boolean
  acreage?: number | null
  ownership_pct?: number | null
  decimal_interest?: number | null
  interest_type?: string | null
  prod_cumulative_sum_oil?: number | null
  phone?: string | null
  email?: string | null
  rrc_lease_id?: string | number | null
  sptb_code?: string | null
}

export type OwnerDrawerHolding = {
  id?: string | number
  abstract?: string | null
  county_lease_name?: string | null
  field_name?: string | null
  operator_name?: string | null
  acreage?: number | null
  ownership_pct?: number | null
  decimal_interest?: number | null
  rrc_lease_id?: string | number | null
  interest_type?: string | null
  propensity_score?: number | null
  // Which county the row was pulled from. Added client-side after the
  // per-county fetch so the Leases tab can group rows by county.
  county_id?: CountyKey
}

export type OwnerDrawerWell = {
  api_number?: string | null
  well_type?: string | null
  oil_gas_code?: string | null
  operator_name?: string | null
  lease_name?: string | null
  rrc_lease_id?: string | number | null
  well_status?: string | null
  latitude?: number | null
  longitude?: number | null
  // Populated client-side after the per-county fan-out so the Wells
  // tab can group rows by county the same way the Leases tab does.
  county_id?: CountyKey
}

export type DevelopmentStatusValue =
  | 'PDP'
  | 'PUD_DUC'
  | 'PUD_PERMITTED'
  | 'PUD_INFILL'
  | 'LEASING_ACTIVE'
  | 'FRONTIER'

export type DevStatusSignalDetail = {
  permits?: Array<{
    permit_number?: string | null
    api?: string | null
    operator?: string | null
    lease?: string | null
    status?: string | null
    approved_date?: string | null
    spud_date?: string | null
  }>
  ducs?: Array<{
    api?: string | null
    operator?: string | null
    lease?: string | null
    spud_date?: string | null
    status?: string | null
    source?: string | null
  }>
  adjacent_permits?: Array<{ operator?: string | null; count?: number }>
  adjacent_permit_count?: number
  infill_gaps?: number
  leases?: unknown[]
}

export type TractDevStatus = {
  development_status: DevelopmentStatusValue
  pud_score: number
  signal_detail?: DevStatusSignalDetail
  last_computed?: string
}

export type OwnerDrawerProps = {
  open: boolean
  owner: OwnerLike | null
  tractLabel?: string | null
  tractLegalDescription?: string | null
  countyId: CountyKey
  inPipeline?: boolean
  onClose: () => void
  onSkipTrace: (owner: OwnerLike) => void
  onAddToPipeline: (owner: OwnerLike) => void
  onShowAllTracts?: (owner: OwnerLike) => void
  legalDescByAbstract?: Record<string, string>
  // Ticket 1.3 dev-lifecycle status for the tract the owner is on.
  // Missing / undefined -> render a subtle "no status computed yet" chip.
  tractDevStatus?: TractDevStatus | null
}

const ROYALTY_ESTIMATE_BOE_PRICE = 65

function clean(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value).trim()
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'none') return ''
  return text
}

function toNumber(value: unknown): number | null {
  const text = clean(value)
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function displayNumber(value: unknown, decimals = 2): string | null {
  const n = toNumber(value)
  if (n == null) return null
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function ownershipPctValue(value: unknown, ownershipIsDecimal: boolean): number | null {
  const n = toNumber(value)
  if (n == null) return null
  return ownershipIsDecimal ? n * 100 : n
}

function formatPhone(raw: string | null | undefined): { display: string; href: string } | null {
  const text = clean(raw)
  if (!text) return null
  const digits = text.replace(/\D/g, '')
  if (digits.length < 10) return { display: text, href: `tel:${digits || text}` }
  const last10 = digits.slice(-10)
  return {
    display: `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`,
    href: `tel:+1${last10}`,
  }
}

function formatEmail(raw: string | null | undefined): { display: string; href: string } | null {
  const text = clean(raw)
  if (!text || !/.+@.+\..+/.test(text)) return null
  return { display: text, href: `mailto:${text}` }
}

function abstractKey(raw: unknown): string {
  const text = clean(raw)
  if (!text) return ''
  return text.replace(/^A-\s*/i, '').trim()
}

function useOwnerHoldings(county: County, owner: OwnerLike | null, open: boolean) {
  // Cross-county holdings. Every county the platform knows about
  // (COUNTIES in lib/counties.ts) is queried in parallel; results are
  // merged, tagged with county_id, and sorted with the drawer's
  // active county first. This is the "broker calls one lead → sees
  // every interest they own across all our data" behavior the user
  // asked for on 2026-07-16.
  const [holdings, setHoldings] = useState<OwnerDrawerHolding[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMessages, setErrorMessages] = useState<Array<{ county: CountyKey; message: string }>>([])

  useEffect(() => {
    if (!open || !owner) {
      setHoldings([])
      setErrorMessages([])
      return
    }
    let cancelled = false
    setLoading(true)
    setErrorMessages([])

    const countyEntries = Object.entries(COUNTIES) as Array<[CountyKey, County]>
    const perCountyPromises = countyEntries.map(async ([countyKey, cfg]) => {
      const result = await supabase
        .from(cfg.ownershipTable)
        .select('id, abstract, county_lease_name, field_name, operator_name, acreage, ownership_pct, decimal_interest, rrc_lease_id, interest_type')
        .eq('owner_name', owner.owner_name)
        .order('acreage', { ascending: false })
        .limit(500)
      if (result.error) {
        return { countyKey, rows: [] as OwnerDrawerHolding[], error: result.error.message }
      }
      const rows = ((result.data ?? []) as OwnerDrawerHolding[]).map((r) => ({ ...r, county_id: countyKey }))
      return { countyKey, rows, error: null as string | null }
    })

    Promise.all(perCountyPromises).then((results) => {
      if (cancelled) return
      const merged: OwnerDrawerHolding[] = []
      const errs: Array<{ county: CountyKey; message: string }> = []
      for (const r of results) {
        if (r.error) {
          const msg = r.error.toLowerCase()
          // Ignore "table does not exist" errors for counties whose
          // ownership table hasn't landed yet (e.g., the 10 new
          // Permian counties). Any other error surfaces in the UI.
          if (!msg.includes('not find') && !msg.includes('does not exist')) {
            errs.push({ county: r.countyKey, message: r.error })
          }
          continue
        }
        merged.push(...r.rows)
      }
      // Sort with the currently-active county first (broker's focus
      // stays on-screen), then by acreage desc within each county so
      // the largest holdings sit at the top.
      const activeCountyId = county.id as CountyKey
      merged.sort((a, b) => {
        const activeA = a.county_id === activeCountyId ? 0 : 1
        const activeB = b.county_id === activeCountyId ? 0 : 1
        if (activeA !== activeB) return activeA - activeB
        const acA = Number(a.acreage ?? 0)
        const acB = Number(b.acreage ?? 0)
        return acB - acA
      })
      setHoldings(merged)
      setErrorMessages(errs)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [open, owner, county.id])

  return { holdings, loading, errorMessages }
}

function useOwnerWells(
  county: County,
  owner: OwnerLike | null,
  tractLabel: string | null | undefined,
  holdings: OwnerDrawerHolding[],
  open: boolean,
) {
  // Cross-county well fan-out. Fires one /api/wells call per county
  // and merges. Uses each county's rrc_lease_ids from the merged
  // holdings when available (holdings are cross-county already), so
  // Martin permits for a Gonzales-clicked owner still surface here.
  const [wells, setWells] = useState<OwnerDrawerWell[]>([])
  const [loading, setLoading] = useState(false)

  // Per-county sets of lease IDs, computed once holdings arrive.
  const leaseIdsByCounty = useMemo(() => {
    const byCounty: Record<string, string[]> = {}
    if (owner?.rrc_lease_id != null && county.id) {
      byCounty[county.id] = [String(owner.rrc_lease_id)]
    }
    for (const h of holdings) {
      if (!h.county_id || h.rrc_lease_id == null) continue
      const c = h.county_id as string
      byCounty[c] = byCounty[c] ?? []
      byCounty[c].push(String(h.rrc_lease_id))
    }
    return byCounty
  }, [owner?.rrc_lease_id, holdings, county.id])

  useEffect(() => {
    if (!open || !owner) {
      setWells([])
      return
    }
    let cancelled = false
    setLoading(true)

    const countyEntries = Object.entries(COUNTIES) as Array<[CountyKey, County]>
    const requests = countyEntries.map(async ([countyKey]) => {
      const leaseIds = leaseIdsByCounty[countyKey] ?? []
      const body: Record<string, unknown> = {
        countyId: countyKey,
        mode: 'owner',
        ownerName: owner.owner_name,
        // Only pass leaseId / abstract to the currently-active county
        // (the two hints only make sense in the context that surfaced
        // the tract click). Other counties get the pure owner-name
        // lookup so we catch cross-county leases the drawer didn't
        // know about at click time.
        leaseId: countyKey === county.id && owner.rrc_lease_id != null ? String(owner.rrc_lease_id) : '',
        leaseIds,
        abstract: countyKey === county.id && tractLabel ? tractLabel.replace(/^A-\s*/i, '') : '',
        operator: countyKey === county.id ? (owner.operator_name ?? null) : null,
      }
      try {
        const response = await fetch('/api/wells', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        // /api/wells returns 401 for unauthed sessions; treat that as
        // "just no rows" so the tab still renders.
        if (!response.ok) return { countyKey, wells: [] as OwnerDrawerWell[] }
        const payload = (await response.json()) as { wells?: OwnerDrawerWell[] }
        const rows = Array.isArray(payload.wells) ? payload.wells : []
        return {
          countyKey,
          wells: rows.map((w) => ({ ...w, county_id: countyKey })),
        }
      } catch {
        return { countyKey, wells: [] as OwnerDrawerWell[] }
      }
    })

    void Promise.all(requests).then((results) => {
      if (cancelled) return
      const merged: OwnerDrawerWell[] = []
      for (const r of results) merged.push(...r.wells)
      // Sort with the active county first, then by well_type
      // (HORIZONTAL first — most brokers care about drilled laterals).
      const activeCountyId = county.id as string
      merged.sort((a, b) => {
        const activeA = a.county_id === activeCountyId ? 0 : 1
        const activeB = b.county_id === activeCountyId ? 0 : 1
        if (activeA !== activeB) return activeA - activeB
        const hA = String(a.well_type ?? '').toUpperCase() === 'HORIZONTAL' ? 0 : 1
        const hB = String(b.well_type ?? '').toUpperCase() === 'HORIZONTAL' ? 0 : 1
        return hA - hB
      })
      setWells(merged)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [county.id, open, owner, tractLabel, leaseIdsByCounty])

  return { wells, loading }
}

// Autosave-on-blur note storage against public.owner_notes. Falls back
// to in-memory state if the table doesn't exist yet (before the
// migration is applied) so the drawer never crashes.
function useOwnerNote(county: County, owner: OwnerLike | null, open: boolean) {
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !owner) {
      setNote('')
      setSavedAt(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    supabase
      .from('owner_notes')
      .select('note, updated_at')
      .eq('county_id', county.id)
      .eq('owner_name', owner.owner_name)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          const msg = err.message.toLowerCase()
          if (msg.includes('not find') || msg.includes('does not exist')) {
            setError('owner_notes table not yet created — run the migration to enable persisted notes.')
          } else {
            setError(err.message)
          }
          setNote('')
        } else if (data) {
          setNote(String((data as { note?: string }).note ?? ''))
          setSavedAt(data.updated_at ? new Date(String(data.updated_at)) : null)
          setError(null)
        } else {
          setNote('')
          setSavedAt(null)
          setError(null)
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [county.id, open, owner])

  const save = async (value: string) => {
    if (!owner) return
    setSaving(true)
    const { error: err } = await supabase
      .from('owner_notes')
      .upsert(
        {
          county_id: county.id,
          owner_name: owner.owner_name,
          note: value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'county_id,owner_name' },
      )
    setSaving(false)
    if (err) {
      const msg = err.message.toLowerCase()
      setError(msg.includes('not find') || msg.includes('does not exist')
        ? 'owner_notes table not yet created — run the migration to persist notes.'
        : err.message)
    } else {
      setError(null)
      setSavedAt(new Date())
    }
  }

  return { note, setNote, loading, saving, savedAt, error, save }
}

function ownerBadges(owner: OwnerLike): Array<{ label: string; classes: string }> {
  const badges: Array<{ label: string; classes: string }> = []
  const name = (owner.owner_name || '').toUpperCase()
  if (owner.out_of_state) {
    badges.push({ label: 'Out of state', classes: 'bg-amber-50 text-amber-700 border-amber-200' })
  }
  if (name.includes('LIFE ESTATE')) {
    badges.push({ label: 'Life estate', classes: 'bg-amber-50 text-amber-800 border-amber-200' })
  } else if (name.includes('ESTATE')) {
    badges.push({ label: 'Estate', classes: 'bg-amber-50 text-amber-800 border-amber-200' })
  }
  if (name.includes('IRREVOCABLE')) {
    badges.push({ label: 'Irrevocable trust', classes: 'bg-indigo-50 text-indigo-700 border-indigo-200' })
  } else if (name.includes('LIVING TRUST') || name.includes('LIV TR')) {
    badges.push({ label: 'Living trust', classes: 'bg-indigo-50 text-indigo-700 border-indigo-200' })
  } else if (name.includes('TRUST')) {
    badges.push({ label: 'Trust', classes: 'bg-indigo-50 text-indigo-700 border-indigo-200' })
  }
  if (name.includes('LLC') || name.includes(' LP') || name.includes('INC')) {
    badges.push({ label: 'Entity', classes: 'bg-slate-100 text-slate-700 border-slate-200' })
  } else if (badges.every((b) => !['Trust', 'Estate', 'Life estate', 'Irrevocable trust', 'Living trust'].includes(b.label))) {
    badges.push({ label: 'Individual', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' })
  }
  return badges
}

export default function OwnerDrawer(props: OwnerDrawerProps) {
  const {
    open, owner, tractLabel, tractLegalDescription, countyId, inPipeline,
    onClose, onSkipTrace, onAddToPipeline, onShowAllTracts, legalDescByAbstract,
    tractDevStatus,
  } = props

  const county = COUNTIES[countyId]
  const {
    holdings,
    loading: holdingsLoading,
    errorMessages: holdingsErrors,
  } = useOwnerHoldings(county, owner, open)
  const uniqueHoldingCounties = useMemo(() => {
    const set = new Set<string>()
    for (const h of holdings) if (h.county_id) set.add(h.county_id as string)
    return set.size
  }, [holdings])
  const { wells, loading: wellsLoading } = useOwnerWells(county, owner, tractLabel, holdings, open)
  const {
    note, setNote, loading: noteLoading, saving: noteSaving,
    savedAt: noteSavedAt, error: noteError, save: saveNote,
  } = useOwnerNote(county, owner, open)

  const [tab, setTab] = useState<'overview' | 'holdings' | 'wells' | 'notes'>('overview')

  useEffect(() => {
    if (open) setTab('overview')
  }, [open, owner?.owner_name])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !owner) return null

  const phone = formatPhone(owner.phone)
  const email = formatEmail(owner.email)
  const badges = ownerBadges(owner)
  const ownershipPct = ownershipPctValue(
    owner.ownership_pct ?? owner.decimal_interest,
    county.ownershipPctIsDecimal,
  )
  const acreage = displayNumber(owner.acreage)
  const nra = (ownershipPct != null && owner.acreage != null)
    ? Number(owner.acreage) * (ownershipPct / 100)
    : null
  const cumOil = Number(owner.prod_cumulative_sum_oil ?? 0)
  const royaltyEstimate = (ownershipPct != null && cumOil > 0)
    ? Math.round((cumOil * (ownershipPct / 100) * ROYALTY_ESTIMATE_BOE_PRICE) / 12)
    : null
  const rrcLease = clean(owner.rrc_lease_id)
  const address = [
    clean(owner.address_1) || clean(owner.mailing_address),
    [clean(owner.mailing_city), clean(owner.mailing_state)].filter(Boolean).join(', '),
    clean(owner.mailing_zip),
  ].filter(Boolean).join(' · ')
  return (
    <div
      className="flex flex-col bg-white border-t border-gray-200 shadow-[0_-8px_28px_rgba(15,23,42,0.10)]"
      role="dialog"
      aria-label={`Details for ${owner.owner_name}`}
      style={{ minHeight: 0 }}
    >
      <header className="flex items-start gap-4 px-6 py-4 border-b border-gray-100">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-serif font-bold text-gray-900 truncate">
              {owner.owner_name}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {tractLabel && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-slate-700">
                {tractLegalDescription || tractLabel}
              </span>
            )}
            {rrcLease && (
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-700">
                Lease #{rrcLease}
              </span>
            )}
            {tractDevStatus && (
              <DevStatusPill status={tractDevStatus.development_status} score={tractDevStatus.pud_score} />
            )}
            {badges.map((b) => (
              <span key={b.label} className={`rounded-full border px-2 py-0.5 ${b.classes}`}>
                {b.label}
              </span>
            ))}
          </div>
          {address && (
            <div className="mt-2 text-xs text-gray-500">{address}</div>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
          aria-label="Close owner details"
        >
          ×
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-3">
        <ContactPill
          icon="📞"
          label={phone ? phone.display : 'No phone on file'}
          href={phone?.href}
          disabled={!phone}
        />
        <ContactPill
          icon="✉︎"
          label={email ? email.display : 'No email on file'}
          href={email?.href}
          disabled={!email}
        />
        <button
          onClick={() => onSkipTrace(owner)}
          className="inline-flex items-center gap-2 rounded-md bg-gradient-to-b from-amber-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow hover:from-amber-500 hover:to-amber-700"
        >
          ⚡ Skip trace
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onAddToPipeline(owner)}
          className={`rounded-md border px-4 py-2 text-sm font-semibold transition-colors ${
            inPipeline
              ? 'border-lime-300 bg-lime-50 text-lime-700 hover:bg-lime-100'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {inPipeline ? '✓ In pipeline' : '+ Add to pipeline'}
        </button>
        {onShowAllTracts && (
          <button
            onClick={() => onShowAllTracts(owner)}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Show all tracts
          </button>
        )}
      </div>

      <nav className="flex items-center gap-1 border-b border-gray-100 px-6 pt-2">
        {[
          { key: 'overview' as const, label: 'Overview' },
          {
            key: 'holdings' as const,
            label: holdingsLoading
              ? 'Leases (…)'
              : uniqueHoldingCounties > 1
                ? `Leases (${holdings.length} · ${uniqueHoldingCounties} counties)`
                : `Leases (${holdings.length || 0})`,
          },
          {
            key: 'wells' as const,
            label: (() => {
              if (wellsLoading) return 'Wells (…)'
              const c = new Set(wells.map((w) => w.county_id).filter(Boolean))
              return c.size > 1
                ? `Wells (${wells.length} · ${c.size} counties)`
                : `Wells (${wells.length || 0})`
            })(),
          },
          { key: 'notes'    as const, label: 'Notes' },
        ].map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                active
                  ? 'border-amber-500 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </nav>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === 'overview' && (
          <OverviewPanel
            owner={owner}
            ownershipPct={ownershipPct}
            acreage={acreage}
            nra={nra}
            royaltyEstimate={royaltyEstimate}
            cumOil={cumOil}
            tractLabel={tractLabel ?? null}
            tractLegalDescription={tractLegalDescription ?? null}
            rrcLease={rrcLease}
            county={county}
            tractDevStatus={tractDevStatus ?? null}
          />
        )}
        {tab === 'holdings' && (
          <HoldingsPanel
            holdings={holdings}
            loading={holdingsLoading}
            county={county}
            legalDescByAbstract={legalDescByAbstract}
            errorMessages={holdingsErrors}
          />
        )}
        {tab === 'wells' && (
          <WellsPanel wells={wells} loading={wellsLoading} county={county} />
        )}
        {tab === 'notes' && (
          <NotesPanel
            value={note}
            loading={noteLoading}
            saving={noteSaving}
            savedAt={noteSavedAt}
            error={noteError}
            onChange={setNote}
            onBlur={() => { void saveNote(note) }}
          />
        )}
      </div>
    </div>
  )
}

function ContactPill({
  icon, label, href, disabled,
}: {
  icon: string
  label: string
  href?: string
  disabled: boolean
}) {
  if (disabled || !href) {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-dashed border-gray-200 bg-white px-4 py-2 text-sm text-gray-400">
        <span aria-hidden>{icon}</span>
        {label}
      </span>
    )
  }
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
    >
      <span aria-hidden>{icon}</span>
      {label}
    </a>
  )
}

function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</div>
      <div className="mt-1 font-serif text-2xl font-bold text-gray-900">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-gray-500">{hint}</div>}
    </div>
  )
}

function SectionCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{title}</div>
        {action}
      </div>
      <div className="flex flex-col gap-2 text-sm text-gray-800">{children}</div>
    </div>
  )
}

function KVRow({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3">
      <div className="text-xs text-gray-500">{k}</div>
      <div className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>{v}</div>
    </div>
  )
}

function OverviewPanel({
  owner, ownershipPct, acreage, nra, royaltyEstimate, cumOil,
  tractLabel, tractLegalDescription, rrcLease, county, tractDevStatus,
}: {
  owner: OwnerLike
  ownershipPct: number | null
  acreage: string | null
  nra: number | null
  royaltyEstimate: number | null
  cumOil: number
  tractLabel: string | null
  tractLegalDescription: string | null
  rrcLease: string
  county: County
  tractDevStatus: TractDevStatus | null
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <StatCard
          label="Ownership %"
          value={ownershipPct != null ? `${ownershipPct.toFixed(4)}%` : '—'}
          hint={ownershipPct != null ? `Decimal: ${(ownershipPct / 100).toFixed(6)}` : undefined}
        />
        <StatCard
          label="Gross acres"
          value={acreage ?? '—'}
          hint={owner.interest_type ? `Interest: ${owner.interest_type}` : undefined}
        />
        <StatCard
          label="Net royalty acres"
          value={nra != null ? nra.toFixed(nra < 1 ? 3 : 2) : '—'}
        />
        <StatCard
          label="Est. royalty"
          value={royaltyEstimate != null ? `$${royaltyEstimate.toLocaleString()}/mo` : '—'}
          hint={cumOil > 0 ? `Cum. oil: ${cumOil.toLocaleString()} bbl` : 'No production on file'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SectionCard title="Contact snapshot">
          <KVRow k="Owner name" v={owner.owner_name} mono />
          <KVRow
            k="Mailing address"
            v={
              [
                owner.address_1 || owner.mailing_address,
                [owner.mailing_city, owner.mailing_state, owner.mailing_zip].filter(Boolean).join(' '),
              ].filter(Boolean).join(' · ') || 'Not on file'
            }
          />
          <KVRow k="Phone" v={owner.phone || 'Not on file — run skip trace above'} />
          <KVRow k="Email" v={owner.email || 'Not on file — run skip trace above'} />
        </SectionCard>

        <SectionCard title="Lease context">
          <KVRow
            k="Legal description"
            v={tractLegalDescription || tractLabel || 'Selected tract'}
            mono
          />
          <KVRow k="RRC lease" v={rrcLease || 'Not linked'} mono />
          <KVRow k="Operator" v={clean(owner.operator_name) || 'Unknown operator'} />
          <KVRow k="County" v={county.displayName} />
          {clean(owner.sptb_code) && (
            <KVRow k="Interest code" v={owner.sptb_code ?? ''} mono />
          )}
        </SectionCard>
      </div>

      {tractDevStatus && <DevStatusCard status={tractDevStatus} />}
      {tractDevStatus && <DevTimeline status={tractDevStatus} />}
      {tractDevStatus && <OutreachTemplateCard owner={owner} status={tractDevStatus} county={county} />}
    </div>
  )
}

function HoldingsPanel({
  holdings, loading, county, legalDescByAbstract, errorMessages,
}: {
  holdings: OwnerDrawerHolding[]
  loading: boolean
  county: County
  legalDescByAbstract: Record<string, string> | undefined
  errorMessages?: Array<{ county: CountyKey; message: string }>
}) {
  if (loading) {
    return <div className="text-sm text-gray-500">Loading leases across all counties…</div>
  }
  if (holdings.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No matching rows found in any county&apos;s mineral ownership table.
      </div>
    )
  }

  // Group holdings by county so the drawer surfaces "3 leases in Howard,
  // 1 in Martin" at a glance. Currently-active county comes first.
  const byCounty: Partial<Record<CountyKey, OwnerDrawerHolding[]>> = {}
  for (const h of holdings) {
    const key = (h.county_id ?? (county.id as CountyKey)) as CountyKey
    if (!byCounty[key]) byCounty[key] = []
    byCounty[key]!.push(h)
  }
  const activeCountyId = county.id as CountyKey
  const orderedCountyKeys: CountyKey[] = [
    activeCountyId,
    ...Object.keys(byCounty).filter((k) => k !== activeCountyId) as CountyKey[],
  ].filter((k, i, arr) => arr.indexOf(k) === i && byCounty[k])

  const totalCounties = orderedCountyKeys.length
  const totalLeases = holdings.length

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
        <span className="font-semibold">{totalLeases}</span> lease{totalLeases === 1 ? '' : 's'}
        {' '}across{' '}
        <span className="font-semibold">{totalCounties}</span> {totalCounties === 1 ? 'county' : 'counties'}.
        Offer on all of them, not just the one from the map click.
      </div>

      {errorMessages && errorMessages.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          Some counties errored: {errorMessages.map((e) => `${e.county}`).join(', ')}. Retry or check RLS.
        </div>
      )}

      {orderedCountyKeys.map((countyKey) => {
        const rows = byCounty[countyKey] ?? []
        const cfg = COUNTIES[countyKey]
        const isActive = countyKey === activeCountyId
        // Legal descriptions in the current tract's county come from
        // legalDescByAbstract (built by the parent from the loaded
        // TractRecord[]); other counties don't have that pre-built
        // lookup, so we fall back to the bare abstract label.
        return (
          <div key={countyKey} className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div
              className={`flex items-center justify-between border-b border-gray-100 px-4 py-2 ${
                isActive ? 'bg-amber-50/60' : ''
              }`}
            >
              <div className="text-xs font-bold uppercase tracking-widest text-gray-700">
                {cfg.displayName}
                {isActive && (
                  <span className="ml-2 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-900">
                    Active
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-500">
                {rows.length} lease{rows.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="flex flex-col gap-2 p-3">
              {rows.map((h, i) => {
                const bareAbstract = abstractKey(h.abstract)
                const abstractLabel = bareAbstract ? `A-${bareAbstract}` : ''
                const legalDesc = isActive && bareAbstract
                  ? (legalDescByAbstract?.[bareAbstract] || '')
                  : ''
                const ownershipPct = ownershipPctValue(
                  h.ownership_pct ?? h.decimal_interest,
                  cfg.ownershipPctIsDecimal,
                )
                const acres = displayNumber(h.acreage)
                const nra = (ownershipPct != null && h.acreage != null)
                  ? Number(h.acreage) * (ownershipPct / 100)
                  : null
                return (
                  <div
                    key={`${countyKey}-${h.id ?? h.rrc_lease_id ?? i}`}
                    className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.5fr_1fr_0.9fr_1.1fr] md:items-center">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Legal description</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-gray-900">
                          {legalDesc || abstractLabel || 'Unmatched abstract'}
                        </div>
                        {legalDesc && legalDesc !== abstractLabel && abstractLabel && (
                          <div className="mt-0.5 font-mono text-[11px] text-gray-400">{abstractLabel}</div>
                        )}
                        {clean(h.county_lease_name) && (
                          <div className="mt-1 text-xs text-gray-500">Lease: {clean(h.county_lease_name)}</div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Operator</div>
                        <div className="mt-1 text-sm text-gray-900">{clean(h.operator_name) || '—'}</div>
                        {clean(h.field_name) && (
                          <div className="text-xs text-gray-500">{clean(h.field_name)}</div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Interest</div>
                        <div className="mt-1 font-mono text-sm text-gray-900">
                          {ownershipPct != null ? `${ownershipPct.toFixed(4)}%` : '—'}
                        </div>
                        {h.interest_type && (
                          <div className="text-xs text-gray-500">{h.interest_type}</div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Acres / NRA</div>
                        <div className="mt-1 font-mono text-sm text-gray-900">
                          {acres ?? '—'}
                          {nra != null && (
                            <span className="ml-2 text-gray-500">({nra.toFixed(nra < 1 ? 3 : 2)} NRA)</span>
                          )}
                        </div>
                        {h.rrc_lease_id != null && (
                          <div className="text-xs text-gray-500">Lease #{h.rrc_lease_id}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WellsPanel({
  wells, loading, county,
}: {
  wells: OwnerDrawerWell[]
  loading: boolean
  county: County
}) {
  if (loading) {
    return <div className="text-sm text-gray-500">Looking up wells across all counties…</div>
  }
  if (wells.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No wells matched this owner in any county&apos;s wells table.
      </div>
    )
  }

  const activeCountyId = county.id as CountyKey
  const byCounty: Partial<Record<CountyKey, OwnerDrawerWell[]>> = {}
  for (const w of wells) {
    const key = (w.county_id ?? activeCountyId) as CountyKey
    if (!byCounty[key]) byCounty[key] = []
    byCounty[key]!.push(w)
  }
  const orderedCountyKeys: CountyKey[] = [
    activeCountyId,
    ...Object.keys(byCounty).filter((k) => k !== activeCountyId) as CountyKey[],
  ].filter((k, i, arr) => arr.indexOf(k) === i && byCounty[k])

  const totalWells = wells.length
  const totalCounties = orderedCountyKeys.length

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
        <span className="font-semibold">{totalWells}</span> well{totalWells === 1 ? '' : 's'}
        {' '}on this owner across{' '}
        <span className="font-semibold">{totalCounties}</span> {totalCounties === 1 ? 'county' : 'counties'}.
      </div>

      {orderedCountyKeys.map((countyKey) => {
        const rows = byCounty[countyKey] ?? []
        const cfg = COUNTIES[countyKey]
        const isActive = countyKey === activeCountyId
        return (
          <div key={countyKey} className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div
              className={`flex items-center justify-between border-b border-gray-100 px-4 py-2 ${
                isActive ? 'bg-amber-50/60' : ''
              }`}
            >
              <div className="text-xs font-bold uppercase tracking-widest text-gray-700">
                {cfg.displayName}
                {isActive && (
                  <span className="ml-2 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-900">
                    Active
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-500">
                {rows.length} well{rows.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="flex flex-col gap-2 p-3">
              {rows.map((well, i) => {
                const isGas = clean(well.oil_gas_code).toUpperCase() === 'G'
                const isHz = clean(well.well_type).toUpperCase() === 'HORIZONTAL'
                return (
                  <div
                    key={`${countyKey}-${well.api_number ?? 'well'}-${i}`}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-900">
                        {clean(well.lease_name) || 'Unknown lease'}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {clean(well.operator_name) || 'Unknown operator'}
                        {clean(well.api_number) && (
                          <span className="ml-2 font-mono text-gray-400">API {clean(well.api_number)}</span>
                        )}
                      </div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      isGas ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}>
                      {isGas ? 'GAS' : 'OIL'}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      isHz ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-100 text-slate-600'
                    }`}>
                      {isHz ? 'HZ' : 'VT'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Development-status (Ticket 1.3) ────────────────────────────────────

const DEV_STATUS_STYLE: Record<DevelopmentStatusValue, { label: string; classes: string; dotBg: string }> = {
  PDP:            { label: 'PDP',              classes: 'border-emerald-300 bg-emerald-50 text-emerald-800', dotBg: '#16A34A' },
  PUD_DUC:        { label: 'PUD · DUC',        classes: 'border-purple-300 bg-purple-50 text-purple-800',    dotBg: '#A855F7' },
  PUD_PERMITTED:  { label: 'PUD · Permitted',  classes: 'border-orange-300 bg-orange-50 text-orange-800',    dotBg: '#F97316' },
  PUD_INFILL:     { label: 'PUD · Infill',     classes: 'border-blue-300 bg-blue-50 text-blue-800',          dotBg: '#3B82F6' },
  LEASING_ACTIVE: { label: 'Leasing active',   classes: 'border-yellow-300 bg-yellow-50 text-yellow-800',    dotBg: '#EAB308' },
  FRONTIER:       { label: 'Frontier',         classes: 'border-slate-200 bg-slate-50 text-slate-600',       dotBg: '#94A3B8' },
}

function DevStatusPill({ status, score }: { status: DevelopmentStatusValue; score: number }) {
  const style = DEV_STATUS_STYLE[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style.classes}`}
      title={`Development status: ${style.label} · pud_score ${score}/10`}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: style.dotBg,
          boxShadow: '0 0 0 1px rgba(255,255,255,0.9)',
        }}
      />
      {style.label}
      <span className="ml-1 text-[10px] font-normal opacity-70">{score}/10</span>
    </span>
  )
}

function DevStatusCard({ status }: { status: TractDevStatus }) {
  const style = DEV_STATUS_STYLE[status.development_status]
  const detail = status.signal_detail || {}
  const permits = detail.permits ?? []
  const ducs = detail.ducs ?? []
  const adjacentCount = detail.adjacent_permit_count ?? 0
  const infill = detail.infill_gaps ?? 0
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
          Development status
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.classes}`}>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: style.dotBg,
              boxShadow: '0 0 0 1px rgba(255,255,255,0.9)',
            }}
          />
          {style.label}
          <span className="opacity-75">· {status.pud_score}/10</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <DevMetric label="Permits" value={permits.length} />
        <DevMetric label="DUCs" value={ducs.length} />
        <DevMetric label="Adj. permits" value={adjacentCount} />
        <DevMetric label="Infill gaps" value={infill} />
      </div>

      <button
        onClick={() => setOpen((prev) => !prev)}
        className="mt-3 flex w-full items-center justify-between text-xs font-semibold text-gray-600 hover:text-gray-900"
      >
        <span>{open ? 'Hide' : 'Show'} why this status?</span>
        <span aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {permits.length > 0 && (
            <DevSignalGroup title="Permits">
              {permits.map((p, i) => (
                <DevSignalRow
                  key={`permit-${p.permit_number ?? p.api ?? i}`}
                  primary={
                    <>
                      {clean(p.lease) || `Permit ${clean(p.permit_number) || '—'}`}
                      {clean(p.status) && (
                        <span className="ml-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-600">
                          {clean(p.status)}
                        </span>
                      )}
                    </>
                  }
                  meta={[
                    clean(p.operator),
                    clean(p.approved_date) && `Approved ${clean(p.approved_date)}`,
                    clean(p.spud_date) && `Spud ${clean(p.spud_date)}`,
                    clean(p.api) && `API ${clean(p.api)}`,
                  ].filter(Boolean).join(' · ')}
                />
              ))}
            </DevSignalGroup>
          )}

          {ducs.length > 0 && (
            <DevSignalGroup title="DUCs">
              {ducs.map((d, i) => (
                <DevSignalRow
                  key={`duc-${d.api ?? i}`}
                  primary={clean(d.lease) || `Well ${clean(d.api) || '—'}`}
                  meta={[
                    clean(d.operator),
                    clean(d.spud_date) && `Spud ${clean(d.spud_date)}`,
                    clean(d.status),
                    clean(d.source) && `via ${clean(d.source)}`,
                  ].filter(Boolean).join(' · ')}
                />
              ))}
            </DevSignalGroup>
          )}

          {adjacentCount > 0 && (
            <DevSignalGroup title="Adjacent permits">
              <div className="text-xs text-gray-700">
                {adjacentCount} approved / drilling permit{adjacentCount === 1 ? '' : 's'} on neighboring abstracts.
                {(detail.adjacent_permits ?? []).length > 0 && (
                  <span className="ml-1 text-gray-500">
                    Top operators: {(detail.adjacent_permits ?? [])
                      .filter((a) => a.operator)
                      .slice(0, 3)
                      .map((a) => `${a.operator} (${a.count})`)
                      .join(', ')}
                  </span>
                )}
              </div>
            </DevSignalGroup>
          )}

          {permits.length === 0 && ducs.length === 0 && adjacentCount === 0 && (
            <div className="text-xs text-gray-500">
              No development signals on this tract yet. Score will climb as
              RRC permits, spud reports, or adjacent activity land.
            </div>
          )}

          {status.last_computed && (
            <div className="text-[10px] uppercase tracking-widest text-gray-400">
              Last recomputed {new Date(status.last_computed).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DevMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center">
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{label}</div>
      <div className="mt-0.5 font-serif text-lg font-bold text-gray-900">{value}</div>
    </div>
  )
}

function DevSignalGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">{title}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function DevSignalRow({ primary, meta }: { primary: ReactNode; meta: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
      <div className="font-medium text-gray-900">{primary}</div>
      {meta && <div className="mt-0.5 text-[11px] text-gray-500">{meta}</div>}
    </div>
  )
}

// ── Development timeline (spec §Tract detail panel > Timeline strip) ──

function parseDrawerDate(raw: unknown): Date | null {
  const text = clean(raw)
  if (!text) return null
  const d = new Date(text.length >= 10 ? text.slice(0, 10) : text)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
}

function DevTimeline({ status }: { status: TractDevStatus }) {
  const permits = status.signal_detail?.permits ?? []
  const ducs = status.signal_detail?.ducs ?? []

  // Prefer the permit with the freshest approved_date, since that's the
  // one whose spud/completion timeline is most actionable. If no permit
  // has an approved_date, fall back to any spud date on a DUC row.
  const primaryPermit = permits
    .map((p) => ({ raw: p, approved: parseDrawerDate(p.approved_date), spud: parseDrawerDate(p.spud_date) }))
    .filter((p) => p.approved || p.spud)
    .sort((a, b) => (b.approved?.getTime() ?? 0) - (a.approved?.getTime() ?? 0))[0]

  const approvedDate = primaryPermit?.approved ?? null
  const spudDate =
    primaryPermit?.spud ??
    ducs.map((d) => parseDrawerDate(d.spud_date)).find(Boolean) ??
    null

  // Expected completion window: spec calls out spud + 6–12 mo typical.
  const expectedCompletionRange: [Date, Date] | null =
    spudDate
      ? [
          new Date(spudDate.getTime() + 6 * 30 * 24 * 3600 * 1000),
          new Date(spudDate.getTime() + 12 * 30 * 24 * 3600 * 1000),
        ]
      : null

  // Don't render a timeline when there's nothing to show.
  if (!approvedDate && !spudDate) return null

  const nodes: Array<{ label: string; date: string; active: boolean; color: string }> = [
    {
      label: 'Approved',
      date: approvedDate ? formatShortDate(approvedDate) : '—',
      active: Boolean(approvedDate),
      color: '#F97316', // orange
    },
    {
      label: 'Spud',
      date: spudDate ? formatShortDate(spudDate) : 'not yet',
      active: Boolean(spudDate),
      color: '#A855F7', // purple
    },
    {
      label: 'Expected completion',
      date: expectedCompletionRange
        ? `${formatShortDate(expectedCompletionRange[0])} – ${formatShortDate(expectedCompletionRange[1])}`
        : 'unknown',
      active: false,
      color: '#16A34A', // green
    },
  ]

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
          Development timeline
        </div>
        {primaryPermit?.raw.operator && (
          <div className="text-[11px] text-gray-500">
            Operator: <span className="font-medium text-gray-800">{primaryPermit.raw.operator}</span>
          </div>
        )}
      </div>
      <div className="relative flex items-start justify-between">
        <div
          aria-hidden
          className="absolute left-4 right-4 top-3 h-0.5 bg-gray-200"
        />
        {nodes.map((n, idx) => (
          <div
            key={n.label}
            className="relative flex flex-1 flex-col items-center px-1 text-center"
            style={{ zIndex: 1 }}
          >
            <div
              className="h-6 w-6 rounded-full border-2 border-white"
              style={{
                background: n.active ? n.color : '#E5E7EB',
                boxShadow: n.active
                  ? `0 0 0 2px ${n.color}55, 0 6px 14px rgba(15,23,42,0.15)`
                  : '0 0 0 2px rgba(15,23,42,0.08)',
              }}
              title={`${n.label}: ${n.date}`}
            />
            <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
              {n.label}
            </div>
            <div className={`mt-0.5 text-xs ${n.active ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
              {n.date}
            </div>
            {idx === 2 && !expectedCompletionRange && (
              <div className="mt-0.5 text-[10px] text-gray-400">
                Needs spud date
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 text-[11px] text-gray-500">
        Typical Eagle Ford / Permian well takes 6–12 months from spud to first sales.
      </div>
    </div>
  )
}

// ── Honest-broker outreach template card (spec §HONEST-BROKER NOTE) ──

function firstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 0) return ''
  const first = parts[0]
  // Capitalize LAST-FIRST vendor formats like "SMITH JOHN" -> "John"
  if (first.length > 2 && first === first.toUpperCase() && parts.length >= 2) {
    return parts[1].charAt(0) + parts[1].slice(1).toLowerCase()
  }
  return first
}

function OutreachTemplateCard({
  owner,
  status,
  county,
}: {
  owner: OwnerLike
  status: TractDevStatus
  county: County
}) {
  const shouldRender = status.development_status === 'PUD_DUC' || status.development_status === 'PUD_PERMITTED'
  const [copied, setCopied] = useState(false)
  if (!shouldRender) return null

  const permit = status.signal_detail?.permits?.[0]
  const approvedDate = permit?.approved_date ? parseDrawerDate(permit.approved_date) : null
  const operator = clean(permit?.operator) || clean(owner.operator_name) || 'the operator on your tract'
  const monthLabel = approvedDate
    ? approvedDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
    : 'in the past year'

  const disclosureLine = status.development_status === 'PUD_DUC'
    ? `Public RRC records show ${operator} has already spud a well on your tract; a completion filing is expected in the next 6–12 months.`
    : `Public RRC records show ${operator} filed an approved drilling permit on your tract in ${monthLabel}. Development typically follows within 6–18 months of an approved permit.`

  const template = [
    `Hi ${firstName(owner.owner_name) || 'there'} —`,
    ``,
    `I wanted to reach out regarding your mineral interest in ${county.displayName}. ${disclosureLine}`,
    ``,
    `We help mineral owners in your situation evaluate whether to hold, monetize, or negotiate ahead of an operator's timeline. There's no obligation and we can put together a comp-backed valuation for you at no cost.`,
    ``,
    `Happy to send over the public records I referenced above so you can verify everything I mentioned before we talk.`,
    ``,
    `— [Your name]`,
  ].join('\n')

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(template)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // silent — some browsers block clipboard without permission
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-amber-200 pb-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-amber-800">
          Honest-broker outreach template
        </div>
        <button
          onClick={copyToClipboard}
          className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
        >
          {copied ? '✓ Copied' : 'Copy template'}
        </button>
      </div>
      <p className="mb-3 text-xs text-amber-900/80">
        Owners on tracts with a pending permit or DUC have a legally-material change in their asset value coming.
        This template discloses the public-record signal up front — both the defensible-business posture and
        protection against deceptive-mineral-solicitation statutes (spec §HONEST-BROKER NOTE).
      </p>
      <pre className="whitespace-pre-wrap rounded-lg border border-amber-200 bg-white p-3 text-xs leading-relaxed text-gray-900">
        {template}
      </pre>
    </div>
  )
}

function NotesPanel({
  value, loading, saving, savedAt, error, onChange, onBlur,
}: {
  value: string
  loading: boolean
  saving: boolean
  savedAt: Date | null
  error: string | null
  onChange: (v: string) => void
  onBlur: () => void
}) {
  const savedLabel = savedAt
    ? `Saved ${savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : ''
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            Notes
          </div>
          <div className="text-[11px] text-gray-400">
            {loading ? 'Loading…' : saving ? 'Saving…' : savedLabel}
          </div>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder="Add call prep notes, offer history, contact preferences, or anything else your team should know about this lead. Autosaves when you click out of the box."
          rows={10}
          className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm leading-relaxed text-gray-900 focus:border-amber-400 focus:bg-white focus:ring-1 focus:ring-amber-400 focus:outline-none"
        />
        {error && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
