'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CountyKey, County } from '@/lib/counties'
import { COUNTIES } from '@/lib/counties'

// A bottom-sheet CRM-style drawer that opens when the user clicks an
// owner in the tract sidebar. Slides up over the bottom half of the
// viewport; the map (and left tract-list) stay visible above so users
// can still see spatial context while working the owner.
//
// The drawer is intentionally self-contained: it renders using the
// TractOwner payload the caller already has in memory, plus a couple
// of on-demand Supabase queries for cross-tract holdings and wells.
// Everything else it needs (skip trace usage, pipeline membership,
// callbacks for the button row) is passed in as props.

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
  countyId: CountyKey
  inPipeline?: boolean
  onClose: () => void
  onSkipTrace: (owner: OwnerLike) => void
  onAddToPipeline: (owner: OwnerLike) => void
  onShowAllTracts?: (owner: OwnerLike) => void
  isMobile?: boolean
}

const NRA_DECIMALS = 4
const ROYALTY_ESTIMATE_BOE_PRICE = 65

function clean(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value).trim()
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'none') return ''
  return text
}

function displayNumber(value: unknown, options: { decimals?: number; short?: boolean } = {}): string | null {
  const text = clean(value)
  if (!text) return null
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  if (options.short && n >= 1000) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  }
  const decimals = options.decimals ?? 2
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function formatOwnershipPct(value: unknown, ownershipIsDecimal: boolean): number | null {
  const text = clean(value)
  if (!text) return null
  const n = Number(text)
  if (!Number.isFinite(n)) return null
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

function ownerAddress(owner: OwnerLike): string {
  const parts = [
    clean(owner.address_1) || clean(owner.mailing_address),
    [clean(owner.mailing_city), clean(owner.mailing_state)].filter(Boolean).join(', '),
    clean(owner.mailing_zip),
  ].filter(Boolean)
  return parts.join(' · ')
}

function ownerBadges(owner: OwnerLike): Array<{ label: string; bg: string; fg: string; border: string }> {
  const badges: Array<{ label: string; bg: string; fg: string; border: string }> = []
  const name = (owner.owner_name || '').toUpperCase()
  if (owner.out_of_state) {
    badges.push({ label: 'Out of state', bg: 'rgba(239,159,39,0.12)', fg: '#B45309', border: 'rgba(239,159,39,0.4)' })
  }
  if (owner.motivated) {
    badges.push({ label: 'Motivated', bg: 'rgba(122,184,53,0.12)', fg: '#3F6212', border: 'rgba(122,184,53,0.4)' })
  }
  if (name.includes('LIFE ESTATE')) {
    badges.push({ label: 'Life estate', bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' })
  } else if (name.includes('ESTATE')) {
    badges.push({ label: 'Estate', bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' })
  }
  if (name.includes('IRREVOCABLE')) {
    badges.push({ label: 'Irrevocable trust', bg: '#EEF2FF', fg: '#3730A3', border: '#C7D2FE' })
  } else if (name.includes('LIVING TRUST') || name.includes('LIV TR')) {
    badges.push({ label: 'Living trust', bg: '#EEF2FF', fg: '#3730A3', border: '#C7D2FE' })
  } else if (name.includes('TRUST')) {
    badges.push({ label: 'Trust', bg: '#EEF2FF', fg: '#3730A3', border: '#C7D2FE' })
  }
  if (name.includes('LLC') || name.includes(' LP') || name.includes('INC')) {
    badges.push({ label: 'Entity', bg: '#F1F5F9', fg: '#334155', border: '#E2E8F0' })
  } else if (badges.every((b) => b.label !== 'Trust' && b.label !== 'Estate' && b.label !== 'Life estate' && b.label !== 'Irrevocable trust' && b.label !== 'Living trust')) {
    badges.push({ label: 'Individual', bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0' })
  }
  return badges
}

function useOwnerHoldings(county: County, owner: OwnerLike | null, open: boolean) {
  const [holdings, setHoldings] = useState<OwnerDrawerHolding[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !owner) {
      setHoldings([])
      setError(null)
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
        if (result.error) {
          setError(result.error.message)
          setHoldings([])
        } else {
          setError(null)
          setHoldings((result.data ?? []) as OwnerDrawerHolding[])
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [county.ownershipTable, open, owner])

  return { holdings, loading, error }
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
        if (!cancelled) {
          setWells(Array.isArray(payload.wells) ? payload.wells : [])
        }
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

export default function OwnerDrawer(props: OwnerDrawerProps) {
  const {
    open,
    owner,
    tractLabel,
    countyId,
    inPipeline,
    onClose,
    onSkipTrace,
    onAddToPipeline,
    onShowAllTracts,
    isMobile,
  } = props

  const county = COUNTIES[countyId]
  const { holdings, loading: holdingsLoading } = useOwnerHoldings(county, owner, open)
  const { wells, loading: wellsLoading } = useOwnerWells(county, owner, tractLabel, holdings, open)

  const [tab, setTab] = useState<'overview' | 'holdings' | 'wells'>('overview')

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

  if (!owner) return null

  const phone = formatPhone(owner.phone)
  const email = formatEmail(owner.email)
  const badges = ownerBadges(owner)
  const ownershipPct = formatOwnershipPct(owner.ownership_pct ?? owner.decimal_interest, county.ownershipPctIsDecimal)
  const acreage = displayNumber(owner.acreage, { decimals: 2 })
  const nra = (ownershipPct != null && owner.acreage != null)
    ? (Number(owner.acreage) * (ownershipPct / 100))
    : null
  const cumOil = Number(owner.prod_cumulative_sum_oil ?? 0)
  const royaltyEstimate = (ownershipPct != null && cumOil > 0)
    ? Math.round((cumOil * (ownershipPct / 100) * ROYALTY_ESTIMATE_BOE_PRICE) / 12)
    : null
  const address = ownerAddress(owner)
  const rrcLease = clean(owner.rrc_lease_id)

  const drawerHeight = isMobile ? '78vh' : '58vh'

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: drawerHeight,
          background: 'rgba(15,23,42,0.28)',
          backdropFilter: 'blur(2px)',
          zIndex: 1200,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.22s ease',
        }}
      />

      <section
        aria-modal="true"
        role="dialog"
        aria-label={`Details for ${owner.owner_name}`}
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: drawerHeight,
          background: '#FFFFFF',
          borderTop: '1px solid #E5E7EB',
          borderRadius: isMobile ? '16px 16px 0 0' : '18px 18px 0 0',
          boxShadow: '0 -18px 60px rgba(15,23,42,0.28)',
          zIndex: 1300,
          transform: open ? 'translateY(0%)' : 'translateY(100%)',
          transition: 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            width: 44,
            height: 4,
            background: '#CBD5E1',
            borderRadius: 999,
            margin: '10px auto 6px',
            flexShrink: 0,
          }}
        />

        <header
          style={{
            padding: isMobile ? '10px 16px 14px' : '10px 24px 16px',
            borderBottom: '1px solid #F1F5F9',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 16,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'Georgia, serif',
                fontSize: 22,
                fontWeight: 700,
                color: '#0F172A',
                letterSpacing: '-0.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {owner.owner_name}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {tractLabel && (
                <span style={pillStyle('#F1F5F9', '#475569', '#E2E8F0')}>{tractLabel}</span>
              )}
              {rrcLease && (
                <span style={pillStyle('#EEF2FF', '#3730A3', '#C7D2FE')}>Lease #{rrcLease}</span>
              )}
              {badges.map((b) => (
                <span key={b.label} style={pillStyle(b.bg, b.fg, b.border)}>{b.label}</span>
              ))}
            </div>
            {address && (
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 8 }}>{address}</div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              border: '1px solid #E5E7EB',
              background: '#FFFFFF',
              width: 30,
              height: 30,
              borderRadius: 8,
              cursor: 'pointer',
              color: '#475569',
              fontSize: 15,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Close owner details"
          >
            ×
          </button>
        </header>

        <div
          style={{
            padding: isMobile ? '12px 12px 12px' : '14px 24px 12px',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            borderBottom: '1px solid #F1F5F9',
            flexShrink: 0,
          }}
        >
          <ContactButton
            label={phone ? phone.display : 'No phone on file'}
            icon="📞"
            href={phone?.href}
            disabled={!phone}
          />
          <ContactButton
            label={email ? email.display : 'No email on file'}
            icon="✉︎"
            href={email?.href}
            disabled={!email}
          />
          <button
            onClick={() => onSkipTrace(owner)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 14px',
              borderRadius: 8,
              background: 'linear-gradient(180deg, #F97316 0%, #EA580C 100%)',
              color: '#FFFFFF',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 6px 14px rgba(234,88,12,0.28)',
            }}
          >
            <span aria-hidden>⚡</span>
            Skip trace
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => onAddToPipeline(owner)}
            style={{
              padding: '9px 14px',
              borderRadius: 8,
              background: inPipeline ? 'rgba(122,184,53,0.15)' : 'transparent',
              border: `1px solid ${inPipeline ? '#7AB835' : '#E5E7EB'}`,
              color: inPipeline ? '#3F6212' : '#334155',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {inPipeline ? '✓ In pipeline' : '+ Add to pipeline'}
          </button>
          {onShowAllTracts && (
            <button
              onClick={() => onShowAllTracts(owner)}
              style={{
                padding: '9px 14px',
                borderRadius: 8,
                background: 'transparent',
                border: '1px solid #E5E7EB',
                color: '#475569',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Show all tracts
            </button>
          )}
        </div>

        <nav
          style={{
            padding: isMobile ? '10px 12px 0' : '12px 24px 0',
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid #F1F5F9',
            flexShrink: 0,
          }}
        >
          {([
            { key: 'overview', label: 'Overview' },
            { key: 'holdings', label: `Leases (${holdings.length || (holdingsLoading ? '…' : '0')})` },
            { key: 'wells',    label: `Wells (${wells.length || (wellsLoading ? '…' : '0')})` },
          ] as const).map((t) => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '10px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  border: 'none',
                  background: 'transparent',
                  color: active ? '#0F172A' : '#64748B',
                  borderBottom: `2px solid ${active ? '#EF9F27' : 'transparent'}`,
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
              >
                {t.label}
              </button>
            )
          })}
        </nav>

        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 16px 24px' : '18px 24px 32px' }}>
          {tab === 'overview' && (
            <OverviewPanel
              owner={owner}
              ownershipPct={ownershipPct}
              acreage={acreage}
              nra={nra}
              royaltyEstimate={royaltyEstimate}
              cumOil={cumOil}
              tractLabel={tractLabel ?? null}
              rrcLease={rrcLease}
              county={county}
            />
          )}
          {tab === 'holdings' && (
            <HoldingsPanel
              holdings={holdings}
              loading={holdingsLoading}
              county={county}
            />
          )}
          {tab === 'wells' && (
            <WellsPanel wells={wells} loading={wellsLoading} />
          )}
        </div>
      </section>
    </>
  )
}

function pillStyle(bg: string, fg: string, border: string): CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 999,
    background: bg,
    color: fg,
    border: `1px solid ${border}`,
    letterSpacing: '0.01em',
  }
}

function ContactButton({
  label,
  icon,
  href,
  disabled,
}: {
  label: string
  icon: string
  href: string | undefined
  disabled: boolean
}) {
  const commonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 14px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    background: disabled ? '#F1F5F9' : '#FFFFFF',
    color: disabled ? '#94A3B8' : '#0F172A',
    border: disabled ? '1px solid #E2E8F0' : '1px solid #CBD5E1',
    cursor: disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'none',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }
  if (disabled || !href) {
    return (
      <button disabled style={{ ...commonStyle, border: 'none', background: 'transparent', color: '#94A3B8', padding: '9px 4px' }}>
        <span aria-hidden style={{ opacity: 0.7 }}>{icon}</span>
        {label}
      </button>
    )
  }
  return (
    <a href={href} style={commonStyle}>
      <span aria-hidden>{icon}</span>
      {label}
    </a>
  )
}

function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        border: '1px solid #E2E8F0',
        borderRadius: 10,
        background: '#F8FAFC',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.08em', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', fontFamily: 'Georgia, serif', letterSpacing: '-0.01em' }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: '#94A3B8' }}>{hint}</div>}
    </div>
  )
}

function OverviewPanel({
  owner,
  ownershipPct,
  acreage,
  nra,
  royaltyEstimate,
  cumOil,
  tractLabel,
  rrcLease,
  county,
}: {
  owner: OwnerLike
  ownershipPct: number | null
  acreage: string | null
  nra: number | null
  royaltyEstimate: number | null
  cumOil: number
  tractLabel: string | null
  rrcLease: string
  county: County
}) {
  const decimalInterest = ownershipPct != null ? ownershipPct / 100 : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <StatCard
          label="Ownership %"
          value={ownershipPct != null ? `${ownershipPct.toFixed(NRA_DECIMALS)}%` : '—'}
          hint={decimalInterest != null ? `Decimal: ${decimalInterest.toFixed(6)}` : undefined}
        />
        <StatCard
          label="Gross acres"
          value={acreage ?? '—'}
          hint={owner.interest_type ? `Interest: ${owner.interest_type}` : undefined}
        />
        <StatCard
          label="Net royalty acres"
          value={nra != null ? nra.toFixed(nra < 1 ? 3 : 2) : '—'}
          hint={ownershipPct != null && !acreage ? 'Gross acres missing — NRA is estimated when available.' : undefined}
        />
        <StatCard
          label="Est. royalty"
          value={royaltyEstimate != null ? `$${royaltyEstimate.toLocaleString()}/mo` : '—'}
          hint={cumOil > 0 ? `Cum. oil: ${cumOil.toLocaleString()} bbl` : 'No production on file'}
        />
      </div>

      <SectionCard title="Contact snapshot">
        <KVRow k="Owner name" v={owner.owner_name} mono />
        <KVRow k="Mailing address" v={
          [
            owner.address_1 || owner.mailing_address,
            [owner.mailing_city, owner.mailing_state, owner.mailing_zip].filter(Boolean).join(' '),
          ].filter(Boolean).join(' · ') || 'Not on file'
        } />
        <KVRow k="Phone" v={owner.phone || 'Not on file — run skip trace above'} />
        <KVRow k="Email" v={owner.email || 'Not on file — run skip trace above'} />
      </SectionCard>

      <SectionCard title="Lease context">
        <KVRow k="Tract" v={tractLabel || 'Selected tract'} mono />
        <KVRow k="RRC lease" v={rrcLease || 'Not linked'} mono />
        <KVRow k="Operator" v={clean(owner.operator_name) || 'Unknown operator'} />
        <KVRow k="County" v={county.displayName} />
        {clean(owner.sptb_code) && (
          <KVRow k="Interest code" v={owner.sptb_code ?? ''} mono />
        )}
      </SectionCard>
    </div>
  )
}

function HoldingsPanel({
  holdings,
  loading,
  county,
}: {
  holdings: OwnerDrawerHolding[]
  loading: boolean
  county: County
}) {
  if (loading) {
    return <div style={{ padding: 12, color: '#94A3B8', fontSize: 13 }}>Loading leases…</div>
  }
  if (holdings.length === 0) {
    return (
      <div style={{ padding: 12, color: '#94A3B8', fontSize: 13 }}>
        No matching rows found in {county.displayName}&apos;s mineral ownership table.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {holdings.map((h, i) => {
        const abstract = clean(h.abstract) ? `A-${clean(h.abstract).replace(/^A-\s*/i, '')}` : ''
        const ownershipPct = formatOwnershipPct(h.ownership_pct ?? h.decimal_interest, county.ownershipPctIsDecimal)
        const acres = displayNumber(h.acreage, { decimals: 2 })
        const nra = (ownershipPct != null && h.acreage != null)
          ? Number(h.acreage) * (ownershipPct / 100)
          : null
        return (
          <div
            key={`${h.id ?? h.rrc_lease_id ?? i}`}
            style={{
              padding: '12px 14px',
              border: '1px solid #E2E8F0',
              borderRadius: 10,
              background: '#FFFFFF',
              display: 'grid',
              gridTemplateColumns: 'minmax(140px, 1.2fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr)',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', fontFamily: 'monospace' }}>
                {abstract || 'No abstract'}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                {clean(h.county_lease_name) || clean(h.field_name) || 'Unnamed lease'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Operator</div>
              <div style={{ fontSize: 12.5, color: '#0F172A', marginTop: 2 }}>{clean(h.operator_name) || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Interest</div>
              <div style={{ fontSize: 12.5, color: '#0F172A', marginTop: 2, fontFamily: 'monospace' }}>
                {ownershipPct != null ? `${ownershipPct.toFixed(NRA_DECIMALS)}%` : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Acres / NRA</div>
              <div style={{ fontSize: 12.5, color: '#0F172A', marginTop: 2, fontFamily: 'monospace' }}>
                {acres ?? '—'}
                {nra != null && (
                  <span style={{ color: '#64748B', marginLeft: 8 }}>({nra.toFixed(nra < 1 ? 3 : 2)} NRA)</span>
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
    return <div style={{ padding: 12, color: '#94A3B8', fontSize: 13 }}>Looking up wells…</div>
  }
  if (wells.length === 0) {
    return (
      <div style={{ padding: 12, color: '#94A3B8', fontSize: 13 }}>
        No wells matched this owner in the current county&apos;s wells table.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {wells.map((well, i) => {
        const isGas = clean(well.oil_gas_code).toUpperCase() === 'G'
        const isHz = clean(well.well_type).toUpperCase() === 'HORIZONTAL'
        return (
          <div
            key={`${well.api_number ?? 'well'}-${i}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: 10,
              padding: '10px 12px',
              border: '1px solid #E2E8F0',
              borderRadius: 10,
              background: '#FFFFFF',
              alignItems: 'center',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {clean(well.lease_name) || 'Unknown lease'}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                {clean(well.operator_name) || 'Unknown operator'}
                {clean(well.api_number) && (
                  <span style={{ marginLeft: 8, fontFamily: 'monospace', color: '#94A3B8' }}>
                    API {clean(well.api_number)}
                  </span>
                )}
              </div>
            </div>
            <span style={pillStyle(isGas ? '#EFF6FF' : '#FEF3C7', isGas ? '#1D4ED8' : '#92400E', isGas ? '#BFDBFE' : '#FDE68A')}>
              {isGas ? 'GAS' : 'OIL'}
            </span>
            <span style={pillStyle(isHz ? '#FEF3C7' : '#F1F5F9', isHz ? '#B45309' : '#475569', isHz ? '#FDE68A' : '#E2E8F0')}>
              {isHz ? 'HZ' : 'VT'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid #E2E8F0',
        borderRadius: 12,
        background: '#FFFFFF',
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.1em', color: '#64748B', fontWeight: 700, textTransform: 'uppercase', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function KVRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12, alignItems: 'baseline' }}>
      <div style={{ fontSize: 12, color: '#64748B' }}>{k}</div>
      <div
        style={{
          fontSize: 13,
          color: '#0F172A',
          fontFamily: mono ? 'monospace' : 'inherit',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {v}
      </div>
    </div>
  )
}
