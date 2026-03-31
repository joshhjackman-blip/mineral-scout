'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'

import { supabase } from '@/lib/supabase'
import type { OwnerRecord, WellRecord } from './components/Map'

const MineralMap = dynamic(() => import('./components/Map'), { ssr: false })

const scoreColor = (s: number) =>
  s >= 9 ? '#B71C1C' :
  s >= 8 ? '#F44336' :
  s >= 7 ? '#FF9800' :
  s >= 6 ? '#FFC107' :
  s >= 5 ? '#8BC34A' :
  s >= 4 ? '#4CAF50' :
  '#2d6a2d'

const parseNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const toBool = (value: unknown): boolean => value === true

type ParcelSelection = {
  max_propensity_score: number
  owner_count: number
  top_owner: string
  top_owner_state: string
  top_operator: string
}

export default function Home() {
  const [motivatedOnly, setMotivatedOnly] = useState(false)
  const [outOfStateOnly, setOutOfStateOnly] = useState(false)
  const [minScore, setMinScore] = useState(0)
  const [showWells, setShowWells] = useState(true)
  const [showMotivated, setShowMotivated] = useState(true)
  const [owners, setOwners] = useState<OwnerRecord[]>([])
  const [wells, setWells] = useState<WellRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<(OwnerRecord & Partial<ParcelSelection>) | null>(null)

  useEffect(() => {
    let mounted = true

    const loadData = async () => {
      setLoading(true)

      const { data: ownerRows, error: ownerError } = await supabase
        .from('motivated_owners_with_coords')
        .select(
          'owner_name, mailing_city, mailing_state, operator_name, propensity_score, motivated, out_of_state, acreage, prod_cumulative_sum_oil, rrc_lease_id, latitude, longitude, well_status'
        )
        .order('propensity_score', { ascending: false })
        .limit(500)

      if (ownerError) {
        console.error('Failed to load owners:', ownerError.message)
      } else {
        console.log('Owners loaded successfully:', ownerRows?.length)
      }

      const { data: wellsRows, error: wellsError } = await supabase
        .from('gonzales_wells')
        .select('rrc_lease_id, latitude, longitude, well_status, operator_name')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .limit(5000)

      if (wellsError) {
        console.error('Failed to load wells:', wellsError.message)
      }

      console.log('Total owners fetched:', ownerRows?.length)
      console.log('Total wells fetched:', wellsRows?.length)
      console.log('Sample owner rrc_lease_id:', ownerRows?.[0]?.rrc_lease_id)
      console.log('Sample well rrc_lease_id:', wellsRows?.[0]?.rrc_lease_id)
      console.log('Owner lease type:', typeof ownerRows?.[0]?.rrc_lease_id)
      console.log('Well lease type:', typeof wellsRows?.[0]?.rrc_lease_id)

      if (!mounted) return

      const wellsData = (wellsRows ?? []) as WellRecord[]
      const viewOwners: OwnerRecord[] = ((ownerRows ?? []) as Record<string, unknown>[])
        .map((row, idx) => {
          return {
            id: idx + 1,
            owner_name: ((row.owner_name as string | null) ?? 'Unknown Owner').trim(),
            mailing_city: ((row.mailing_city as string | null) ?? 'Unknown').trim(),
            mailing_state: ((row.mailing_state as string | null) ?? 'TX').trim(),
            operator_name: ((row.operator_name as string | null) ?? 'Unknown Operator').trim(),
            propensity_score: parseNumber(row.propensity_score) ?? 0,
            motivated: toBool(row.motivated),
            out_of_state: toBool(row.out_of_state),
            acreage: parseNumber(row.acreage),
            prod_cumulative_sum_oil: parseNumber(row.prod_cumulative_sum_oil),
            rrc_lease_id: ((row.rrc_lease_id as string | null) ?? null),
            latitude: parseNumber(row.latitude),
            longitude: parseNumber(row.longitude),
            well_status: ((row.well_status as string | null) ?? 'UNKNOWN').trim(),
          }
        })

      const displayOwners: OwnerRecord[] =
        viewOwners.length > 0
          ? viewOwners
          : ((ownerRows ?? []) as Record<string, unknown>[])
              .slice(0, 50)
              .map((row, idx) => ({
                id: idx + 1,
                owner_name: ((row.owner_name as string | null) ?? 'Unknown Owner').trim(),
                mailing_city: ((row.mailing_city as string | null) ?? 'Unknown').trim(),
                mailing_state: ((row.mailing_state as string | null) ?? 'TX').trim(),
                operator_name: ((row.operator_name as string | null) ?? 'Unknown Operator').trim(),
                propensity_score: parseNumber(row.propensity_score) ?? 0,
                motivated: toBool(row.motivated),
                out_of_state: toBool(row.out_of_state),
                acreage: parseNumber(row.acreage),
                prod_cumulative_sum_oil: parseNumber(row.prod_cumulative_sum_oil),
                rrc_lease_id: ((row.rrc_lease_id as string | null) ?? null),
                latitude: null,
                longitude: null,
                well_status: 'UNKNOWN',
              }))

      setOwners(displayOwners)
      setWells(wellsData)
      setSelected((prev) => {
        if (!prev) return null
        return displayOwners.find((o) => o.id === prev.id) ?? null
      })
      setLoading(false)
    }

    loadData()

    return () => {
      mounted = false
    }
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
          <div style={{ fontSize: 11, color: '#7A7870', marginTop: 3 }}>Gonzales County, TX</div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '12px 12px 0' }}>
          {[
            { val: owners.length.toLocaleString(), lbl: 'owners' },
            { val: owners.filter((o) => o.out_of_state).length.toLocaleString(), lbl: 'out of state' },
            { val: owners.filter((o) => o.motivated).length.toLocaleString(), lbl: 'motivated' },
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
          {topProspects.map((p) => (
            <div
              key={`${p.id}-${p.owner_name}`}
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
            wells={wells}
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
          <div style={{ padding: '14px 16px 12px', borderBottom: '0.5px solid #1E2535', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 9, color: '#7A7870', letterSpacing: '0.08em', marginBottom: 5 }}>MINERAL OWNER</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#F5F3EE', lineHeight: 1.35 }}>{selected.owner_name}</div>
            </div>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#7A7870', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: '10px 16px', borderBottom: '0.5px solid #1E2535', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {selected.out_of_state && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(239,159,39,0.12)', color: '#EF9F27', border: '0.5px solid rgba(239,159,39,0.3)' }}>Out of state</span>}
            {selected.motivated && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(122,184,53,0.12)', color: '#7AB835', border: '0.5px solid rgba(122,184,53,0.3)' }}>Motivated</span>}
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: '#7A7870', border: '0.5px solid rgba(255,255,255,0.12)' }}>{selected.operator_name}</span>
          </div>
          <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #1E2535', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'PROPENSITY', val: `${selected.propensity_score}/10` },
              { label: 'LOCATION', val: `${selected.mailing_city}, ${selected.mailing_state}` },
              { label: 'OPERATOR', val: selected.operator_name },
              { label: 'STATUS', val: selected.motivated ? 'Motivated' : 'Standard' },
            ].map(m => (
              <div key={m.label} style={{ background: '#1E2535', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 9, color: '#7A7870', marginBottom: 3 }}>{m.label}</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#F5F3EE', fontFamily: 'monospace' }}>{m.val}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #1E2535', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#F5F3EE' }}>Top owner: {selected.top_owner ?? selected.owner_name}</div>
            <div style={{ fontSize: 12, color: '#F5F3EE' }}>Owners in tract: {selected.owner_count ?? 1}</div>
            <div style={{ fontSize: 12, color: '#F5F3EE' }}>Location: {selected.top_owner_state ?? selected.mailing_state}</div>
          </div>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
            <button style={{ width: '100%', padding: '9px', borderRadius: 6, background: 'rgba(239,159,39,0.15)', border: '0.5px solid rgba(239,159,39,0.4)', color: '#EF9F27', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}>
              Add to pipeline
            </button>
            <button style={{ width: '100%', padding: '9px', borderRadius: 6, background: 'transparent', border: '0.5px solid #2A2F3E', color: '#7A7870', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}>
              Get contact info
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
