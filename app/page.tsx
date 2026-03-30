'use client'
import { useState, Suspense } from 'react'
import dynamic from 'next/dynamic'

const Map = dynamic(() => import('./components/Map'), { ssr: false })

const PROSPECTS = [
  { name: 'Margaret L. Hoffmann', city: 'Columbus', state: 'OH', score: 9, operator: 'EOG Resources', motivated: true, lat: 29.45, lng: -97.45 },
  { name: 'Patricia M. Swenson', city: 'Madison', state: 'WI', score: 9, operator: 'EOG Resources', motivated: true, lat: 29.52, lng: -97.38 },
  { name: 'Linda J. Vasquez', city: 'Phoenix', state: 'AZ', score: 9, operator: 'Baytex Energy', motivated: true, lat: 29.41, lng: -97.51 },
  { name: 'Estate of Roy T. Briggs', city: 'Cuero', state: 'TX', score: 8, operator: 'EOG Resources', motivated: true, lat: 29.48, lng: -97.42 },
  { name: 'Carol Ann Petersen', city: 'Minneapolis', state: 'MN', score: 8, operator: 'Baytex Energy', motivated: true, lat: 29.55, lng: -97.48 },
  { name: 'R&J Land Holdings LLC', city: 'Las Vegas', state: 'NV', score: 8, operator: 'Baytex Energy', motivated: true, lat: 29.50, lng: -97.35 },
  { name: 'Sunrise Minerals LLC', city: 'Wilmington', state: 'DE', score: 7, operator: 'EOG Resources', motivated: true, lat: 29.43, lng: -97.55 },
  { name: 'Thomas P. Blanchard Jr.', city: 'Tampa', state: 'FL', score: 7, operator: 'Marathon Oil', motivated: true, lat: 29.38, lng: -97.44 },
  { name: 'Walter E. Simmons III', city: 'Atlanta', state: 'GA', score: 7, operator: 'Baytex Energy', motivated: true, lat: 29.51, lng: -97.43 },
  { name: 'Gerald Kowalski', city: 'Gonzales', state: 'TX', score: 6, operator: 'Marathon Oil', motivated: false, lat: 29.44, lng: -97.39 },
]

const scoreColor = (s: number) => s >= 8 ? '#7AB835' : s >= 5 ? '#EF9F27' : '#D85A30'

export default function Home() {
  const [motivatedOnly, setMotivatedOnly] = useState(false)
  const [outOfStateOnly, setOutOfStateOnly] = useState(false)
  const [minScore, setMinScore] = useState(0)
  const [showWells, setShowWells] = useState(true)
  const [showMotivated, setShowMotivated] = useState(true)
  const [selected, setSelected] = useState<typeof PROSPECTS[0] | null>(null)

  const filtered = PROSPECTS.filter(p => {
    if (motivatedOnly && !p.motivated) return false
    if (outOfStateOnly && p.state === 'TX') return false
    if (p.score < minScore) return false
    return true
  })

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
            { val: '73,589', lbl: 'owners' },
            { val: '13,551', lbl: 'out of state' },
            { val: '12,902', lbl: 'motivated' },
          ].map(s => (
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
          ].map(f => (
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
          ].map(l => (
            <div key={l.label} onClick={() => l.set(!l.val)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', opacity: l.val ? 1 : 0.4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#F5F3EE' }}>{l.label}</span>
            </div>
          ))}
        </div>

        {/* Prospect list */}
        <div style={{ flex: 1, overflowY: 'auto', borderTop: '0.5px solid #1E2535' }}>
          <div style={{ padding: '10px 12px 6px', fontSize: 9, color: '#7A7870', letterSpacing: '0.08em', fontWeight: 600 }}>TOP PROSPECTS</div>
          {filtered.map(p => (
            <div key={p.name} onClick={() => setSelected(p)} style={{ padding: '8px 12px', borderBottom: '0.5px solid #1A1F2E', cursor: 'pointer', background: selected?.name === p.name ? '#1E2535' : 'transparent' }}
              onMouseEnter={e => { if (selected?.name !== p.name) (e.currentTarget as HTMLDivElement).style.background = '#161B27' }}
              onMouseLeave={e => { if (selected?.name !== p.name) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontSize: 11, color: '#F5F3EE', fontWeight: 500, flex: 1, marginRight: 8, lineHeight: 1.3 }}>{p.name}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: scoreColor(p.score), fontFamily: 'monospace', flexShrink: 0 }}>{p.score}/10</div>
              </div>
              <div style={{ fontSize: 10, color: '#7A7870', marginTop: 2 }}>{p.city}, {p.state} · {p.operator}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MAP */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Map
          motivatedOnly={motivatedOnly}
          outOfStateOnly={outOfStateOnly}
          minScore={minScore}
          showWells={showWells}
          showMotivated={showMotivated}
          onOwnerClick={setSelected}
        />
      </div>

      {/* OWNER PANEL */}
      {selected && (
        <div style={{ width: 280, background: '#161B27', borderLeft: '0.5px solid #2A2F3E', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 12px', borderBottom: '0.5px solid #1E2535', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 9, color: '#7A7870', letterSpacing: '0.08em', marginBottom: 5 }}>MINERAL OWNER</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#F5F3EE', lineHeight: 1.35 }}>{selected.name}</div>
            </div>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#7A7870', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: '10px 16px', borderBottom: '0.5px solid #1E2535', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {selected.state !== 'TX' && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(239,159,39,0.12)', color: '#EF9F27', border: '0.5px solid rgba(239,159,39,0.3)' }}>Out of state</span>}
            {selected.motivated && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(122,184,53,0.12)', color: '#7AB835', border: '0.5px solid rgba(122,184,53,0.3)' }}>Motivated</span>}
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: '#7A7870', border: '0.5px solid rgba(255,255,255,0.12)' }}>{selected.operator}</span>
          </div>
          <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #1E2535', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'PROPENSITY', val: `${selected.score}/10` },
              { label: 'LOCATION', val: `${selected.city}, ${selected.state}` },
              { label: 'OPERATOR', val: selected.operator },
              { label: 'STATUS', val: selected.motivated ? 'Motivated' : 'Standard' },
            ].map(m => (
              <div key={m.label} style={{ background: '#1E2535', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 9, color: '#7A7870', marginBottom: 3 }}>{m.label}</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#F5F3EE', fontFamily: 'monospace' }}>{m.val}</div>
              </div>
            ))}
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
