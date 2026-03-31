'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'

import { supabase } from '@/lib/supabase'
import type { OwnerRecord } from './components/Map'

const MineralMap = dynamic(() => import('./components/Map'), { ssr: false })

const scoreColor = (s: number) =>
  s >= 9 ? '#B71C1C' :
  s >= 8 ? '#F44336' :
  s >= 7 ? '#FF9800' :
  s >= 6 ? '#FFC107' :
  s >= 5 ? '#8BC34A' :
  s >= 4 ? '#4CAF50' :
  '#2d6a2d'

type ParcelSelection = {
  max_propensity_score: number
  owner_count: number
  top_owner: string
  top_owner_state: string
  top_operator: string
  abstract_label: string
  level1_sur: string
  owners_json: string
}

export default function Home() {
  const [motivatedOnly, setMotivatedOnly] = useState(false)
  const [outOfStateOnly, setOutOfStateOnly] = useState(false)
  const [minScore, setMinScore] = useState(0)
  const [showWells, setShowWells] = useState(true)
  const [showMotivated, setShowMotivated] = useState(true)
  const [owners, setOwners] = useState<OwnerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<(OwnerRecord & Partial<ParcelSelection>) | null>(null)

  const selectedOwnersList = useMemo(() => {
    if (!selected?.owners_json) return []
    try {
      const parsed = JSON.parse(selected.owners_json) as Array<Record<string, unknown>>
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }, [selected?.owners_json])

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const { data, error } = await supabase
        .from('motivated_owners_with_coords')
        .select('*')
        .order('propensity_score', { ascending: false })
        .limit(500)
      if (error) {
        console.error('Failed to load:', error.message)
      } else {
        console.log('Loaded owners:', data?.length)
        setOwners((data ?? []) as OwnerRecord[])
      }
      setLoading(false)
    }
    loadData()
  }, [])

  const filtered = useMemo(
    () =>
      owners.filter((p) => {
        if (motivatedOnly && !p.motivated) return false
        if (outOfStateOnly && !p.out_of_state) return false
        if (p.propensity_score < minScore) return false
        return true
      }),
    [owners, motivatedOnly, outOfStateOnly, minScore]
  )

  const topProspects = filtered.slice(0, 50)

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0D1220', color: '#F5F3EE', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>

      {/* SIDEBAR */}
      <div style={{ width: 272, minWidth: 272, background: '#0D1220', borderRight: '0.5px solid #2A2F3E', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '0.5px solid #1E2535' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#EF9F27', letterSpacing: '0.12em', fontFamily: 'monospace' }}>MINERAL MAP</div>
          <div style={{ fontSize: 11, color: '#7A7870', marginTop: 3 }}>Gonzales County, TX · 553 tracts</div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '12px 12px 0' }}>
          {[
            { val: '73,589', lbl: 'total owners' },
            { val: '13,551', lbl: 'out of state' },
            { val: '13,152', lbl: 'motivated' },
          ].map((s) => (
            <div key={s.lbl} style={{ background: '#1E2535', borderRadius: 6, padding: '8px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#EF9F27', fontFamily: 'monospace' }}>{s.val}</div>
              <div style={{ fontSize: 9, color: '#7A7870', marginTop: 2 }}>{s.lbl}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ padding: '14px 12px 0' }}>
          <div style={{ fontSize: 9, color: '#7A7870', letterSpacing: '0.08em', marginBottom: 10, fontWeight: 600 }}>FILTERS</div>
          {[
            { label: 'Motivated only', val: motivatedOnly, set: setMotivatedOnly },
            { label: 'Out of state only', val: outOfStateOnly, set: setOutOfStateOnly },
          ].map((f) => (
            <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#F5F3EE' }}>{f.label}</span>
              <div onClick={() => f.set(!f.val)} style={{ width: 32, height: 18, borderRadius: 9, background: f.val ? '#EF9F27' : '#2A2F3E', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 2, left: f.val ? 14 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </div>
            </div>
          ))}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#F5F3EE' }}>Min score</span>
              <span style={{ fontSize: 12, color: '#EF9F27', fontFamily: 'monospace' }}>{minScore}</span>
            </div>
            <input type="range" min={0} max={10} value={minScore} onChange={e => setMinScore(+e.target.value)} style={{ width: '100%', accentColor: '#EF9F27' }} />
          </div>
        </div>

        {/* Layers */}
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ fontSize: 9, color: '#7A7870', letterSpacing: '0.08em', marginBottom: 10, fontWeight: 600 }}>LAYERS</div>
          {[
            { label: 'Active wells', val: showWells, set: setShowWells, color: '#7AB835' },
            { label: 'Motivated owners', val: showMotivated, set: setShowMotivated, color: '#EF9F27' },
          ].map((l) => (
            <div key={l.label} onClick={() => l.set(!l.val)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', opacity: l.val ? 1 : 0.4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#F5F3EE' }}>{l.label}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ fontSize: 9, color: '#7A7870', letterSpacing: '0.08em', marginBottom: 8, fontWeight: 600 }}>PROPENSITY SCALE</div>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
            {['#1a3a1a','#2d6a2d','#4CAF50','#8BC34A','#FFC107','#FF9800','#F44336','#B71C1C'].map((c, i) => (
              <div key={i} style={{ flex: 1, background: c }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 9, color: '#7A7870' }}>Low</span>
            <span style={{ fontSize: 9, color: '#7A7870' }}>High</span>
          </div>
        </div>

        {/* Prospect list */}
        <div style={{ flex: 1, overflowY: 'auto', borderTop: '0.5px solid #1E2535' }}>
          <div style={{ padding: '10px 12px 6px', fontSize: 9, color: '#7A7870', letterSpacing: '0.08em', fontWeight: 600 }}>TOP PROSPECTS</div>
          {topProspects.map((p, index) => (
            <div
              key={`${index}-${p.owner_name}`}
              onClick={() => setSelected(p)}
              style={{ padding: '8px 12px', borderBottom: '0.5px solid #1A1F2E', cursor: 'pointer', background: selected?.id === p.id ? '#1E2535' : 'transparent' }}
              onMouseEnter={(e) => { if (selected?.id !== p.id) (e.currentTarget as HTMLDivElement).style.background = '#161B27' }}
              onMouseLeave={(e) => { if (selected?.id !== p.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontSize: 11, color: '#F5F3EE', fontWeight: 500, flex: 1, marginRight: 8, lineHeight: 1.3 }}>{p.owner_name}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: scoreColor(p.propensity_score), fontFamily: 'monospace', flexShrink: 0 }}>{p.propensity_score}/10</div>
              </div>
              <div style={{ fontSize: 10, color: '#7A7870', marginTop: 2 }}>{p.mailing_city}, {p.mailing_state} · {p.operator_name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MAP */}
      <div style={{ flex: 1, position: 'relative' }}>
        {loading ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#EF9F27',
              fontFamily: 'monospace',
              fontSize: '1.25rem',
            }}
          >
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
            showMotivated={showMotivated}
            onOwnerClick={setSelected}
          />
        )}
      </div>

      {/* OWNER PANEL */}
      {selected && (
        <div style={{ width: 280, background: '#161B27', borderLeft: '0.5px solid #2A2F3E', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tract header */}
          <div style={{ padding: '14px 16px 12px', borderBottom: '0.5px solid #1E2535' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div style={{ fontSize: 9, color: '#7A7870', letterSpacing: '0.08em' }}>TRACT</div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#7A7870', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#F5F3EE' }}>
              {selected.abstract_label ?? 'Unknown Abstract'}
            </div>
            <div style={{ fontSize: 11, color: '#7A7870', marginTop: 2 }}>
              {selected.level1_sur ?? 'Unknown Survey'}
            </div>
            <div style={{ fontSize: 11, color: '#7A7870', marginTop: 2 }}>
              {selected.owner_count ?? 0} owners · {selected.top_operator ?? 'Unknown operator'}
            </div>
          </div>

          {/* Owner list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {selectedOwnersList.map((owner, i) => {
              const score = Number(owner.propensity_score ?? 0)
              const scoreChipColor =
                score >= 8 ? '#F44336' : score >= 6 ? '#FF9800' : score >= 4 ? '#FFC107' : '#4CAF50'
              const acreage = Number(owner.acreage ?? 0)
              const ownershipPct = Number(owner.ownership_pct ?? 0)
              return (
                <div key={i} style={{ padding: '10px 16px', borderBottom: '0.5px solid #1A1F2E' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, marginRight: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: '#F5F3EE', lineHeight: 1.3 }}>
                        {i + 1}. {String(owner.owner_name ?? 'Unknown Owner')}
                      </div>
                      <div style={{ fontSize: 10, color: '#7A7870', marginTop: 2 }}>
                        {owner.mailing_city && owner.mailing_state
                          ? `${String(owner.mailing_city)}, ${String(owner.mailing_state)}`
                          : 'Address unknown'}
                      </div>
                      {acreage > 0 && (
                        <div style={{ fontSize: 10, color: '#7A7870' }}>
                          {acreage.toFixed(2)} acres
                        </div>
                      )}
                      {ownershipPct > 0 && (
                        <div style={{ fontSize: 10, color: '#7A7870' }}>
                          {ownershipPct.toFixed(4)}% ownership
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: scoreChipColor, fontFamily: 'monospace' }}>
                        {score}/10
                      </div>
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

          {/* Actions */}
          <div style={{ padding: '12px 16px', borderTop: '0.5px solid #1E2535', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button style={{ width: '100%', padding: '9px', borderRadius: 6, background: 'rgba(244,67,54,0.15)', border: '0.5px solid rgba(244,67,54,0.4)', color: '#F44336', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}>
              Add all to pipeline
            </button>
            <button style={{ width: '100%', padding: '9px', borderRadius: 6, background: 'transparent', border: '0.5px solid #2A2F3E', color: '#7A7870', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}>
              Export tract owners
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
