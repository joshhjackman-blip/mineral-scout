'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

const SQM_PER_ACRE = 4046.86

const FAKE_NAMES = [
  'HAR██████ J.T.',
  'BRO██████ M.K.',
  'WIL████ R.L.',
  'MCG████ S.A.',
  'THO██████ D.W.',
  'AND█████ P.K.',
  'DAV████ TRUST',
  'JOH██████ FAMILY TRUST',
  'WES████ MINERALS LLC',
  'SMI████ ENERGY LLC',
]

const FAKE_CITIES = [
  { city: 'Denver', state: 'CO' },
  { city: 'Phoenix', state: 'AZ' },
  { city: 'Dallas', state: 'TX' },
  { city: 'Houston', state: 'TX' },
  { city: 'Chicago', state: 'IL' },
  { city: 'Nashville', state: 'TN' },
  { city: 'Austin', state: 'TX' },
  { city: 'San Antonio', state: 'TX' },
]

const FAKE_OPERATORS = [
  'EOG Resources',
  'Baytex Energy USA, Inc.',
  'Marathon Oil',
  'Auterra Operating, LLC',
  'Lacy 03 LLC',
]

type FakeOwner = {
  name: string
  city: string
  state: string
  score: number
  decimal: number
  nra: number
  label: 'IND' | 'TRUST' | 'CO'
}

type SelectedTract = {
  abstractLabel: string
  fakeAcreage: number
  operator: string
  score: number
  owners: FakeOwner[]
}

const hashString = (value: string): number => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

const scoreColor = (score: number): string => {
  if (score >= 8) return '#F44336'
  if (score >= 5) return '#FF9800'
  if (score >= 2) return '#FFC107'
  return '#9CA3AF'
}

const scoreLabelFromName = (name: string): 'IND' | 'TRUST' | 'CO' => {
  const upper = name.toUpperCase()
  if (upper.includes('TRUST')) return 'TRUST'
  if (upper.includes('LLC') || upper.includes('MINERALS') || upper.includes('ENERGY')) return 'CO'
  return 'IND'
}

const baseScoreForOwner = (tractScore: number, index: number, seed: number): number => {
  const spread = ((seed >> (index * 3)) % 3) - 1
  const raw = tractScore - index + spread
  const minScore = tractScore >= 8 ? 6 : tractScore >= 5 ? 4 : 1
  return Math.max(minScore, Math.min(10, raw))
}

const getAcreageFromProps = (props: Record<string, unknown>): number => {
  const shapeArea = Number(props.SHAPE_AREA ?? props.shape_area ?? 0)
  if (Number.isFinite(shapeArea) && shapeArea > 0) {
    return Number((shapeArea / SQM_PER_ACRE).toFixed(1))
  }
  return 160
}

const makeFakeOwners = (
  abstractLabel: string,
  tractScore: number,
  fakeAcreage: number
): FakeOwner[] => {
  const seed = hashString(abstractLabel || 'AB-UNKNOWN')
  const ownerCount = 2 + (seed % 3)
  const usedNameIdx = new Set<number>()
  const owners: FakeOwner[] = []

  for (let i = 0; i < ownerCount; i += 1) {
    let nameIdx = (seed + i * 7) % FAKE_NAMES.length
    while (usedNameIdx.has(nameIdx)) {
      nameIdx = (nameIdx + 1) % FAKE_NAMES.length
    }
    usedNameIdx.add(nameIdx)

    const cityIdx = (seed + i * 5) % FAKE_CITIES.length
    const decimalBase = ((seed + i * 29) % 160) / 10000 + 0.0008
    const decimal = i === ownerCount - 1 && tractScore < 4
      ? 0.18
      : Number(decimalBase.toFixed(5))
    const nra = Number((fakeAcreage * decimal).toFixed(3))
    const score = baseScoreForOwner(tractScore, i, seed)
    const name = FAKE_NAMES[nameIdx]
    const location = FAKE_CITIES[cityIdx]

    owners.push({
      name,
      city: location.city,
      state: location.state,
      score,
      decimal,
      nra,
      label: scoreLabelFromName(name),
    })
  }

  return owners
}

export default function DemoPage() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const layersReady = useRef(false)
  const [selectedTract, setSelectedTract] = useState<SelectedTract | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (map.current || !mapContainer.current) return

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-97.45, 29.45],
      zoom: 10,
    })
    map.current = m

    const tryAddLayers = async () => {
      if (layersReady.current) return
      if (!m.isStyleLoaded()) {
        setTimeout(() => {
          void tryAddLayers()
        }, 200)
        return
      }

      try {
        const parcelsData = await fetch('/gonzales_parcels_enriched.geojson', {
          cache: 'no-store',
        }).then((res) => res.json())

        if (!map.current) return

        const scoreExpr = [
          'to-number',
          ['coalesce', ['get', 'max_propensity_score'], 0],
        ] as const

        if (map.current.getLayer('demo-outline')) map.current.removeLayer('demo-outline')
        if (map.current.getLayer('demo-fill')) map.current.removeLayer('demo-fill')
        if (map.current.getSource('demo-parcels')) map.current.removeSource('demo-parcels')

        map.current.addSource('demo-parcels', {
          type: 'geojson',
          data: parcelsData,
          generateId: true,
        })

        map.current.addLayer({
          id: 'demo-fill',
          type: 'fill',
          source: 'demo-parcels',
          paint: {
            'fill-color': [
              'step', scoreExpr,
              '#9CA3AF',
              2, '#FFC107',
              5, '#FF9800',
              8, '#F44336',
            ],
            'fill-opacity': [
              'step', scoreExpr,
              0.3,
              2, 0.5,
              5, 0.72,
              8, 0.9,
            ],
          },
        })

        map.current.addLayer({
          id: 'demo-outline',
          type: 'line',
          source: 'demo-parcels',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': ['step', scoreExpr, '#7C8594', 5, '#FFB74D', 8, '#F44336'],
            'line-width': ['step', scoreExpr, 0.8, 5, 1.4, 8, 2.0],
            'line-opacity': 0.88,
          },
        })

        map.current.on('click', 'demo-fill', (e) => {
          const props = (e.features?.[0]?.properties ?? {}) as Record<string, unknown>
          const abstractLabel = String(props.ABSTRACT_L ?? props.abstract_label ?? 'Unknown')
          const tractScore = Number(props.max_propensity_score ?? 0)
          const fakeAcreage = getAcreageFromProps(props)
          const seed = hashString(abstractLabel)
          const operator = FAKE_OPERATORS[seed % FAKE_OPERATORS.length]
          const owners = makeFakeOwners(abstractLabel, tractScore, fakeAcreage)

          setSelectedTract({
            abstractLabel,
            fakeAcreage,
            operator,
            score: tractScore,
            owners,
          })
        })

        map.current.on('mouseenter', 'demo-fill', () => {
          m.getCanvas().style.cursor = 'pointer'
        })
        map.current.on('mouseleave', 'demo-fill', () => {
          m.getCanvas().style.cursor = ''
        })

        layersReady.current = true
      } catch (error) {
        console.error('Demo map failed to load GeoJSON:', error)
      }
    }

    m.on('style.load', () => {
      void tryAddLayers()
    })
    void tryAddLayers()

    return () => {
      m.remove()
      map.current = null
      layersReady.current = false
    }
  }, [])

  const panelWidth = useMemo(() => (isMobile ? '100%' : 280), [isMobile])

  return (
    <div
      style={{
        background: '#0D1117',
        minHeight: '100vh',
        height: '100vh',
        color: '#fff',
        fontFamily: "'DM Sans', sans-serif",
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: 38,
          minHeight: 38,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          background: '#0D1117',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#EF9F27', display: 'inline-block' }} />
          <span style={{ fontSize: 11, letterSpacing: '0.09em', fontWeight: 700 }}>MINERAL MAP</span>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>·</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Gonzales County, TX</span>
        </div>
      </div>

      <div
        style={{
          height: 28,
          minHeight: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(239,159,39,0.12)',
          borderBottom: '1px solid rgba(239,159,39,0.28)',
          color: 'rgba(239,159,39,0.95)',
          fontSize: 11,
          padding: '0 10px',
          textAlign: 'center',
        }}
      >
        Interactive demo — owner names and data are anonymized. Sign up to access real data.
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

        <div
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            border: '1px solid rgba(239,159,39,0.4)',
            background: 'rgba(13,17,23,0.84)',
            color: '#EF9F27',
            borderRadius: 999,
            padding: '4px 10px',
            fontSize: 10,
            letterSpacing: '0.08em',
            fontWeight: 700,
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}
        >
          Demo — data anonymized
        </div>

        {selectedTract && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: panelWidth,
              maxWidth: '100%',
              background: '#0D1117',
              borderLeft: '1px solid rgba(255,255,255,0.1)',
              zIndex: 25,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-14px 0 28px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ padding: '12px 12px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.09em', color: 'rgba(239,159,39,0.75)', fontWeight: 700 }}>
                  SELECTED TRACT
                </div>
                <button
                  onClick={() => setSelectedTract(null)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.55)',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                  aria-label="Close panel"
                  type="button"
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: 18, fontFamily: "'DM Serif Display', serif", lineHeight: 1.1 }}>
                {selectedTract.abstractLabel}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.62)' }}>
                {selectedTract.fakeAcreage.toLocaleString()} ac · {selectedTract.operator}
              </div>
            </div>

            <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
              {selectedTract.owners.map((owner, index) => (
                <div
                  key={`${owner.name}-${index}`}
                  style={{
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: 8,
                    padding: '8px 9px',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>{owner.name}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>
                        {owner.city}, {owner.state}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: scoreColor(owner.score),
                        border: `1px solid ${scoreColor(owner.score)}66`,
                        borderRadius: 999,
                        padding: '2px 7px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {owner.score}/10
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: 7,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 10,
                    }}
                  >
                    <span style={{ color: '#EF9F27' }}>{owner.nra.toFixed(3)} NRA</span>
                    <span style={{ color: 'rgba(255,255,255,0.45)' }}>{owner.label}</span>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                borderTop: '1px solid rgba(255,255,255,0.08)',
                padding: 12,
                fontSize: 11,
              }}
            >
              <Link
                href="/pricing"
                style={{
                  color: '#EF9F27',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Sign up to see real owner data →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
