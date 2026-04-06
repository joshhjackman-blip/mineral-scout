'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

import { supabase } from '@/lib/supabase'

const MineralMap = dynamic(() => import('./components/Map'), { ssr: false })

type TractOwner = {
  owner_name: string
  propensity_score: number
  operator_name?: string
  mailing_city?: string
  mailing_state?: string
  mailing_zip?: string
  address_1?: string
  mailing_address?: string
  out_of_state?: boolean
  motivated?: boolean
  acreage?: number
  ownership_pct?: number
  decimal_interest?: number
  phone?: string
  email?: string
}

type TractSelection = {
  abstract_label?: string
  level1_sur?: string
  owner_count?: number
  top_operator?: string
  owners_json?: string
  max_propensity_score?: number
  ABSTRACT_L?: string
  LEVEL1_SUR?: string
  field_name?: string
  well_status?: string
  first_date?: string
  est_lease_expiration?: string
  prod_cumulative_sum_oil?: number
  first_6_month_oil?: number
  first_12_month_oil?: number
  first_24_month_oil?: number
  first_60_month_oil?: number
}

type TractRecord = {
  abstract_label: string
  level1_sur: string
  owner_count: number
  top_operator: string
  max_propensity_score: number
  owners_json: string
  field_name?: string
  well_status?: string
  first_date?: string
  est_lease_expiration?: string
  prod_cumulative_sum_oil?: number
  first_6_month_oil?: number
  first_12_month_oil?: number
  first_24_month_oil?: number
  first_60_month_oil?: number
}

type PipelineTag = 'prospect' | 'hot' | 'nurture' | 'not_interested'

const scoreBadgeColor = (score: number) =>
  score >= 8 ? '#F44336' : score >= 6 ? '#FF9800' : '#FFC107'

const COUNTY_STATS = [
  { val: '73,589', lbl: 'Total mineral owners' },
  { val: '13,551', lbl: 'Out of state (18%)' },
  { val: '13,724', lbl: 'Motivated sellers (6+)' },
  { val: '3,950', lbl: 'Hot leads (8-10)' },
  { val: '553', lbl: 'Survey tracts' },
  { val: '4,512', lbl: 'Active wells' },
]

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseOwners = (ownersJson: unknown): TractOwner[] => {
  if (Array.isArray(ownersJson)) return ownersJson as TractOwner[]
  if (typeof ownersJson !== 'string') return []
  try {
    const parsed = JSON.parse(ownersJson) as unknown
    return Array.isArray(parsed) ? (parsed as TractOwner[]) : []
  } catch {
    return []
  }
}

const classifyOwner = (name: string): 'trust' | 'company' | 'individual' => {
  const n = (name ?? '').toUpperCase()
  if (
    n.includes('TRUST') || n.includes('ESTATE') ||
    n.includes('LIVING') || n.includes('TESTAMENTARY') ||
    n.includes('IRREVOCABLE') || n.includes('REVOCABLE')
  ) return 'trust'
  if (
    n.includes('LLC') || n.includes('LP') || n.includes('INC') ||
    n.includes('CORP') || n.includes('LTD') || n.includes('COMPANY') ||
    n.includes('CO.') || n.includes('PARTNERS') || n.includes('ENERGY') ||
    n.includes('MINERALS') || n.includes('RESOURCES') || n.includes('ROYALTY') ||
    n.includes('HOLDINGS') || n.includes('PROPERTIES') || n.includes('VENTURES')
  ) return 'company'
  return 'individual'
}

const getTrend = (series: Array<{ month: string; oil: number }>) => {
  if (series.length < 2) return 'stable'
  const recent = series[series.length - 1].oil
  const previous = series[series.length - 2].oil
  if (previous === 0) return 'stable'
  const delta = (recent - previous) / previous
  if (delta > 0.05) return 'growing'
  if (delta < -0.05) return 'declining'
  return 'stable'
}

export default function Home() {
  const [tracts, setTracts] = useState<TractRecord[]>([])
  const [selected, setSelected] = useState<TractSelection | null>(null)
  const [loading, setLoading] = useState(true)
  const [motivatedOnly, setMotivatedOnly] = useState(false)
  const [outOfStateOnly, setOutOfStateOnly] = useState(false)
  const [minScore, setMinScore] = useState(0)
  const [showActiveWells, setShowActiveWells] = useState(true)
  const [showShutInWells, setShowShutInWells] = useState(true)
  const [showUnknownWells, setShowUnknownWells] = useState(true)
  const [showPermits, setShowPermits] = useState(true)
  const [ownerTypeFilter, setOwnerTypeFilter] = useState<'all' | 'individual' | 'trust' | 'company'>('all')
  const [skipTracing, setSkipTracing] = useState<TractOwner | null>(null)
  const [skipTraceLoading, setSkipTraceLoading] = useState(false)
  const [pipelineCandidate, setPipelineCandidate] = useState<TractOwner | null>(null)
  const [pipelineTag, setPipelineTag] = useState<PipelineTag>('prospect')
  const [pipelineSaving, setPipelineSaving] = useState(false)
  const [pipelineOwners, setPipelineOwners] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [navMenuOpen, setNavMenuOpen] = useState(false)

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToastType(type)
    setToast(message)
    setTimeout(() => setToast(null), 3500)
  }

  const getDefaultPipelineTag = (owner: TractOwner): PipelineTag => {
    const score = toNumber(owner.propensity_score)
    if (score >= 8) return 'hot'
    if (score >= 6) return 'nurture'
    return 'prospect'
  }

  const handleSkipTrace = (owner: TractOwner) => {
    setSkipTracing(owner)
  }

  const handleOpenAddToPipeline = (owner: TractOwner) => {
    setPipelineCandidate(owner)
    setPipelineTag(getDefaultPipelineTag(owner))
  }

  const handleAddToPipelineConfirm = async () => {
    if (!pipelineCandidate) return
    setPipelineSaving(true)

    const owner = pipelineCandidate
    const tractAbstract = selected?.ABSTRACT_L ?? selected?.abstract_label ?? ''
    const tractSurvey = selected?.LEVEL1_SUR ?? selected?.level1_sur ?? ''

    const { error } = await supabase.from('deals').insert({
      owner_name: owner.owner_name,
      tract_abstract: tractAbstract,
      tract_survey: tractSurvey,
      operator_name: owner.operator_name ?? '',
      mailing_city: owner.mailing_city ?? '',
      mailing_state: owner.mailing_state ?? '',
      mailing_zip: owner.mailing_zip ?? '',
      mailing_address: owner.address_1 ?? owner.mailing_address ?? '',
      acreage: owner.acreage ?? null,
      propensity_score: owner.propensity_score ?? 0,
      source: 'map',
      tag: pipelineTag,
    })

    if (error) {
      console.error('Failed to add owner to pipeline:', error.message)
      showToast(`Failed to add ${owner.owner_name}: ${error.message}`, 'error')
      setPipelineSaving(false)
      return
    }

    setPipelineOwners((prev) => {
      const next = new Set(prev)
      next.add(owner.owner_name)
      return next
    })
    setPipelineSaving(false)
    setPipelineCandidate(null)
    showToast(`${owner.owner_name} added to pipeline (${pipelineTag.replace('_', ' ')})`)
  }

  const handleSkipTraceConfirm = async () => {
    if (!skipTracing) return
    setSkipTraceLoading(true)

    try {
      const nameParts = (skipTracing.owner_name ?? '').trim().split(' ')
      const firstName = nameParts[0] ?? ''
      const lastName = nameParts.slice(1).join(' ') ?? ''

      const response = await fetch('/api/skiptrace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          address: skipTracing.address_1 ?? '',
          city: skipTracing.mailing_city ?? '',
          state: skipTracing.mailing_state ?? '',
          zip: skipTracing.mailing_zip ?? '',
        }),
      })

      const result = await response.json()

      if (result.success) {
        const phone = result.phones?.[0] ?? null
        const email = result.emails?.[0] ?? null

        const { data: existingDeal } = await supabase
          .from('deals')
          .select('id')
          .eq('owner_name', skipTracing.owner_name)
          .maybeSingle()

        if (existingDeal) {
          await supabase
            .from('deals')
            .update({
              tag: 'skip_traced',
              notes: `Skip traced ${new Date().toLocaleDateString()}\nPhone: ${phone ?? 'not found'}\nEmail: ${email ?? 'not found'}`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingDeal.id)
        } else {
          await supabase.from('deals').insert({
            owner_name: skipTracing.owner_name,
            tract_abstract: selected?.ABSTRACT_L ?? selected?.abstract_label ?? '',
            tract_survey: selected?.LEVEL1_SUR ?? selected?.level1_sur ?? '',
            operator_name: skipTracing.operator_name ?? '',
            mailing_city: skipTracing.mailing_city ?? '',
            mailing_state: skipTracing.mailing_state ?? '',
            mailing_address: skipTracing.address_1 ?? '',
            acreage: skipTracing.acreage ?? null,
            propensity_score: skipTracing.propensity_score ?? 0,
            source: 'skip_trace',
            tag: 'skip_traced',
            notes: `Skip traced ${new Date().toLocaleDateString()}\nPhone: ${phone ?? 'not found'}\nEmail: ${email ?? 'not found'}`,
          })
        }

        setPipelineOwners((prev) => {
          const next = new Set(prev)
          next.add(skipTracing.owner_name)
          return next
        })

        const resultMsg =
          [phone ? `📞 ${phone}` : null, email ? `✉ ${email}` : null]
            .filter(Boolean)
            .join('  ') || 'No contact info found'

        setToast(`${skipTracing.owner_name}: ${resultMsg}`)
        setTimeout(() => setToast(null), 6000)
      } else {
        setToast(`Skip trace failed: ${result.error}`)
        setTimeout(() => setToast(null), 4000)
      }
    } catch (err) {
      console.error('Skip trace failed:', err)
      setToast('Skip trace failed - check console')
      setTimeout(() => setToast(null), 4000)
    }

    setSkipTraceLoading(false)
    setSkipTracing(null)
  }

  useEffect(() => {
    let mounted = true

    const loadData = async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/parcels', { cache: 'no-store' })
        let parcelsData: unknown

        if (response.ok) {
          parcelsData = await response.json()
        } else {
          // Fallback for local/dev edge cases where API route reload lags.
          parcelsData = await fetch('/gonzales_parcels_enriched.geojson', { cache: 'no-store' }).then((res) => res.json())
        }

        if (!mounted) return

        const rows: TractRecord[] = (((parcelsData as { features?: unknown[] })?.features ?? []) as Array<{ properties?: Record<string, unknown> }>)
          .map((feature) => {
            const props = feature.properties ?? {}
            const ownersJsonRaw = props.owners_json
            return {
              abstract_label: String(props.ABSTRACT_L ?? ''),
              level1_sur: String(props.LEVEL1_SUR ?? ''),
              owner_count: toNumber(props.owner_count),
              top_operator: String(props.top_operator ?? 'Unknown'),
              max_propensity_score: toNumber(props.max_propensity_score),
              owners_json:
                typeof ownersJsonRaw === 'string'
                  ? ownersJsonRaw
                  : JSON.stringify(ownersJsonRaw ?? []),
              field_name: String(props.field_name ?? ''),
              well_status: String(props.well_status ?? ''),
              first_date: String(props.first_date ?? ''),
              est_lease_expiration: String(props.est_lease_expiration ?? ''),
              prod_cumulative_sum_oil: toNumber(props.prod_cumulative_sum_oil),
              first_6_month_oil: toNumber(props.first_6_month_oil),
              first_12_month_oil: toNumber(props.first_12_month_oil),
              first_24_month_oil: toNumber(props.first_24_month_oil),
              first_60_month_oil: toNumber(props.first_60_month_oil),
            }
          })
          .filter((tract) => tract.abstract_label !== '')

        setTracts(rows)
      } catch (err) {
        console.error('Failed to load parcel data:', err)
        if (mounted) {
          setTracts([])
          showToast('Failed to load map data', 'error')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadData()
    return () => {
      mounted = false
    }
  }, [])

  const topTracts = useMemo(
    () =>
      [...tracts]
        .sort((a, b) => {
          if (b.max_propensity_score !== a.max_propensity_score) {
            return b.max_propensity_score - a.max_propensity_score
          }
          return b.owner_count - a.owner_count
        })
        .slice(0, 10),
    [tracts]
  )

  const selectedOwners = useMemo(
    () => parseOwners(selected?.owners_json ?? ''),
    [selected]
  )
  const filteredOwnersList = useMemo(() => {
    return selectedOwners.filter((owner) => {
      if (ownerTypeFilter === 'all') return true
      return classifyOwner(String(owner.owner_name ?? '')) === ownerTypeFilter
    })
  }, [selectedOwners, ownerTypeFilter])

  const estimateMonthlyRoyalty = (
    owner: TractOwner,
    selectedTract: TractSelection | null
  ): string | null => {
    void selectedTract
    const decimalInterest = Number(owner.decimal_interest ?? 0) ||
      (Number(owner.ownership_pct ?? 0) / 100)
    if (!decimalInterest || decimalInterest <= 0) return null

    // Cap at a single average Eagle Ford well at maturity.
    const avgMonthlyBbls = 500
    const oilPrice = 70
    const royaltyFraction = 0.25
    const monthlyRoyalty = avgMonthlyBbls * decimalInterest * oilPrice * royaltyFraction

    if (monthlyRoyalty < 1) return null
    if (monthlyRoyalty < 1000) return `~$${Math.round(monthlyRoyalty)}/mo`
    return `~$${(monthlyRoyalty / 1000).toFixed(1)}k/mo`
  }

  const productionData = useMemo(() => {
    if (!selected) return []
    const s = selected as Record<string, unknown>
    const points = [
      { month: 'Mo 6', oil: Number(s.first_6_month_oil ?? s.First_6_Month_Oil ?? 0) },
      { month: 'Mo 12', oil: Number(s.first_12_month_oil ?? s.First_12_Month_Oil ?? 0) },
      { month: 'Mo 24', oil: Number(s.first_24_month_oil ?? s.First_24_Month_Oil ?? 0) },
      { month: 'Mo 60', oil: Number(s.first_60_month_oil ?? s.First_60_Month_Oil ?? 0) },
    ].filter((p) => p.oil > 0)
    return points
  }, [selected])
  useEffect(() => {
    const selectedRecord = (selected ?? {}) as Record<string, unknown>
    console.log('Selected tract properties:', Object.keys(selectedRecord))
    console.log('Production values:', {
      first_6: selectedRecord.first_6_month_oil,
      first_12: selectedRecord.first_12_month_oil,
      first_24: selectedRecord.first_24_month_oil,
      first_60: selectedRecord.first_60_month_oil,
    })
  }, [selected])
  const productionPeak = useMemo(
    () => productionData.reduce((max, point) => Math.max(max, point.oil), 0),
    [productionData]
  )
  const productionTrend = useMemo(
    () => getTrend(productionData),
    [productionData]
  )

  const abstractLabel = selected?.abstract_label ?? selected?.ABSTRACT_L ?? 'Unknown'
  const surveyName = selected?.level1_sur ?? selected?.LEVEL1_SUR ?? 'Unknown'
  const ownerCount = toNumber(selected?.owner_count)
  const topOperator = selected?.top_operator ?? 'Unknown'
  const maxScore = toNumber(selected?.max_propensity_score)
  const fieldName = selected?.field_name ?? 'Unknown'
  const estExpiration = selected?.est_lease_expiration ?? 'Unknown'

  return (
    <div
      style={{
        height: '100vh',
        background: '#FFFFFF',
        color: '#111827',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Top header */}
      <div
        style={{
          height: 52,
          background: '#FFFFFF',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setNavMenuOpen((prev) => !prev)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                border: '1px solid #E5E7EB',
                background: '#FFFFFF',
                color: '#111827',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
              }}
              aria-label="Open navigation menu"
            >
              <span
                style={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  gap: 3,
                  width: 12,
                }}
              >
                <span style={{ display: 'block', height: 1.5, background: '#111827' }} />
                <span style={{ display: 'block', height: 1.5, background: '#111827' }} />
                <span style={{ display: 'block', height: 1.5, background: '#111827' }} />
              </span>
            </button>
            {navMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 36,
                  left: 0,
                  zIndex: 1200,
                  background: '#FFFFFF',
                  border: '1px solid #E5E7EB',
                  borderRadius: 8,
                  minWidth: 220,
                  overflow: 'hidden',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
                }}
              >
                <a
                  href="/"
                  style={{
                    display: 'block',
                    padding: '10px 16px',
                    fontSize: 13,
                    color: '#374151',
                    textDecoration: 'none',
                    fontFamily: 'Inter, sans-serif',
                    borderBottom: '1px solid #F3F4F6',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#FEF3C7'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  ← Map
                </a>
                <a
                  href="/crm"
                  style={{
                    display: 'block',
                    padding: '10px 16px',
                    fontSize: 13,
                    color: '#374151',
                    textDecoration: 'none',
                    fontFamily: 'Inter, sans-serif',
                    borderBottom: '1px solid #F3F4F6',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#FEF3C7'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  CRM & Pipeline
                </a>
                <a
                  href="/methodology"
                  style={{
                    display: 'block',
                    padding: '10px 16px',
                    fontSize: 13,
                    color: '#374151',
                    textDecoration: 'none',
                    fontFamily: 'Inter, sans-serif',
                    borderBottom: '1px solid #F3F4F6',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#FEF3C7'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  📊 Methodology
                </a>
                <div style={{ borderTop: '1px solid #E5E7EB', margin: '2px 0 0' }} />
                <div style={{ padding: '10px 16px 4px', fontSize: 11, color: '#6B7280', fontFamily: 'Inter, sans-serif' }}>
                  Gonzales County, TX
                </div>
                <div style={{ padding: '0 16px 12px', fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter, sans-serif' }}>
                  553 tracts · 73,589 owners
                </div>
              </div>
            )}
          </div>
          <div
            style={{
              width: 28,
              height: 28,
              background: '#EF9F27',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>M</span>
          </div>
          <span
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: 16,
              fontWeight: 700,
              color: '#111827',
              letterSpacing: '-0.01em',
            }}
          >
            Mineral Map
          </span>
        </div>
        <div style={{ fontSize: 13, color: '#6B7280', fontFamily: 'Inter, sans-serif' }}>
          Gonzales County, TX · 553 tracts
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {[
            { val: '73,589', lbl: 'owners' },
            { val: '3,950', lbl: 'hot leads' },
            { val: '13,724', lbl: 'motivated' },
          ].map((s) => (
            <div
              key={s.lbl}
              style={{
                padding: '4px 12px',
                background: '#FEF3C7',
                borderRadius: 20,
                border: '1px solid #FDE68A',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>{s.val}</span>
              <span style={{ fontSize: 11, color: '#B45309', marginLeft: 4 }}>{s.lbl}</span>
            </div>
          ))}
          <a
            href="/methodology"
            style={{
              fontSize: 12,
              color: '#6B7280',
              textDecoration: 'none',
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #E5E7EB',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            Methodology
          </a>
          <a
            href="/crm"
            style={{
              fontSize: 12,
              color: '#EF9F27',
              textDecoration: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #EF9F27',
              fontWeight: 500,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            CRM →
          </a>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Left panel */}
        <div
          style={{
            width: 420,
            minWidth: 420,
            background: '#F8F8F8',
            borderRight: '1px solid #E5E7EB',
            overflowY: 'auto',
            padding: 14,
          }}
        >
          {selected ? (
            <div>
              <button
                onClick={() => setSelected(null)}
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#6B7280',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '12px 16px',
                  marginBottom: 4,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                ← Back
              </button>

              <div style={{ fontSize: 18, fontFamily: 'Georgia, serif', color: '#111827', fontWeight: 700 }}>
                {abstractLabel}
              </div>
              <div style={{ color: '#6B7280', marginTop: 4 }}>{surveyName} Survey</div>
              <div style={{ borderTop: '1px solid #E5E7EB', marginTop: 10, marginBottom: 10 }} />

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: 'rgba(244,67,54,0.15)', color: '#F44336', border: '0.5px solid rgba(244,67,54,0.35)' }}>
                  {maxScore}/10 HOT
                </span>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: 'rgba(239,159,39,0.15)', color: '#EF9F27', border: '0.5px solid rgba(239,159,39,0.35)' }}>
                  {ownerCount} owners
                </span>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB' }}>
                  {topOperator}
                </span>
              </div>

              <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#EF9F27', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>PRODUCTION HISTORY</div>
                <div style={{ width: '100%', height: 140, minHeight: 140 }}>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={productionData}>
                      <XAxis dataKey="month" stroke="#6B7280" tick={{ fill: '#6B7280', fontSize: 10 }} />
                      <YAxis stroke="#6B7280" tick={{ fill: '#6B7280', fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E7EB', color: '#111827' }}
                        labelStyle={{ color: '#6B7280' }}
                      />
                      <Line type="monotone" dataKey="oil" stroke="#EF9F27" strokeWidth={2} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#6B7280' }}>
                  <span>Peak production: {productionPeak.toLocaleString()}</span>
                  <span>Current trend: {productionTrend}</span>
                </div>
              </div>

              <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#EF9F27', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>OPERATOR & LEASE INFO</div>
                <div style={{ fontSize: 12, color: '#111827', marginBottom: 6 }}>Operator: {selected.top_operator}</div>
                <div style={{ fontSize: 12, color: '#111827', marginBottom: 6 }}>Field: {fieldName}</div>
                <div style={{ fontSize: 12, color: '#111827', marginBottom: 6 }}>Well status: {selected.well_status || 'PRODUCING / SHUT IN'}</div>
                <div style={{ fontSize: 12, color: '#111827' }}>Est. lease expiration: {estExpiration}</div>
              </div>

              <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ color: '#EF9F27', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>COMPARABLE SALES</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>
                  No comp data available yet — comps unlock after first closed deal
                </div>
              </div>

              <div style={{ padding: '10px 16px 6px', fontSize: 9, color: '#6B7280', letterSpacing: '0.08em', fontWeight: 600 }}>
                ALL OWNERS IN TRACT ({ownerCount})
                {ownerTypeFilter !== 'all' && (
                  <span style={{ color: '#EF9F27', marginLeft: 6 }}>
                    · showing {filteredOwnersList.length} {ownerTypeFilter}s
                  </span>
                )}
              </div>
              <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                {filteredOwnersList.map((owner, index) => {
                  const score = toNumber(owner.propensity_score)
                  const acreage = toNumber(owner.acreage)
                  const ownershipPct = toNumber(owner.ownership_pct)
                  const hasPhone = Boolean(owner.phone)
                  const hasEmail = Boolean(owner.email)
                  const ownerType = classifyOwner(String(owner.owner_name ?? ''))
                  const typeColor = ownerType === 'trust' ? '#7AB835' :
                    ownerType === 'company' ? '#378ADD' : '#6B7280'
                  const typeLabel = ownerType === 'trust' ? 'TRUST' :
                    ownerType === 'company' ? 'CO' : 'IND'
                  return (
                    <div
                      key={`${owner.owner_name}-${index}`}
                      style={{ padding: '10px 16px', borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.background = '#FFFBEB'
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, marginRight: 8 }}>
                          <div style={{ fontSize: 12, color: '#111827', fontWeight: 600 }}>
                            {index + 1}. {owner.owner_name}
                            <span
                              style={{
                                fontSize: 9, padding: '1px 5px', borderRadius: 6,
                                background: `${typeColor}20`,
                                color: typeColor,
                                border: `0.5px solid ${typeColor}40`,
                                marginLeft: 6,
                              }}
                            >
                              {typeLabel}
                            </span>
                          </div>
                          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                            {owner.address_1 || owner.mailing_address || 'Address unknown'}
                          </div>
                          <div style={{ fontSize: 10, color: '#6B7280' }}>
                            {owner.mailing_city || 'Unknown city'}, {owner.mailing_state || '--'} {owner.mailing_zip || ''}
                          </div>
                          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                            {acreage > 0 ? `${acreage.toFixed(2)} acres` : 'Acreage unknown'} ·{' '}
                            {ownershipPct > 0 ? `${ownershipPct.toFixed(4)}%` : 'Ownership unknown'}
                          </div>
                          {(() => {
                            const royalty = estimateMonthlyRoyalty(owner, selected)
                            return royalty ? (
                              <div style={{ fontSize: 10, marginTop: 2 }}>
                                <span style={{ color: '#9CA3AF' }}>Est. royalty: </span>
                                <span style={{ color: '#16a34a', fontWeight: 600, fontFamily: 'monospace' }}>
                                  {royalty}
                                </span>
                              </div>
                            ) : null
                          })()}
                          {pipelineOwners.has(owner.owner_name) ? (
                            <div style={{ fontSize: 10, color: '#7AB835', marginTop: 6 }}>
                              ✓ In pipeline
                            </div>
                          ) : (
                            <button
                              onClick={() => handleOpenAddToPipeline(owner)}
                              style={{
                                marginTop: 6,
                                fontSize: 10,
                                padding: '3px 10px',
                                borderRadius: 4,
                                background: 'rgba(55,138,221,0.14)',
                                border: '0.5px solid rgba(55,138,221,0.5)',
                                color: '#378ADD',
                                cursor: 'pointer',
                                fontFamily: 'Inter, sans-serif',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = '#63AEFF'
                                e.currentTarget.style.background = 'rgba(55,138,221,0.24)'
                                e.currentTarget.style.color = '#63AEFF'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = 'rgba(55,138,221,0.5)'
                                e.currentTarget.style.background = 'rgba(55,138,221,0.14)'
                                e.currentTarget.style.color = '#378ADD'
                              }}
                            >
                              + Add to pipeline
                            </button>
                          )}
                          {!hasPhone && !hasEmail ? (
                            <button
                              onClick={() => handleSkipTrace(owner)}
                              style={{
                                marginTop: 6,
                                fontSize: 10,
                                padding: '3px 10px',
                                borderRadius: 4,
                                background: 'rgba(122,184,53,0.16)',
                                border: '0.5px solid rgba(122,184,53,0.6)',
                                color: '#7AB835',
                                cursor: 'pointer',
                                fontFamily: 'Inter, sans-serif',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = '#A8E063'
                                e.currentTarget.style.background = 'rgba(122,184,53,0.24)'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = 'rgba(122,184,53,0.6)'
                                e.currentTarget.style.background = 'rgba(122,184,53,0.16)'
                              }}
                            >
                              ⟳ Skip trace contact info
                            </button>
                          ) : (
                            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {hasPhone && (
                                <div style={{ fontSize: 10, color: '#111827', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ color: '#6B7280' }}>📞</span>
                                  <span>{owner.phone}</span>
                                  <a href={`tel:${owner.phone}`} style={{ fontSize: 9, color: '#EF9F27', textDecoration: 'none' }}>call</a>
                                </div>
                              )}
                              {hasEmail && (
                                <div style={{ fontSize: 10, color: '#111827', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ color: '#6B7280' }}>✉</span>
                                  <span>{owner.email}</span>
                                  <a href={`mailto:${owner.email}`} style={{ fontSize: 9, color: '#EF9F27', textDecoration: 'none' }}>email</a>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                          <span
                            style={{
                              fontSize: 10,
                              color: scoreBadgeColor(score),
                              fontFamily: 'Inter, sans-serif',
                              fontWeight: 600,
                            }}
                          >
                            {score}/10
                          </span>
                          {owner.out_of_state && (
                            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: '#FEF3C7', color: '#B45309', border: '1px solid #FDE68A', fontWeight: 500 }}>
                              OOS
                            </span>
                          )}
                          {owner.motivated && (
                            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FECACA', fontWeight: 500 }}>
                              HOT
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button style={{ flex: 1, padding: '9px', borderRadius: 6, border: '0.5px solid rgba(239,159,39,0.4)', background: 'rgba(239,159,39,0.15)', color: '#EF9F27', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                  Add all to pipeline
                </button>
                <button style={{ flex: 1, padding: '9px', borderRadius: 6, border: '0.5px solid #E5E7EB', background: 'transparent', color: '#6B7280', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                  Export CSV
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 16 }}>
                County Overview
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {COUNTY_STATS.map((card) => (
                  <div
                    key={card.lbl}
                    style={{
                      background: '#FFFFFF',
                      borderRadius: 8,
                      border: '1px solid #E5E7EB',
                      padding: '14px 16px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}
                  >
                    <div
                      style={{
                        color: '#111827',
                        fontFamily: '"Times New Roman", Georgia, serif',
                        fontSize: 24,
                        fontWeight: 700,
                        letterSpacing: '0.02em',
                        fontVariantNumeric: 'tabular-nums lining-nums',
                        fontFeatureSettings: '"tnum" 1, "lnum" 1',
                      }}
                    >
                      {card.val}
                    </div>
                    <div style={{ color: '#6B7280', fontSize: 11, marginTop: 2, fontFamily: 'Inter, sans-serif' }}>{card.lbl}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, marginBottom: 10, fontSize: 10, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif' }}>
                TOP 10 HOTTEST TRACTS
              </div>
              <div
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 0,
                  maxHeight: 340,
                  overflowY: 'auto',
                }}
              >
                {topTracts.map((tract, index) => (
                  <div
                    key={`${tract.abstract_label}-${tract.level1_sur}-${index}`}
                    onClick={() =>
                      setSelected({
                        abstract_label: tract.abstract_label,
                        level1_sur: tract.level1_sur,
                        owner_count: tract.owner_count,
                        top_operator: tract.top_operator,
                        owners_json: tract.owners_json,
                        max_propensity_score: tract.max_propensity_score,
                        field_name: tract.field_name,
                        well_status: tract.well_status,
                        first_date: tract.first_date,
                        prod_cumulative_sum_oil: tract.prod_cumulative_sum_oil,
                        first_6_month_oil: tract.first_6_month_oil,
                        first_12_month_oil: tract.first_12_month_oil,
                        first_24_month_oil: tract.first_24_month_oil,
                        first_60_month_oil: tract.first_60_month_oil,
                      })
                    }
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #E5E7EB',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 6,
                      cursor: 'pointer',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.borderColor = '#EF9F27'
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.borderColor = '#E5E7EB'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, marginRight: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>
                          {tract.abstract_label}
                        </div>
                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                          {tract.level1_sur}
                        </div>
                        <div style={{ fontSize: 10, color: '#6B7280', marginTop: 4 }}>
                          {tract.owner_count} owners · {tract.top_operator}
                        </div>
                      </div>
                      <div
                        style={{
                          background: '#F3F4F6',
                          border: '1px solid #E5E7EB',
                          borderRadius: 999,
                          padding: '2px 8px',
                          color: scoreBadgeColor(tract.max_propensity_score),
                          fontFamily: 'Inter, sans-serif',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {tract.max_propensity_score}/10
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, marginBottom: 10, fontSize: 10, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif' }}>
                COUNTY BREAKDOWN
              </div>
              <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                {[
                  { label: 'EOG Resources', pct: 68 },
                  { label: 'Baytex Energy', pct: 21 },
                  { label: 'Marathon Oil', pct: 7 },
                  { label: 'Other', pct: 4 },
                ].map((row) => (
                  <div key={row.label} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: '#111827' }}>{row.label}</span>
                      <span style={{ color: '#6B7280' }}>{row.pct}%</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 4, background: '#F3F4F6' }}>
                      <div style={{ width: `${row.pct}%`, height: 7, borderRadius: 4, background: '#EF9F27' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Map area */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {loading ? (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EF9F27', fontFamily: 'Inter, sans-serif' }}>
              Loading...
            </div>
          ) : (
            <MineralMap
              showActiveWells={showActiveWells}
              showShutInWells={showShutInWells}
              showUnknownWells={showUnknownWells}
              showPermits={showPermits}
              onOwnerClick={(tract) => setSelected(tract)}
            />
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          height: 44,
          minHeight: 44,
          background: '#FFFFFF',
          borderTop: '1px solid #E5E7EB',
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '0 16px',
          color: '#374151',
          fontSize: 11,
          boxShadow: '0 -1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <span style={{ fontSize: 12, color: '#374151', fontFamily: 'Inter, sans-serif' }}>Motivated only</span>
        <button
          onClick={() => setMotivatedOnly((prev) => !prev)}
          style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            border: 'none',
            background: motivatedOnly ? '#EF9F27' : '#D1D5DB',
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: motivatedOnly ? 14 : 2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#fff',
            }}
          />
        </button>

        <span style={{ fontSize: 12, color: '#374151', fontFamily: 'Inter, sans-serif' }}>Out of state</span>
        <button
          onClick={() => setOutOfStateOnly((prev) => !prev)}
          style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            border: 'none',
            background: outOfStateOnly ? '#EF9F27' : '#D1D5DB',
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: outOfStateOnly ? 14 : 2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#fff',
            }}
          />
        </button>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginRight: 16 }}>
          <span style={{ fontSize: 12, color: '#374151', whiteSpace: 'nowrap', fontFamily: 'Inter, sans-serif' }}>Type:</span>
          {(['all', 'individual', 'trust', 'company'] as const).map(type => (
            <button
              key={type}
              onClick={() => setOwnerTypeFilter(type)}
              style={{
                fontSize: 10,
                padding: '3px 10px',
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                whiteSpace: 'nowrap',
                background: ownerTypeFilter === type ? 'rgba(239,159,39,0.2)' : 'transparent',
                border: ownerTypeFilter === type ? '1px solid rgba(239,159,39,0.6)' : '1px solid #E5E7EB',
                color: ownerTypeFilter === type ? '#EF9F27' : '#6B7280',
              }}
            >
              {type === 'all' ? 'All' : type === 'individual' ? 'People' : type === 'trust' ? 'Trusts' : 'Companies'}
            </button>
          ))}
        </div>

        <span style={{ fontSize: 12, color: '#374151', fontFamily: 'Inter, sans-serif' }}>Min score</span>
        <input
          type="range"
          min={0}
          max={10}
          value={minScore}
          onChange={(event) => setMinScore(Number(event.target.value))}
          style={{ width: 160, accentColor: '#EF9F27' }}
        />
        <span style={{ fontFamily: 'Inter, sans-serif', color: '#EF9F27', fontWeight: 600 }}>{minScore}</span>

        <span style={{ fontSize: 12, color: '#374151', fontFamily: 'Inter, sans-serif' }}>Layers:</span>
        <button onClick={() => setShowActiveWells((prev) => !prev)} style={{ background: 'none', border: 'none', color: showActiveWells ? '#16a34a' : '#6B7280', cursor: 'pointer' }}>
          ● Active wells
        </button>
        <button onClick={() => setShowShutInWells((prev) => !prev)} style={{ background: 'none', border: 'none', color: showShutInWells ? '#dc2626' : '#6B7280', cursor: 'pointer' }}>
          ● Shut in wells
        </button>
        <button onClick={() => setShowUnknownWells((prev) => !prev)} style={{ background: 'none', border: 'none', color: showUnknownWells ? '#9CA3AF' : '#6B7280', cursor: 'pointer' }}>
          ● Unknown wells
        </button>
        <button onClick={() => setShowPermits((prev) => !prev)} style={{ background: 'none', border: 'none', color: showPermits ? '#2563eb' : '#6B7280', cursor: 'pointer' }}>
          ● New permits
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#374151', fontFamily: 'Inter, sans-serif' }}>Scale:</span>
        <div style={{ width: 180, height: 8, borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
          {['#1a3a1a', '#2d6a2d', '#4CAF50', '#8BC34A', '#FFC107', '#FF9800', '#F44336', '#B71C1C'].map((color) => (
            <div key={color} style={{ flex: 1, background: color }} />
          ))}
        </div>
      </div>

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#FFFFFF',
            border: toastType === 'error' ? '0.5px solid #F44336' : '0.5px solid #7AB835',
            color: toastType === 'error' ? '#F44336' : '#7AB835',
            fontSize: 12,
            padding: '10px 20px',
            borderRadius: 8,
            fontFamily: 'Inter, sans-serif',
            zIndex: 9999,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
        >
          {toastType === 'error' ? '✕' : '✓'} {toast}
        </div>
      )}

      {pipelineCandidate && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              border: '0.5px solid #E5E7EB',
              borderRadius: 12,
              padding: 24,
              width: 360,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 8 }}>
              Add owner to pipeline
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
              {pipelineCandidate.owner_name}
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8 }}>
              Label
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              {([
                { key: 'prospect', label: 'Prospect' },
                { key: 'hot', label: 'Hot' },
                { key: 'nurture', label: 'Nurture' },
                { key: 'not_interested', label: 'Not Interested' },
              ] as Array<{ key: PipelineTag; label: string }>).map((option) => (
                <button
                  key={option.key}
                  onClick={() => setPipelineTag(option.key)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border:
                      pipelineTag === option.key
                        ? '0.5px solid rgba(55,138,221,0.8)'
                        : '0.5px solid #E5E7EB',
                    background:
                      pipelineTag === option.key
                        ? 'rgba(55,138,221,0.2)'
                        : 'transparent',
                    color: pipelineTag === option.key ? '#8CC4FF' : '#6B7280',
                    fontSize: 11,
                    cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  if (pipelineSaving) return
                  setPipelineCandidate(null)
                }}
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: 6,
                  background: 'transparent',
                  border: '0.5px solid #E5E7EB',
                  color: '#6B7280',
                  fontSize: 12,
                  cursor: pipelineSaving ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddToPipelineConfirm}
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: 6,
                  background: 'rgba(55,138,221,0.2)',
                  border: '0.5px solid rgba(55,138,221,0.8)',
                  color: '#8CC4FF',
                  fontSize: 12,
                  cursor: pipelineSaving ? 'not-allowed' : 'pointer',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {pipelineSaving ? 'Saving...' : 'Add to pipeline'}
              </button>
            </div>
          </div>
        </div>
      )}

      {skipTracing && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              border: '0.5px solid #E5E7EB',
              borderRadius: 12,
              padding: '24px',
              width: 320,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: '#111827', marginBottom: 8 }}>
              Skip trace this owner?
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>
              {skipTracing.owner_name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#6B7280',
                marginBottom: 20,
                padding: '10px 12px',
                background: '#FFFFFF',
                borderRadius: 6,
                lineHeight: 1.5,
              }}
            >
              This will search for phone number and email address.
              Uses 1 skip trace credit from your monthly allowance.
              <br />
              <br />
              <span style={{ color: '#EF9F27' }}>
                Prospector: 100/mo · Professional: 500/mo · Enterprise: unlimited
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setSkipTracing(null)}
                disabled={skipTraceLoading}
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: 6,
                  background: 'transparent',
                  border: '0.5px solid #E5E7EB',
                  color: '#6B7280',
                  fontSize: 12,
                  cursor: skipTraceLoading ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSkipTraceConfirm}
                disabled={skipTraceLoading}
                style={{
                  flex: 1, padding: '9px', borderRadius: 6,
                  background: skipTraceLoading ? 'rgba(239,159,39,0.08)' : 'rgba(239,159,39,0.15)',
                  border: '0.5px solid rgba(239,159,39,0.4)',
                  color: '#EF9F27', fontSize: 12, cursor: skipTraceLoading ? 'not-allowed' : 'pointer',
                  fontFamily: 'monospace'
                }}
              >
                {skipTraceLoading ? 'Searching...' : 'Skip trace →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
