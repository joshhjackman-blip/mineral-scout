'use client'
import { useCallback, useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

export type OwnerRecord = {
  id: number
  owner_name: string
  mailing_city: string
  mailing_state: string
  operator_name: string
  propensity_score: number
  motivated: boolean
  out_of_state: boolean
  acreage: number | null
  prod_cumulative_sum_oil: number | null
  rrc_lease_id: string | null
  latitude: number | null
  longitude: number | null
  well_status: string
  top_owner?: string
  owner_count?: number
  top_owner_state?: string
  max_propensity_score?: number
  owners_json?: string
  top_operator?: string
  abstract_label?: string
  level1_sur?: string
}

export type WellRecord = {
  id: string
  lat: number
  lng: number
  well_status: string
  operator_name: string
  rrc_lease_id: string | null
}

export default function Map({
  motivatedOnly,
  outOfStateOnly,
  minScore,
  showWells,
  showMotivated,
  owners,
  wells,
  onOwnerClick,
}: {
  motivatedOnly: boolean
  outOfStateOnly: boolean
  minScore: number
  showWells: boolean
  showMotivated: boolean
  owners: OwnerRecord[]
  wells: WellRecord[]
  onOwnerClick: (owner: OwnerRecord) => void
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)

  const updateOwners = useCallback(() => {
    if (!map.current || !map.current.isStyleLoaded()) return

    console.log('Map received owners:', owners?.length, 'first owner:', owners?.[0])

    const filtered = owners.filter((o) => {
      if (motivatedOnly && !o.motivated) return false
      if (outOfStateOnly && !o.out_of_state) return false
      if (!showMotivated && o.motivated) return false
      if (o.propensity_score < minScore) return false
      return true
    })

    const source = map.current.getSource('owners') as mapboxgl.GeoJSONSource | undefined
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: filtered
          .map((o) => ({
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [o.longitude, o.latitude],
            },
            properties: { ...o, raw: JSON.stringify(o) },
          }))
          .filter(
            (f) =>
              Number.isFinite(f.geometry.coordinates[0]) &&
              Number.isFinite(f.geometry.coordinates[1])
          ),
      })
    }
  }, [owners, motivatedOnly, outOfStateOnly, showMotivated, minScore])

  const updateWells = useCallback(() => {
    if (!map.current || !map.current.isStyleLoaded()) return

    const wellsSource = map.current.getSource('wells') as mapboxgl.GeoJSONSource | undefined
    if (!wellsSource) return

    if (showWells) {
      wellsSource.setData({
        type: 'FeatureCollection',
        features: wells.map((w) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
          properties: { ...w, status: w.well_status },
        })),
      })
    } else {
      wellsSource.setData({ type: 'FeatureCollection', features: [] })
    }
  }, [wells, showWells])

  useEffect(() => {
    if (map.current || !mapContainer.current) return
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-97.45, 29.45],
      zoom: 10
    })

    map.current.on('load', () => {
      const m = map.current!

      // Owner layer
      m.addSource('owners', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      })
      m.addLayer({
        id: 'owners-layer',
        type: 'circle',
        source: 'owners',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 0, 5, 10, 12],
          'circle-color': ['case',
            ['>=', ['get', 'score'], 8], '#EF9F27',
            ['>=', ['get', 'score'], 5], '#BA7517',
            '#4A4F5E'
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.3
        }
      })

      // Wells layer
      m.addSource('wells', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      })
      m.addLayer({
        id: 'wells-layer',
        type: 'circle',
        source: 'wells',
        paint: {
          'circle-radius': 5,
          'circle-color': ['case',
            ['==', ['get', 'status'], 'PRODUCING'], '#7AB835',
            '#D85A30'
          ],
          'circle-opacity': 0.9,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.4
        }
      })

      // Enriched parcels polygon layer
      fetch('/gonzales_parcels_enriched.geojson')
        .then((r) => r.json())
        .then((data) => {
          if (!m.getSource('parcels')) {
            m.addSource('parcels', { type: 'geojson', data })
          }

          if (!m.getLayer('parcels-fill')) {
            m.addLayer({
              id: 'parcels-fill',
              type: 'fill',
              source: 'parcels',
              paint: {
                'fill-color': [
                  'step',
                  ['get', 'max_propensity_score'],
                  '#1a3a1a',
                  3,
                  '#2d6a2d',
                  4,
                  '#4CAF50',
                  5,
                  '#8BC34A',
                  6,
                  '#FFC107',
                  7,
                  '#FF9800',
                  8,
                  '#F44336',
                  9,
                  '#B71C1C',
                  10,
                  '#FF0000',
                ],
                'fill-opacity': [
                  'step',
                  ['get', 'max_propensity_score'],
                  0.15,
                  3,
                  0.25,
                  4,
                  0.4,
                  5,
                  0.55,
                  6,
                  0.65,
                  7,
                  0.75,
                  8,
                  0.85,
                  9,
                  0.9,
                  10,
                  1.0,
                ],
              },
            })
          }

          if (!m.getLayer('parcels-outline')) {
            m.addLayer({
              id: 'parcels-outline',
              type: 'line',
              source: 'parcels',
              paint: {
                'line-color': [
                  'step',
                  ['get', 'max_propensity_score'],
                  '#2d6a2d',
                  5,
                  '#FFC107',
                  8,
                  '#F44336',
                ],
                'line-width': [
                  'step',
                  ['get', 'max_propensity_score'],
                  0.3,
                  6,
                  0.5,
                  8,
                  1.0,
                ],
                'line-opacity': 0.6,
              },
            })
          }

          m.on('click', 'parcels-fill', (e) => {
            const props = e.features?.[0]?.properties
            if (props && onOwnerClick) {
              const maxScore = Number(
                props.max_propensity_score ?? props.propensity_score ?? 0
              )
              const ownerCount = Number(props.owner_count ?? 0)
              onOwnerClick({
                id: 0,
                owner_name: String(
                  props.top_owner ?? props.owner_name ?? 'Unknown Owner'
                ),
                mailing_city: '',
                mailing_state: String(props.top_owner_state ?? ''),
                operator_name: String(props.top_operator ?? props.operator_name ?? ''),
                propensity_score: maxScore,
                motivated: ownerCount > 0,
                out_of_state: false,
                acreage: null,
                prod_cumulative_sum_oil: null,
                rrc_lease_id: null,
                latitude: null,
                longitude: null,
                well_status: String(props.well_status ?? 'UNKNOWN'),
                top_owner: String(props.top_owner ?? ''),
                owner_count: ownerCount,
                top_owner_state: String(props.top_owner_state ?? ''),
                max_propensity_score: maxScore,
                owners_json:
                  typeof props.owners_json === 'string'
                    ? props.owners_json
                    : JSON.stringify(props.owners_json ?? []),
                top_operator: String(props.top_operator ?? ''),
                abstract_label: String(props.ABSTRACT_L ?? ''),
                level1_sur: String(props.LEVEL1_SUR ?? ''),
              })
            }
          })

          m.on('mouseenter', 'parcels-fill', () => {
            m.getCanvas().style.cursor = 'pointer'
          })
          m.on('mouseleave', 'parcels-fill', () => {
            m.getCanvas().style.cursor = ''
          })
        })
        .catch((err) => {
          console.error('Failed to load parcels GeoJSON:', err)
        })

      m.on('click', 'owners-layer', (e) => {
        const props = e.features?.[0]?.properties
        if (props?.raw) {
          onOwnerClick(JSON.parse(props.raw as string))
        }
      })
      m.on('mouseenter', 'owners-layer', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'owners-layer', () => { m.getCanvas().style.cursor = '' })

      updateOwners()
      updateWells()
    })
  }, [onOwnerClick, updateOwners, updateWells])

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return
    updateOwners()
    updateWells()
  }, [owners, wells, motivatedOnly, outOfStateOnly, minScore, showWells, showMotivated, updateOwners, updateWells])

  return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
}
