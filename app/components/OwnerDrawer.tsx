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
  // abstract label (bare, e.g. "543") -> "T2N BLK 31 SEC 20 A-543"
  // for the Leases tab. Built from the county's parcels_map.geojson
  // in the parent and passed in so we don't re-load the file here.
  legalDescByAbstract?: Record<string, string>
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
  const [holdings, setHoldings] = useState<OwnerDrawerHolding[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !owner) {
      setHoldings([])
      return
    }
    let cancelled = false
    setLoading(true)
    supabase
      .from(county.ownershipTable)
      .select('id, abstract, county_lease_name, field_name, operator_name, acreage, ownership_pct, decimal_interest, rrc_lease_id, interest_type, propensity_score')
      .eq('owner_name', owner.owner_name)
      .order('propensity_score', { ascending: false })
      .order('acreage', { ascending: false })
      .limit(200)
      .then((result) => {
        if (cancelled) return
        setHoldings(result.error ? [] : ((result.data ?? []) as OwnerDrawerHolding[]))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [county.ownershipTable, open, owner])

  return { holdings, loading }
}

function useOwnerWells(
  county: County,
  owner: OwnerLike | null,
  tractLabel: string | null | undefined,
  holdings: OwnerDrawerHolding[],
  open: boolean,
) {
  const [wells, setWells] = useState<OwnerDrawerWell[]>([])
  const [loading, setLoading] = useState(false)

  const leaseIds = useMemo(() => {
    const set = new Set<string>()
    if (owner?.rrc_lease_id != null) set.add(String(owner.rrc_lease_id))
    for (const h of holdings) {
      if (h.rrc_lease_id != null) set.add(String(h.rrc_lease_id))
    }
    return Array.from(set).filter(Boolean)
  }, [owner?.rrc_lease_id, holdings])

  useEffect(() => {
    if (!open || !owner) {
      setWells([])
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const body: Record<string, unknown> = {
          countyId: county.id,
          mode: 'owner',
          ownerName: owner.owner_name,
          leaseId: owner.rrc_lease_id != null ? String(owner.rrc_lease_id) : '',
          leaseIds,
          abstract: tractLabel ? tractLabel.replace(/^A-\s*/i, '') : '',
          operator: owner.operator_name ?? null,
        }
        const response = await fetch('/api/wells', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = (await response.json()) as { wells?: OwnerDrawerWell[] }
        if (!cancelled) setWells(Array.isArray(payload.wells) ? payload.wells : [])
      } catch {
        if (!cancelled) setWells([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [county.id, open, owner, tractLabel, leaseIds])

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
  if (owner.motivated) {
    badges.push({ label: 'Motivated', classes: 'bg-lime-50 text-lime-700 border-lime-200' })
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
  } = props

  const county = COUNTIES[countyId]
  const { holdings, loading: holdingsLoading } = useOwnerHoldings(county, owner, open)
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
  const propensity = toNumber(owner.propensity_score) ?? 0
  const scoreColor = propensity >= 8 ? 'text-red-600' : propensity >= 6 ? 'text-amber-600' : 'text-gray-500'

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
            {propensity > 0 && (
              <div className={`text-lg font-serif font-bold ${scoreColor}`}>
                {propensity}<span className="text-sm text-gray-400 font-normal">/10</span>
              </div>
            )}
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
          { key: 'holdings' as const, label: `Leases (${holdings.length || (holdingsLoading ? '…' : '0')})` },
          { key: 'wells'    as const, label: `Wells (${wells.length || (wellsLoading ? '…' : '0')})` },
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
          />
        )}
        {tab === 'holdings' && (
          <HoldingsPanel
            holdings={holdings}
            loading={holdingsLoading}
            county={county}
            legalDescByAbstract={legalDescByAbstract}
          />
        )}
        {tab === 'wells' && (
          <WellsPanel wells={wells} loading={wellsLoading} />
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
  tractLabel, tractLegalDescription, rrcLease, county,
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
    </div>
  )
}

function HoldingsPanel({
  holdings, loading, county, legalDescByAbstract,
}: {
  holdings: OwnerDrawerHolding[]
  loading: boolean
  county: County
  legalDescByAbstract: Record<string, string> | undefined
}) {
  if (loading) {
    return <div className="text-sm text-gray-500">Loading leases…</div>
  }
  if (holdings.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No matching rows found in {county.displayName}&apos;s mineral ownership table.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {holdings.map((h, i) => {
        const bareAbstract = abstractKey(h.abstract)
        const abstractLabel = bareAbstract ? `A-${bareAbstract}` : ''
        const legalDesc = bareAbstract ? (legalDescByAbstract?.[bareAbstract] || '') : ''
        const ownershipPct = ownershipPctValue(h.ownership_pct ?? h.decimal_interest, county.ownershipPctIsDecimal)
        const acres = displayNumber(h.acreage)
        const nra = (ownershipPct != null && h.acreage != null)
          ? Number(h.acreage) * (ownershipPct / 100)
          : null
        return (
          <div
            key={`${h.id ?? h.rrc_lease_id ?? i}`}
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
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
  )
}

function WellsPanel({ wells, loading }: { wells: OwnerDrawerWell[]; loading: boolean }) {
  if (loading) {
    return <div className="text-sm text-gray-500">Looking up wells…</div>
  }
  if (wells.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No wells matched this owner in the current county&apos;s wells table.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {wells.map((well, i) => {
        const isGas = clean(well.oil_gas_code).toUpperCase() === 'G'
        const isHz = clean(well.well_type).toUpperCase() === 'HORIZONTAL'
        return (
          <div
            key={`${well.api_number ?? 'well'}-${i}`}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
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
