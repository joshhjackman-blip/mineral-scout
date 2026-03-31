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
import type { OwnerRecord } from './components/Map'

const MineralMap = dynamic(() => import('./components/Map'), { ssr: false })

type TractOwner = {
  owner_name: string
  propensity_score: number
  mailing_city?: string
  mailing_state?: string
  mailing_zip?: string
  address_1?: string
  mailing_address?: string
  out_of_state?: boolean
  motivated?: boolean
  acreage?: number
  ownership_pct?: number
  phone?: string
  email?: string
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
  prod_cumulative_sum_oil?: number
  first_6_month_oil?: number
  first_12_month_oil?: number
  first_24_month_oil?: number
  first_60_month_oil?: number
}

const scoreBadgeColor = (score: number) =>
  score >= 8 ? '#F44336' : score >= 6 ? '#FF9800' : '#FFC107'

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseOwners = (ownersJson: string): TractOwner[] => {
  try {
    const parsed = JSON.parse(ownersJson) as unknown
    return Array.isArray(parsed) ? (parsed as TractOwner[]) : []
  } catch {
    return []
  }
}

const buildProductionSeries = (tract: TractRecord | null) => {
  if (!tract) return []
  const points = [
    { month: 6, oil: toNumber(tract.first_6_month_oil) },
    { month: 12, oil: toNumber(tract.first_12_month_oil) },
    { month: 24, oil: toNumber(tract.first_24_month_oil) },
    { month: 60, oil: toNumber(tract.first_60_month_oil) },
  ]
  const cumulative = toNumber(tract.prod_cumulative_sum_oil)
  if (points.every((point) => point.oil === 0) && cumulative > 0) {
    points[points.length - 1].oil = cumulative
  }
  return points
}

const getTrend = (series: Array<{ month: number; oil: number }>) => {
  if (series.length < 2) return 'stable'
  const recent = series[series.length - 1].oil
  const previous = series[series.length - 2].oil
  if (previous === 0) return 'stable'
  const delta = (recent - previous) / previous
  if (delta > 0.05) return 'growing'
  if (delta < -0.05) return 'declining'
  return 'stable'
}

const estimateLeaseExpiration = (firstDate?: string) => {
  if (!firstDate) return 'Unknown'
  const ym = /^(\d{4})-(\d{2})/.exec(firstDate)
  if (ym) {
    const year = Number(ym[1]) + 5
    const month = Number(ym[2])
    return `${year}-${String(month).padStart(2, '0')}`
  }
  const parsed = new Date(firstDate)
  if (Number.isNaN(parsed.getTime())) return 'Unknown'
  parsed.setFullYear(parsed.getFullYear() + 5)
  return parsed.toISOString().slice(0, 10)
}

export default function Home() {
  const [owners, setOwners] = useState<OwnerRecord[]>([])
  const [tracts, setTracts] = useState<TractRecord[]>([])
  const [selectedTract, setSelectedTract] = useState<TractRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [motivatedOnly, setMotivatedOnly] = useState(false)
  const [outOfStateOnly, setOutOfStateOnly] = useState(false)
  const [minScore, setMinScore] = useState(0)
  const [showWells, setShowWells] = useState(true)
  const [showOwners, setShowOwners] = useState(true)
  const [skipTracing, setSkipTracing] = useState<string | null>(null)

  const handleSkipTrace = (ownerName: string) => {
    setSkipTracing(ownerName)
  }

  useEffect(() => {
    let mounted = true

    const loadData = async () => {
      setLoading(true)

      const [ownersResp, tractsResp] = await Promise.all([
        supabase
          .from('motivated_owners_with_coords')
          .select('*')
          .order('propensity_score', { ascending: false })
          .limit(500),
        fetch('/gonzales_parcels_enriched.geojson').then((res) => res.json()),
      ])

      if (!mounted) return

      if (ownersResp.error) {
        console.error('Failed to load owners:', ownersResp.error.message)
      } else {
        setOwners((ownersResp.data ?? []) as OwnerRecord[])
      }

      const rows: TractRecord[] = ((tractsResp?.features ?? []) as Array<{ properties?: Record<string, unknown> }>)
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
            prod_cumulative_sum_oil: toNumber(props.prod_cumulative_sum_oil),
            first_6_month_oil: toNumber(props.first_6_month_oil),
            first_12_month_oil: toNumber(props.first_12_month_oil),
            first_24_month_oil: toNumber(props.first_24_month_oil),
            first_60_month_oil: toNumber(props.first_60_month_oil),
          }
        })
        .filter((tract) => tract.abstract_label !== '')

      setTracts(rows)
      setLoading(false)
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
    () => parseOwners(selectedTract?.owners_json ?? ''),
    [selectedTract]
  )
  const productionSeries = useMemo(
    () => buildProductionSeries(selectedTract),
    [selectedTract]
  )
  const productionPeak = useMemo(
    () => productionSeries.reduce((max, point) => Math.max(max, point.oil), 0),
    [productionSeries]
  )
  const productionTrend = useMemo(
    () => getTrend(productionSeries),
    [productionSeries]
  )

  const handleTractClick = (ownerOrTract: OwnerRecord) => {
    const abstract = String(ownerOrTract.abstract_label ?? '').trim()
    const survey = String(ownerOrTract.level1_sur ?? '').trim()
    const existing = tracts.find(
      (tract) =>
        tract.abstract_label === abstract &&
        tract.level1_sur === survey
    )
    if (existing) {
      setSelectedTract(existing)
      return
    }
    setSelectedTract({
      abstract_label: abstract,
      level1_sur: survey,
      owner_count: toNumber(ownerOrTract.owner_count),
      top_operator: String(ownerOrTract.top_operator ?? 'Unknown'),
      max_propensity_score: toNumber(ownerOrTract.max_propensity_score),
      owners_json: String(ownerOrTract.owners_json ?? '[]'),
      field_name: '',
      well_status: '',
      first_date: '',
      prod_cumulative_sum_oil: 0,
      first_6_month_oil: 0,
      first_12_month_oil: 0,
      first_24_month_oil: 0,
      first_60_month_oil: 0,
    })
  }

  return (
    <div
      style={{
        height: '100vh',
        background: '#0D1220',
        color: '#F5F3EE',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Top header */}
      <div
        style={{
          height: 48,
          minHeight: 48,
          borderBottom: '0.5px solid #1E2535',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          alignItems: 'center',
          padding: '0 14px',
        }}
      >
        <div
          style={{
            color: '#EF9F27',
            fontFamily: 'monospace',
            fontSize: 13,
            letterSpacing: '0.12em',
            fontWeight: 600,
          }}
        >
          MINERAL MAP
        </div>
        <div style={{ textAlign: 'center', color: '#7A7870', fontSize: 11 }}>
          Gonzales County, TX · 553 tracts
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {[
            { label: 'owners', value: '73,589' },
            { label: 'out of state', value: '13,551' },
            { label: 'motivated', value: '13,152' },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: '#1E2535',
                border: '0.5px solid #2A2F3E',
                borderRadius: 999,
                padding: '4px 10px',
                display: 'flex',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <span style={{ color: '#EF9F27', fontFamily: 'monospace', fontSize: 11 }}>
                {stat.value}
              </span>
              <span style={{ color: '#7A7870', fontSize: 10 }}>{stat.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Left panel */}
        <div
          style={{
            width: 420,
            minWidth: 420,
            borderRight: '0.5px solid #1E2535',
            overflowY: 'auto',
            padding: 14,
          }}
        >
          {!selectedTract ? (
            <div>
              <div style={{ fontSize: 12, color: '#EF9F27', fontWeight: 600, letterSpacing: '0.08em' }}>
                COUNTY OVERVIEW
              </div>
              <div style={{ borderTop: '0.5px solid #2A2F3E', marginTop: 8, marginBottom: 14 }} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { value: '73,589', label: 'Total mineral owners' },
                  { value: '13,551', label: 'Out of state (18%)' },
                  { value: '13,152', label: 'Motivated sellers' },
                  { value: '553', label: 'Survey tracts' },
                  { value: '4,512', label: 'Active wells' },
                ].map((card) => (
                  <div
                    key={card.label}
                    style={{
                      background: '#1E2535',
                      borderRadius: 8,
                      border: '0.5px solid #2A2F3E',
                      padding: '12px 12px',
                    }}
                  >
                    <div style={{ color: '#EF9F27', fontFamily: 'monospace', fontSize: 20, fontWeight: 600 }}>
                      {card.value}
                    </div>
                    <div style={{ color: '#7A7870', fontSize: 11, marginTop: 3 }}>{card.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, marginBottom: 8, fontSize: 12, color: '#EF9F27', fontWeight: 600 }}>
                TOP 10 HOTTEST TRACTS
              </div>
              <div
                style={{
                  background: '#12192A',
                  border: '0.5px solid #2A2F3E',
                  borderRadius: 8,
                  maxHeight: 340,
                  overflowY: 'auto',
                }}
              >
                {topTracts.map((tract, index) => (
                  <div
                    key={`${tract.abstract_label}-${tract.level1_sur}-${index}`}
                    onClick={() => setSelectedTract(tract)}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '0.5px solid #1A1F2E',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = '#1E2535'
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, marginRight: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#F5F3EE' }}>
                          {tract.abstract_label}
                        </div>
                        <div style={{ fontSize: 11, color: '#7A7870', marginTop: 2 }}>
                          {tract.level1_sur}
                        </div>
                        <div style={{ fontSize: 10, color: '#7A7870', marginTop: 4 }}>
                          {tract.owner_count} owners · {tract.top_operator}
                        </div>
                      </div>
                      <div
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '0.5px solid rgba(255,255,255,0.1)',
                          borderRadius: 999,
                          padding: '2px 8px',
                          color: scoreBadgeColor(tract.max_propensity_score),
                          fontFamily: 'monospace',
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

              <div style={{ marginTop: 18, marginBottom: 8, fontSize: 12, color: '#EF9F27', fontWeight: 600 }}>
                COUNTY BREAKDOWN
              </div>
              <div style={{ background: '#12192A', border: '0.5px solid #2A2F3E', borderRadius: 8, padding: 12 }}>
                {[
                  { label: 'EOG Resources', pct: 68 },
                  { label: 'Baytex Energy', pct: 21 },
                  { label: 'Marathon Oil', pct: 7 },
                  { label: 'Other', pct: 4 },
                ].map((row) => (
                  <div key={row.label} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: '#F5F3EE' }}>{row.label}</span>
                      <span style={{ color: '#7A7870' }}>{row.pct}%</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 4, background: '#1E2535' }}>
                      <div style={{ width: `${row.pct}%`, height: 7, borderRadius: 4, background: '#EF9F27' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <button
                onClick={() => setSelectedTract(null)}
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#EF9F27',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                  marginBottom: 12,
                }}
              >
                ← Back to overview
              </button>

              <div style={{ fontSize: 22, fontFamily: 'monospace', color: '#F5F3EE', fontWeight: 600 }}>
                TRACT {selectedTract.abstract_label}
              </div>
              <div style={{ color: '#7A7870', marginTop: 4 }}>{selectedTract.level1_sur} Survey</div>
              <div style={{ borderTop: '0.5px solid #2A2F3E', marginTop: 10, marginBottom: 10 }} />

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: 'rgba(244,67,54,0.15)', color: '#F44336', border: '0.5px solid rgba(244,67,54,0.35)' }}>
                  {selectedTract.max_propensity_score}/10 HOT
                </span>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: 'rgba(239,159,39,0.15)', color: '#EF9F27', border: '0.5px solid rgba(239,159,39,0.35)' }}>
                  {selectedTract.owner_count} owners
                </span>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: 'rgba(255,255,255,0.06)', color: '#7A7870', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                  {selectedTract.top_operator}
                </span>
              </div>

              <div style={{ background: '#12192A', border: '0.5px solid #2A2F3E', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                <div style={{ color: '#EF9F27', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>PRODUCTION HISTORY</div>
                <div style={{ height: 140 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={productionSeries}>
                      <XAxis dataKey="month" stroke="#7A7870" tick={{ fill: '#7A7870', fontSize: 10 }} />
                      <YAxis stroke="#7A7870" tick={{ fill: '#7A7870', fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ background: '#1E2535', border: '0.5px solid #2A2F3E', color: '#F5F3EE' }}
                        labelStyle={{ color: '#7A7870' }}
                      />
                      <Line type="monotone" dataKey="oil" stroke="#EF9F27" strokeWidth={2} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#7A7870' }}>
                  <span>Peak production: {productionPeak.toLocaleString()}</span>
                  <span>Current trend: {productionTrend}</span>
                </div>
              </div>

              <div style={{ background: '#12192A', border: '0.5px solid #2A2F3E', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                <div style={{ color: '#EF9F27', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>OPERATOR & LEASE INFO</div>
                <div style={{ fontSize: 12, color: '#F5F3EE', marginBottom: 6 }}>Operator: {selectedTract.top_operator}</div>
                <div style={{ fontSize: 12, color: '#F5F3EE', marginBottom: 6 }}>Field: {selectedTract.field_name || 'Unknown'}</div>
                <div style={{ fontSize: 12, color: '#F5F3EE', marginBottom: 6 }}>Well status: {selectedTract.well_status || 'PRODUCING / SHUT IN'}</div>
                <div style={{ fontSize: 12, color: '#F5F3EE' }}>Est. lease expiration: {estimateLeaseExpiration(selectedTract.first_date)}</div>
              </div>

              <div style={{ background: '#12192A', border: '0.5px solid #2A2F3E', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                <div style={{ color: '#EF9F27', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>COMPARABLE SALES</div>
                <div style={{ fontSize: 11, color: '#7A7870' }}>
                  No comp data available yet — comps unlock after first closed deal
                </div>
              </div>

              <div style={{ fontSize: 12, color: '#EF9F27', fontWeight: 600, marginBottom: 8 }}>
                ALL OWNERS IN TRACT ({selectedOwners.length})
              </div>
              <div style={{ background: '#12192A', border: '0.5px solid #2A2F3E', borderRadius: 8, overflow: 'hidden' }}>
                {selectedOwners.map((owner, index) => {
                  const score = toNumber(owner.propensity_score)
                  const acreage = toNumber(owner.acreage)
                  const ownershipPct = toNumber(owner.ownership_pct)
                  const hasPhone = Boolean(owner.phone)
                  const hasEmail = Boolean(owner.email)
                  return (
                    <div
                      key={`${owner.owner_name}-${index}`}
                      style={{ padding: '10px 12px', borderBottom: '0.5px solid #1A1F2E' }}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.background = '#1E2535'
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, marginRight: 8 }}>
                          <div style={{ fontSize: 12, color: '#F5F3EE', fontWeight: 600 }}>
                            {index + 1}. {owner.owner_name}
                          </div>
                          <div style={{ fontSize: 10, color: '#7A7870', marginTop: 2 }}>
                            {owner.address_1 || owner.mailing_address || 'Address unknown'}
                          </div>
                          <div style={{ fontSize: 10, color: '#7A7870' }}>
                            {owner.mailing_city || 'Unknown city'}, {owner.mailing_state || '--'} {owner.mailing_zip || ''}
                          </div>
                          <div style={{ fontSize: 10, color: '#7A7870', marginTop: 2 }}>
                            {acreage > 0 ? `${acreage.toFixed(2)} acres` : 'Acreage unknown'} ·{' '}
                            {ownershipPct > 0 ? `${ownershipPct.toFixed(4)}%` : 'Ownership unknown'}
                          </div>
                          {!hasPhone && !hasEmail ? (
                            <button
                              onClick={() => handleSkipTrace(owner.owner_name)}
                              style={{
                                marginTop: 6,
                                fontSize: 10,
                                padding: '3px 10px',
                                borderRadius: 4,
                                background: 'transparent',
                                border: '0.5px solid #4A4F5E',
                                color: '#7A7870',
                                cursor: 'pointer',
                                fontFamily: 'monospace',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#EF9F27')}
                              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#4A4F5E')}
                            >
                              ⟳ Skip trace contact info
                            </button>
                          ) : (
                            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {hasPhone && (
                                <div style={{ fontSize: 10, color: '#F5F3EE', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ color: '#7A7870' }}>📞</span>
                                  <span>{owner.phone}</span>
                                  <a href={`tel:${owner.phone}`} style={{ fontSize: 9, color: '#EF9F27', textDecoration: 'none' }}>call</a>
                                </div>
                              )}
                              {hasEmail && (
                                <div style={{ fontSize: 10, color: '#F5F3EE', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ color: '#7A7870' }}>✉</span>
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
                              fontFamily: 'monospace',
                              fontWeight: 600,
                            }}
                          >
                            {score}/10
                          </span>
                          {owner.out_of_state && (
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'rgba(239,159,39,0.15)', color: '#EF9F27', border: '0.5px solid rgba(239,159,39,0.3)' }}>
                              OOS
                            </span>
                          )}
                          {owner.motivated && (
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'rgba(244,67,54,0.15)', color: '#F44336', border: '0.5px solid rgba(244,67,54,0.3)' }}>
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
                <button style={{ flex: 1, padding: '9px', borderRadius: 6, border: '0.5px solid rgba(239,159,39,0.4)', background: 'rgba(239,159,39,0.15)', color: '#EF9F27', cursor: 'pointer', fontFamily: 'monospace' }}>
                  Add all to pipeline
                </button>
                <button style={{ flex: 1, padding: '9px', borderRadius: 6, border: '0.5px solid #2A2F3E', background: 'transparent', color: '#7A7870', cursor: 'pointer', fontFamily: 'monospace' }}>
                  Export CSV
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Map area */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {loading ? (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EF9F27', fontFamily: 'monospace' }}>
              Loading...
            </div>
          ) : (
            <MineralMap
              owners={owners}
              wells={[]}
              motivatedOnly={motivatedOnly}
              outOfStateOnly={outOfStateOnly}
              minScore={minScore}
              showWells={showWells}
              showMotivated={showOwners}
              onTractClick={handleTractClick}
              focusedTract={selectedTract}
            />
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          height: 44,
          minHeight: 44,
          borderTop: '0.5px solid #1E2535',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 12px',
          color: '#F5F3EE',
          fontSize: 11,
        }}
      >
        <span>Motivated only</span>
        <button
          onClick={() => setMotivatedOnly((prev) => !prev)}
          style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            border: 'none',
            background: motivatedOnly ? '#EF9F27' : '#2A2F3E',
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

        <span>Out of state</span>
        <button
          onClick={() => setOutOfStateOnly((prev) => !prev)}
          style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            border: 'none',
            background: outOfStateOnly ? '#EF9F27' : '#2A2F3E',
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

        <span>Min score</span>
        <input
          type="range"
          min={0}
          max={10}
          value={minScore}
          onChange={(event) => setMinScore(Number(event.target.value))}
          style={{ width: 160, accentColor: '#EF9F27' }}
        />
        <span style={{ fontFamily: 'monospace', color: '#EF9F27' }}>{minScore}</span>

        <span>Layers:</span>
        <button onClick={() => setShowWells((prev) => !prev)} style={{ background: 'none', border: 'none', color: showWells ? '#7AB835' : '#7A7870', cursor: 'pointer' }}>
          ● Wells
        </button>
        <button onClick={() => setShowOwners((prev) => !prev)} style={{ background: 'none', border: 'none', color: showOwners ? '#EF9F27' : '#7A7870', cursor: 'pointer' }}>
          ● Owners
        </button>

        <span style={{ marginLeft: 'auto' }}>Scale:</span>
        <div style={{ width: 180, height: 8, borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
          {['#1a3a1a', '#2d6a2d', '#4CAF50', '#8BC34A', '#FFC107', '#FF9800', '#F44336', '#B71C1C'].map((color) => (
            <div key={color} style={{ flex: 1, background: color }} />
          ))}
        </div>
      </div>

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
              background: '#1E2535',
              border: '0.5px solid #2A2F3E',
              borderRadius: 12,
              padding: '24px',
              width: 320,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: '#F5F3EE', marginBottom: 8 }}>
              Skip trace this owner?
            </div>
            <div style={{ fontSize: 12, color: '#7A7870', marginBottom: 6 }}>
              {skipTracing}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#7A7870',
                marginBottom: 20,
                padding: '10px 12px',
                background: '#0D1220',
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
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: 6,
                  background: 'transparent',
                  border: '0.5px solid #2A2F3E',
                  color: '#7A7870',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  console.log('Skip tracing:', skipTracing)
                  setSkipTracing(null)
                }}
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: 6,
                  background: 'rgba(239,159,39,0.15)',
                  border: '0.5px solid rgba(239,159,39,0.4)',
                  color: '#EF9F27',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                }}
              >
                Skip trace →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
