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
  // Gonzales stores the lease name in `county_lease_name`; Howard /
  // Martin don't have that column at all, but they do have separate
  // `block`, `section`, `survey` columns from their tax roll load.
  county_lease_name?: string | null
  field_name?: string | null
  block?: string | null
  section?: string | null
  survey?: string | null
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
  | 'TRUE_PUD'
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
    completion_date?: string | null
  }>
  ducs?: Array<{
    api?: string | null
    operator?: string | null
    lease?: string | null
    spud_date?: string | null
    completion_date?: string | null
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

    // Owner-name matching: use ilike() as a case-insensitive exact
    // match (no wildcards). Some ownership rows land in the DB with
    // slightly different casing / trailing whitespace than what the
    // click captured (e.g. click came from a search result cast to
    // Title Case, but the row is stored UPPERCASE). ilike() with a
    // trimmed value covers both. Both `%` and `_` in the owner name
    // are escaped so a legitimate name containing those characters
    // still matches exactly.
    const nameForMatch = String(owner.owner_name ?? '').trim()
    const ilikePattern = nameForMatch.replace(/[%_]/g, (m) => `\\${m}`)

    // Column set with a tiered fallback. County schemas drifted apart
    // over time:
    //   Gonzales:      county_lease_name, field_name, (no block/section/survey)
    //   Howard/Martin: block, section, survey, field_name, (no county_lease_name)
    //   Others (10 new Permian counties): tables don't exist yet, error is
    //     ignored downstream.
    // The single-shape query the drawer used to run would fail with
    // "column does not exist" against Howard/Martin because it asked
    // for county_lease_name, so those rows silently vanished. Now we
    // try the Howard-style select first (block/section/survey), fall
    // back to the Gonzales-style select (county_lease_name), and
    // finally to a minimum common set if both fail. `interest_type`
    // and `decimal_interest` are dropped because they aren't real
    // columns anywhere yet — they only live in the TS type as a
    // future-schema placeholder.
    const HOWARD_COLS =
      'id, abstract, block, section, survey, field_name, operator_name, acreage, ownership_pct, rrc_lease_id'
    const GONZALES_COLS =
      'id, abstract, county_lease_name, field_name, operator_name, acreage, ownership_pct, rrc_lease_id'
    const MIN_COLS =
      'id, abstract, operator_name, acreage, ownership_pct, rrc_lease_id'

    const isMissingColumnError = (msg: string): boolean => {
      const m = msg.toLowerCase()
      return m.includes('column') && (m.includes('does not exist') || m.includes('not find'))
    }

    const countyEntries = Object.entries(COUNTIES) as Array<[CountyKey, County]>
    const perCountyPromises = countyEntries.map(async ([countyKey, cfg]) => {
      const runQuery = async (cols: string) =>
        supabase
          .from(cfg.ownershipTable)
          .select(cols)
          .ilike('owner_name', ilikePattern)
          .order('acreage', { ascending: false })
          .limit(500)

      // Prefer the shape that carries block/section/survey when we can,
      // because that's what the Leases table actually renders. Fall
      // through on column errors.
      let result = await runQuery(HOWARD_COLS)
      if (result.error && isMissingColumnError(result.error.message)) {
        result = await runQuery(GONZALES_COLS)
      }
      if (result.error && isMissingColumnError(result.error.message)) {
        result = await runQuery(MIN_COLS)
      }
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
          // Ignore three classes of failure the drawer already
          // handles gracefully upstream:
          //   1. Missing table — the 10 upcoming Permian counties
          //      whose ownership tables haven't shipped yet.
          //   2. Missing column — schema drift; the tiered fallback
          //      above already retried with a smaller column set.
          //   3. Empty owner_name match — legitimate "owner holds
          //      nothing in this county" case, which comes back
          //      with no error at all so it never lands here.
          // Everything else lands in the UI banner AND the console
          // so a broker can screenshot the real Postgres message.
          const isIgnorable =
            msg.includes('not find') ||
            msg.includes('does not exist') ||
            msg.includes('relation') && msg.includes('not exist')
          if (!isIgnorable) {
            console.error(`[OwnerDrawer] ${r.countyKey}_mineral_ownership query failed:`, r.error)
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
    // Depend on owner_name (the query key) instead of the whole owner
    // object. Passing the full `owner` here made this effect re-fire
    // on every parent re-render when a caller passed an unstable
    // reference (e.g. `owner={dealToOwner(selected)}` without a
    // useMemo), which cancelled the in-flight query before it could
    // set state — Leases tab stuck at "0 leases" until the parent
    // stopped re-rendering. Owner identity from this hook's
    // perspective is fully captured by (county.id, owner_name).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, owner?.owner_name, county.id])

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
    // Owner identity flattened to primitives so an unstable owner
    // reference from the parent doesn't refire the effect. Same
    // reasoning as useOwnerHoldings above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county.id, open, owner?.owner_name, owner?.rrc_lease_id, owner?.operator_name, tractLabel, leaseIdsByCounty])

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
    // Same primitive-dep pattern as the holdings + wells hooks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county.id, open, owner?.owner_name])

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

// Parse a compact legal description string into its parts. Handles both
// the T&P railroad grid style used by Howard / Martin
//   "T2N BLK 31 SEC 20 A-543"
// and the named-survey style used by Gonzales / CSL leagues
//   "COOK, W H Survey A-160"
// Also opportunistically pulls a PLSS-style Range ("R30E") if the string
// contains one — Texas T&P doesn't use Range, but some Permian county
// data sets ship with a PLSS-derived description we can surface without
// making the caller do the parsing.
type LegalParts = {
  township: string
  block: string
  section: string
  range: string
  survey: string
  abstract: string
}

function parseLegalDescription(raw: string | null | undefined): LegalParts {
  const s = String(raw ?? '').trim()
  const empty: LegalParts = {
    township: '', block: '', section: '', range: '', survey: '', abstract: '',
  }
  if (!s) return empty

  const townshipMatch = s.match(/\bT\d+[NS]\b/i)
  const rangeMatch = s.match(/\bR\d+[EW]\b/i)
  const blockMatch = s.match(/\bBLK\s+(\S+)/i)
  const sectionMatch = s.match(/\bSEC\s+(\S+)/i)
  const abstractMatch = s.match(/\bA-\s*\S+/i)

  // "SURVEY_NAME Survey [A-\d+]" — treat everything before " Survey" or
  // ", Abstract" as the survey grantee.
  let survey = ''
  const surveyIdx = s.search(/\s+Survey\b/i)
  const abstractIdx = s.search(/\s+Abstract\b/i)
  if (surveyIdx > 0) survey = s.slice(0, surveyIdx).trim()
  else if (abstractIdx > 0) survey = s.slice(0, abstractIdx).trim()

  return {
    township: townshipMatch ? townshipMatch[0].toUpperCase() : '',
    block:    blockMatch    ? blockMatch[1] : '',
    section:  sectionMatch  ? sectionMatch[1] : '',
    range:    rangeMatch    ? rangeMatch[0].toUpperCase() : '',
    survey,
    abstract: abstractMatch ? abstractMatch[0].replace(/\s+/g, '') : '',
  }
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
    // Fills whatever the parent gives us. The parent controls whether
    // this is a side panel (~50vw × full height, laid out to the left
    // of the map) or a mobile bottom sheet (~58vh × 100vw under the
    // map). Borders + shadows are owned by the parent so this
    // component stays layout-agnostic.
    <div
      className="flex flex-1 flex-col bg-white h-full"
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
  // Label on the left, value on the right, both on one line. The
  // 160px label column is fixed so field names line up across rows,
  // and the value cell truncates rather than wrapping — otherwise
  // long mailing addresses would still push the value down onto a
  // second line and defeat the whole one-line-per-field layout the
  // Contact snapshot / Lease context cards were redesigned for.
  return (
    <div className="grid grid-cols-[160px_1fr] items-baseline gap-3">
      <div className="text-xs text-gray-500 whitespace-nowrap">{k}</div>
      <div
        className={`text-sm text-gray-900 min-w-0 truncate ${mono ? 'font-mono' : ''}`}
        title={typeof v === 'string' ? v : undefined}
      >
        {v}
      </div>
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
          label="Net mineral acres"
          value={nra != null ? nra.toFixed(nra < 1 ? 3 : 2) : '—'}
          hint="gross acres × mineral interest"
        />
        <StatCard
          label="Est. royalty"
          value={royaltyEstimate != null ? `$${royaltyEstimate.toLocaleString()}/mo` : '—'}
          hint={cumOil > 0 ? `Cum. oil: ${cumOil.toLocaleString()} bbl` : 'No production on file'}
        />
      </div>

      {/* Contact snapshot and Lease context stacked full-width instead
          of side-by-side. Two half-width columns squeezed each field's
          value column so tightly that long mailing addresses / legal
          descriptions wrapped onto a second line under the label —
          full-width lets each field sit on one line. */}
      <div className="flex flex-col gap-4">
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
      <WellActivityCard
        countyId={county.id}
        abstract={tractLabel}
        ownerName={owner.owner_name}
      />
    </div>
  )
}

type PadActivityEvent = {
  id: number
  county_id: string
  api_number: string | null
  abstract_number: string | null
  lease_name: string | null
  operator_name: string | null
  signature: string
  confidence: number
  summary: string
  before_path: string | null
  after_path: string | null
  week_start: string
  propensity_bump: number
  source: string
}

const SIGNATURE_LABEL: Record<string, string> = {
  COMPLETION_CREW: 'Completion crew',
  RRC_COMPLETION: 'RRC completion',
  RIG_MOVE_IN: 'Rig move-in',
  RIG_MOVE_OUT: 'Rig move-out',
  AMBIGUOUS: 'Needs review',
  NON_RELEVANT: 'Non-relevant',
}

function WellActivityCard({
  countyId,
  abstract,
  ownerName,
}: {
  countyId: string
  abstract: string | null
  ownerName: string
}) {
  const [events, setEvents] = useState<PadActivityEvent[]>([])
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bareAbstract = useMemo(() => {
    if (!abstract) return ''
    return abstract.replace(/^A-/i, '').replace(/^0+/, '') || abstract
  }, [abstract])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!countyId || (!bareAbstract && !ownerName)) return
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ county: countyId, limit: '5' })
        if (bareAbstract) params.set('abstract', bareAbstract)
        else params.set('owner', ownerName)
        const res = await fetch(`/api/pad-activity?${params.toString()}`)
        const json = await res.json()
        if (cancelled) return
        if (!json?.success) {
          setError(json?.error || 'Failed to load pad activity')
          setEvents([])
          return
        }
        setEvents((json.data?.events || []) as PadActivityEvent[])
        setSigned((json.data?.signed || {}) as Record<string, string>)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load pad activity')
          setEvents([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [countyId, bareAbstract, ownerName])

  if (loading && events.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
          Well activity
        </div>
        <div className="mt-2 text-sm text-gray-500">Checking for pad activity…</div>
      </div>
    )
  }

  if (!loading && events.length === 0) {
    // Quiet empty state — don't clutter every owner with a dead card.
    if (error) return null
    return null
  }

  const top = events[0]
  const beforeUrl = top?.before_path ? signed[top.before_path] : null
  const afterUrl = top?.after_path ? signed[top.after_path] : null
  const label = SIGNATURE_LABEL[top.signature] || top.signature
  const pct = Math.round((top.confidence || 0) * 100)

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-emerald-100 pb-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
          Well activity
        </div>
        <span className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
          {label} · {pct}%
        </span>
      </div>

      {(beforeUrl || afterUrl) && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="overflow-hidden rounded-lg border border-emerald-100 bg-white">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Before
            </div>
            {beforeUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={beforeUrl} alt="Before pad chip" className="h-28 w-full object-cover" />
            ) : (
              <div className="flex h-28 items-center justify-center text-xs text-gray-400">
                No chip yet
              </div>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-emerald-100 bg-white">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              After
            </div>
            {afterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={afterUrl} alt="After pad chip" className="h-28 w-full object-cover" />
            ) : (
              <div className="flex h-28 items-center justify-center text-xs text-gray-400">
                No chip yet
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-sm leading-relaxed text-gray-800">{top.summary}</p>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-500">
        {top.lease_name && <span>Lease: {top.lease_name}</span>}
        {top.api_number && <span className="font-mono">API {top.api_number}</span>}
        <span>Week of {top.week_start}</span>
        {top.propensity_bump > 0 && (
          <span className="font-semibold text-emerald-700">
            +{top.propensity_bump} propensity
          </span>
        )}
        <span className="uppercase tracking-wider">{top.source.replace('_', ' ')}</span>
      </div>

      {events.length > 1 && (
        <div className="mt-3 border-t border-emerald-100 pt-2 text-[11px] text-gray-500">
          +{events.length - 1} earlier event{events.length > 2 ? 's' : ''} on this tract
        </div>
      )}
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

  const activeCountyId = county.id as CountyKey
  const totalLeases = holdings.length
  const countiesRepresented = new Set(
    holdings.map((h) => h.county_id ?? activeCountyId),
  )
  const totalCounties = countiesRepresented.size

  // Compact table view. Columns follow the on-call spec:
  //   Unit | Legal | Sec | Township | Block | Range | Operator | County
  // Sec / Township / Block / Range are parsed from the legal
  // description we already computed for the active county's tracts
  // via legalDescByAbstract. For cross-county rows we don't have a
  // pre-computed legal description, so those columns show "—" and
  // the Legal column falls back to the bare abstract label.
  //
  // Sticky top strip + sticky table header: the count / counties
  // summary and every column label stay pinned to the top of the
  // drawer's scroll area as the broker scrolls through a long
  // holdings list (700+ rows is common for a large owner). Uses
  // `position: sticky` inside the drawer's overflow-y-auto container
  // so no extra scroll-position tracking is needed.
  return (
    <div className="flex flex-col gap-2">
      {/* Compact sticky counter — replaces the preachy amber banner. */}
      <div
        className="sticky z-20 flex items-center justify-between border-b border-gray-200 bg-white/95 px-1 py-1.5 backdrop-blur"
        style={{ top: '-20px' }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">
          Leases
        </div>
        <div className="font-mono text-xs text-gray-700">
          <span className="font-semibold text-gray-900">{totalLeases}</span> lease{totalLeases === 1 ? '' : 's'}
          {' · '}
          <span className="font-semibold text-gray-900">{totalCounties}</span> {totalCounties === 1 ? 'county' : 'counties'}
        </div>
      </div>

      {errorMessages && errorMessages.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          <div className="font-semibold">
            Couldn&apos;t load leases from: {errorMessages.map((e) => e.county).join(', ')}
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[10.5px] leading-snug">
            {errorMessages.map((e) => (
              <li key={e.county}>
                <span className="uppercase">{e.county}</span>: {e.message}
              </li>
            ))}
          </ul>
          <div className="mt-1.5 text-[10.5px] font-normal text-red-700">
            Usually an RLS policy (browser uses the anon key). Check that
            <code className="mx-1 rounded bg-red-100 px-1">public.&lt;county&gt;_mineral_ownership</code>
            has a <code className="rounded bg-red-100 px-1">FOR SELECT USING (true)</code> policy for anon;
            see <code className="rounded bg-red-100 px-1">supabase/migrations/20260716260000_allow_anon_read_mineral_ownership.sql</code>.
            Full error is in the browser console.
          </div>
        </div>
      )}

      {/* Compact 10-column table with a sticky <thead>. Column labels
          stay pinned to the top of the scrolling drawer as the user
          scrolls through 700+ rows so they never lose orientation.
          `top: 28px` accounts for the sticky Leases counter above. */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-[11px]">
          <thead className="text-[9px] font-bold uppercase tracking-widest text-gray-500">
            <tr className="sticky z-10 bg-gray-50" style={{ top: '11px' }}>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-left">Unit</th>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-left">Legal</th>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-left">Sec</th>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-left">Twp</th>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-left">Block</th>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-left">Range</th>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-left">Operator</th>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-left">County</th>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-right">Interest</th>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-right">Acres</th>
              <th className="whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-right">NMA</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h, i) => {
              const rowCountyId = (h.county_id ?? activeCountyId) as CountyKey
              const cfg = COUNTIES[rowCountyId]
              const isActive = rowCountyId === activeCountyId
              const bare = abstractKey(h.abstract)
              const abstractLabel = bare ? `A-${bare}` : ''
              // Only the active county has a pre-computed legal
              // description available — legalDescByAbstract is built
              // from the tracts currently loaded on the map.
              const legalDesc = isActive && bare
                ? (legalDescByAbstract?.[bare] || '')
                : ''

              // Prefer the real columns from the ownership row over
              // regex-parsing the composed legal description. Howard /
              // Martin ship block+section+survey natively (loaded from
              // the county tax roll); Gonzales rows don't have them,
              // so parseLegalDescription() fills gaps from whatever
              // legal string the parent computed.
              const parsed = parseLegalDescription(legalDesc)
              const rawBlock   = clean(h.block)
              const rawSection = clean(h.section)
              const rawSurvey  = clean(h.survey)
              // The tax-roll `block` column often has "35 T1N" stuffed
              // into it — split off the township token so the Block
              // column shows only "35" and Township shows "T1N".
              const blockTownshipMatch = rawBlock.match(/T\d+[NS]/i)
              const townshipFromBlock = blockTownshipMatch
                ? blockTownshipMatch[0].toUpperCase()
                : ''
              const blockOnly = townshipFromBlock
                ? rawBlock.replace(blockTownshipMatch![0], '').trim()
                : rawBlock
              const parts = {
                section:  rawSection || parsed.section,
                township: townshipFromBlock || parsed.township,
                block:    blockOnly || parsed.block,
                range:    parsed.range,
                survey:   rawSurvey || parsed.survey,
              }

              const ownershipPct = ownershipPctValue(
                h.ownership_pct ?? h.decimal_interest,
                cfg.ownershipPctIsDecimal,
              )
              const acres = displayNumber(h.acreage)
              const nra = (ownershipPct != null && h.acreage != null)
                ? Number(h.acreage) * (ownershipPct / 100)
                : null

              const unitLabel = clean(h.county_lease_name)
                || clean(h.field_name)
                || (h.rrc_lease_id != null ? `Lease #${h.rrc_lease_id}` : '—')

              // Compose a legal string when the parent didn't hand us
              // one (i.e. for cross-county rows). Uses whichever raw
              // columns the ownership row carried: block/section for
              // Howard/Martin, survey name for named-grantee tracts.
              const composedLegal = (() => {
                if (legalDesc) return legalDesc
                const bits: string[] = []
                if (parts.township) bits.push(parts.township)
                if (parts.block) bits.push(`BLK ${parts.block}`)
                if (parts.section) bits.push(`SEC ${parts.section}`)
                if (abstractLabel) bits.push(abstractLabel)
                if (bits.length > 0) return bits.join(' ')
                if (parts.survey && abstractLabel) return `${parts.survey} Survey ${abstractLabel}`
                return abstractLabel
              })()

              const fieldName = clean(h.field_name)
              const countyLabelShort = cfg.displayName.replace(/\s+County,\s+TX$/i, '')
              return (
                <tr
                  key={`${rowCountyId}-${h.id ?? h.rrc_lease_id ?? i}`}
                  className={`text-gray-800 ${
                    isActive ? 'bg-amber-50/40' : ''
                  } ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}
                >
                  <td
                    className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5 font-medium text-gray-900"
                    title={fieldName && clean(h.county_lease_name) ? `${unitLabel} · ${fieldName}` : unitLabel}
                  >
                    {unitLabel}
                  </td>
                  <td
                    className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5 font-mono"
                    title={composedLegal && abstractLabel && composedLegal !== abstractLabel
                      ? `${composedLegal} · ${abstractLabel}`
                      : composedLegal || abstractLabel || undefined}
                  >
                    {composedLegal || abstractLabel || '—'}
                  </td>
                  <td className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5 font-mono">{parts.section || '—'}</td>
                  <td className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5 font-mono">{parts.township || '—'}</td>
                  <td className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5 font-mono">{parts.block || '—'}</td>
                  <td className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5 font-mono">{parts.range || '—'}</td>
                  <td
                    className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5"
                    title={clean(h.operator_name) || undefined}
                  >
                    {clean(h.operator_name) || '—'}
                  </td>
                  <td className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5" title={cfg.displayName}>
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                        isActive
                          ? 'border-amber-300 bg-amber-100 text-amber-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {countyLabelShort}
                    </span>
                  </td>
                  <td
                    className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5 text-right font-mono"
                    title={h.interest_type ? `${ownershipPct?.toFixed(4)}% · ${h.interest_type}` : undefined}
                  >
                    {ownershipPct != null ? `${ownershipPct.toFixed(4)}%` : '—'}
                  </td>
                  <td className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5 text-right font-mono">
                    {acres ?? '—'}
                  </td>
                  <td
                    className="whitespace-nowrap border-b border-gray-100 px-2 py-1.5 text-right font-mono text-gray-600"
                    title={nra != null ? `${nra.toFixed(3)} NMA` : undefined}
                  >
                    {nra != null ? nra.toFixed(nra < 1 ? 3 : 2) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
  PDP:            { label: 'PDP',              classes: 'border-yellow-300 bg-yellow-50 text-yellow-900',    dotBg: '#EAB308' },
  PUD_DUC:        { label: 'DUC',              classes: 'border-purple-300 bg-purple-50 text-purple-800',    dotBg: '#A855F7' },
  // FRONTIER + TRUE_PUD share the True PUD emerald label (2026-07-22).
  TRUE_PUD:       { label: 'True PUD',         classes: 'border-emerald-300 bg-emerald-50 text-emerald-800', dotBg: '#10B981' },
  PUD_PERMITTED:  { label: 'PUD · Permitted',  classes: 'border-orange-300 bg-orange-50 text-orange-800',    dotBg: '#F97316' },
  PUD_INFILL:     { label: 'Infill',           classes: 'border-orange-300 bg-orange-50 text-orange-800',    dotBg: '#F97316' },
  LEASING_ACTIVE: { label: 'Leasing active',   classes: 'border-yellow-300 bg-yellow-50 text-yellow-800',    dotBg: '#EAB308' },
  FRONTIER:       { label: 'True PUD',         classes: 'border-emerald-300 bg-emerald-50 text-emerald-800', dotBg: '#10B981' },
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

  // Prefer the permit with the freshest approved_date, since that's
  // the one whose spud/completion timeline is most actionable.
  const primaryPermit = permits
    .map((p) => ({
      raw: p,
      approved: parseDrawerDate(p.approved_date),
      spud: parseDrawerDate(p.spud_date),
      completion: parseDrawerDate(p.completion_date),
    }))
    .filter((p) => p.approved || p.spud)
    .sort((a, b) => (b.approved?.getTime() ?? 0) - (a.approved?.getTime() ?? 0))[0]

  const approvedDate = primaryPermit?.approved ?? null
  const spudDate =
    primaryPermit?.spud ??
    ducs.map((d) => parseDrawerDate(d.spud_date)).find(Boolean) ??
    null
  const completionDate =
    primaryPermit?.completion ??
    ducs.map((d) => parseDrawerDate(d.completion_date)).find(Boolean) ??
    null

  // Don't render a timeline when there's nothing to show.
  if (!approvedDate && !spudDate) return null

  // Timeline math. Once we know the spud date, three outcomes for the
  // "Completion" node:
  //   1. completion_date on file      -> "Completed MMM YYYY", green + active
  //   2. spud + 12 months still ahead -> show the 6-12 month window, gray
  //   3. spud + 12 months in the past -> "Overdue by N months", amber
  //
  // The old widget always showed case 2, which is why a 2023-spud
  // well showed "Expected completion Jan 2024 – Jul 2024" three years
  // after the fact — misleading.
  const MONTH_MS = 30 * 24 * 3600 * 1000
  const now = new Date()

  let completionLabel = 'Completion'
  let completionDateStr = 'awaiting spud'
  let completionActive = false
  let completionColor = '#16A34A' // green
  let completionSub: string | null = null

  if (completionDate) {
    completionLabel = 'Completed'
    completionDateStr = formatShortDate(completionDate)
    completionActive = true
  } else if (spudDate) {
    const windowStart = new Date(spudDate.getTime() + 6 * MONTH_MS)
    const windowEnd = new Date(spudDate.getTime() + 12 * MONTH_MS)
    if (windowEnd.getTime() >= now.getTime()) {
      completionLabel = 'Expected completion'
      completionDateStr = `${formatShortDate(windowStart)} – ${formatShortDate(windowEnd)}`
    } else {
      const monthsPast = Math.round(
        (now.getTime() - windowEnd.getTime()) / MONTH_MS,
      )
      completionLabel = 'Completion overdue'
      completionColor = '#DC2626' // red
      completionActive = true
      // > 24 months: read as years to make the number less loud.
      completionDateStr = monthsPast >= 24
        ? `${(monthsPast / 12).toFixed(monthsPast >= 60 ? 0 : 1)} yrs late`
        : `${monthsPast} mo late`
      completionSub =
        'Long-hold DUC — spud on file but no completion report yet. Common when operators wait on prices or spacing decisions.'
    }
  }

  const nodes: Array<{
    label: string
    date: string
    active: boolean
    color: string
    sub?: string | null
  }> = [
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
      label: completionLabel,
      date: completionDateStr,
      active: completionActive,
      color: completionColor,
      sub: completionSub,
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
        {nodes.map((n) => (
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
          </div>
        ))}
      </div>
      {nodes[2].sub && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-[11px] leading-relaxed text-red-800">
          {nodes[2].sub}
        </div>
      )}
      {!nodes[2].sub && (
        <div className="mt-3 text-[11px] text-gray-500">
          Typical Permian well takes 6–12 months from spud to first sales.
        </div>
      )}
    </div>
  )
}

// (OutreachTemplateCard + firstName() removed 2026-07-17. The card
//  was crowding the Overview panel and its copy was tied to a
//  broker-outreach workflow the platform doesn't offer anyway.)

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
