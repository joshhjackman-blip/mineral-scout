'use client'
import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { supabase } from '@/lib/supabase'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

export type OwnerRecord = {
  id?: number
  owner_name: string
  mailing_city?: string
  mailing_state?: string
  operator_name?: string
  propensity_score?: number
  motivated?: boolean
  out_of_state?: boolean
  acreage?: number | null
  prod_cumulative_sum_oil?: number | null
  rrc_lease_id?: string | null
  latitude?: number | null
  longitude?: number | null
  well_status?: string
  [key: string]: unknown
}

export default function Map({
  showWells,
  showPermits,
  onOwnerClick,
}: {
  showWells: boolean
  showPermits: boolean
  onOwnerClick: (owner: Record<string, unknown>) => void
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const onOwnerClickRef = useRef(onOwnerClick)
  const layersReady = useRef(false)

  useEffect(() => {
    onOwnerClickRef.current = onOwnerClick
  }, [onOwnerClick])

  useEffect(() => {
    if (map.current || !mapContainer.current) return

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-97.45, 29.45],
      zoom: 10
    })
    map.current = m

    const tryAddLayers = () => {
      if (layersReady.current) return
      if (!m.isStyleLoaded()) {
        setTimeout(tryAddLayers, 200)
        return
      }

      console.log('Style ready, fetching GeoJSON...')

      fetch('/api/parcels')
        .then(r => r.json())
        .then(data => {
          console.log('GeoJSON received, features:', data.features?.length)
          if (!map.current) return

          const scoreExpr = [
            'to-number',
            ['coalesce', ['get', 'max_propensity_score'], 0],
          ] as const

          if (map.current.getLayer('parcels-outline')) map.current.removeLayer('parcels-outline')
          if (map.current.getLayer('parcels-outline-casing')) map.current.removeLayer('parcels-outline-casing')
          if (map.current.getLayer('parcels-fill')) map.current.removeLayer('parcels-fill')
          if (map.current.getSource('parcels')) map.current.removeSource('parcels')

          map.current.addSource('parcels', { type: 'geojson', data, generateId: true })
          map.current.addLayer({
            id: 'parcels-fill',
            type: 'fill',
            source: 'parcels',
            paint: {
              'fill-color': [
                'step', scoreExpr,
                '#1a3a1a', 3, '#2d6a2d', 4, '#4CAF50',
                5, '#8BC34A', 6, '#FFC107', 7, '#FF9800',
                8, '#F44336', 9, '#B71C1C', 10, '#FF0000'
              ],
              'fill-opacity': [
                'step', scoreExpr,
                0.22, 3, 0.3, 4, 0.45, 5, 0.58,
                6, 0.65, 7, 0.75, 8, 0.85, 9, 0.9, 10, 1.0
              ]
            }
          })
          map.current.addLayer({
            id: 'parcels-outline-casing',
            type: 'line',
            source: 'parcels',
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              // Dark casing improves separation between adjacent, similarly colored tracts.
              'line-color': '#0f172a',
              'line-width': ['step', scoreExpr,
                1.4, 6, 2.0, 8, 2.8],
              'line-opacity': 0.45
            }
          })
          map.current.addLayer({
            id: 'parcels-outline',
            type: 'line',
            source: 'parcels',
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': ['step', scoreExpr,
                '#2d6a2d', 5, '#FFC107', 8, '#F44336'],
              'line-width': ['step', scoreExpr,
                0.8, 6, 1.2, 8, 1.9],
              'line-opacity': 0.95
            }
          })

          map.current.on('click', 'parcels-fill', (e) => {
            const props = e.features?.[0]?.properties
            if (props) onOwnerClickRef.current(props as Record<string, unknown>)
          })
          map.current.on('mouseenter', 'parcels-fill', () => {
            m.getCanvas().style.cursor = 'pointer'
          })
          map.current.on('mouseleave', 'parcels-fill', () => {
            m.getCanvas().style.cursor = ''
          })

          layersReady.current = true
          console.log('Parcel layers added successfully')
        })
        .catch(err => {
          console.error('GeoJSON fetch failed:', err)
          setTimeout(tryAddLayers, 1000)
        })

      // Add wells
      supabase
        .from('gonzales_wells')
        .select('latitude, longitude, well_status, operator_name, lease_name')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .then(({ data: wells }) => {
          if (!wells || !map.current) return
          const geojson: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: wells
              .filter(w => Number.isFinite(Number(w.longitude)) && Number.isFinite(Number(w.latitude)))
              .map(w => ({
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: [Number(w.longitude), Number(w.latitude)] },
                properties: { status: w.well_status, operator: w.operator_name, lease: w.lease_name }
              }))
          }
          map.current.addSource('wells', { type: 'geojson', data: geojson })
          map.current.addLayer({
            id: 'wells-layer',
            type: 'circle',
            source: 'wells',
            layout: { visibility: showWells ? 'visible' : 'none' },
            paint: {
              'circle-radius': 4,
              'circle-color': ['case',
                ['==', ['get', 'status'], 'PRODUCING'], '#16a34a',
                ['==', ['get', 'status'], 'SHUT IN'], '#dc2626',
                '#9ca3af'
              ],
              'circle-opacity': 0.9,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
            }
          })
          map.current.on('click', 'wells-layer', (e) => {
            const props = e.features?.[0]?.properties
            if (!props || !map.current) return
            new mapboxgl.Popup({ closeButton: false, offset: 10 })
              .setLngLat((e.features![0].geometry as GeoJSON.Point).coordinates as [number, number])
              .setHTML(`<div style="font-family:Inter,sans-serif;font-size:12px;padding:6px">
                <div style="font-weight:600">${props.lease ?? 'Well'}</div>
                <div style="color:#6b7280">${props.operator ?? ''}</div>
                <div style="color:${props.status === 'PRODUCING' ? '#16a34a' : '#dc2626'}">● ${props.status}</div>
              </div>`)
              .addTo(map.current)
          })
          map.current.on('mouseenter', 'wells-layer', () => { m.getCanvas().style.cursor = 'pointer' })
          map.current.on('mouseleave', 'wells-layer', () => { m.getCanvas().style.cursor = '' })
        })

      // Add permits layer
      supabase
        .from('gonzales_permits')
        .select('latitude, longitude, operator_name, lease_name, filed_date, permit_type')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .then(({ data: permits }) => {
          if (!permits || !map.current) return
          const permitsGeoJSON: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: permits
              .filter(
                (p) =>
                  Number.isFinite(Number(p.longitude)) && Number.isFinite(Number(p.latitude))
              )
              .map((p) => ({
                type: 'Feature' as const,
                geometry: {
                  type: 'Point' as const,
                  coordinates: [Number(p.longitude), Number(p.latitude)],
                },
                properties: {
                  operator: p.operator_name,
                  lease: p.lease_name,
                  date: p.filed_date,
                  type: p.permit_type,
                },
              })),
          }
          if (!map.current.getSource('permits')) {
            map.current.addSource('permits', { type: 'geojson', data: permitsGeoJSON })
            map.current.addLayer({
              id: 'permits-layer',
              type: 'circle',
              source: 'permits',
              layout: { visibility: showPermits ? 'visible' : 'none' },
              paint: {
                'circle-radius': 7,
                'circle-color': '#2563eb',
                'circle-opacity': 0.8,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-opacity': 0.9,
              },
            })
            map.current.on('click', 'permits-layer', (e) => {
              const props = e.features?.[0]?.properties
              if (!props || !map.current) return
              new mapboxgl.Popup({ closeButton: false, offset: 10 })
                .setLngLat((e.features![0].geometry as GeoJSON.Point).coordinates as [number, number])
                .setHTML(`<div style="font-family:Inter,sans-serif;font-size:12px;padding:6px">
                  <div style="font-weight:600;color:#1d4ed8">New Permit Filed</div>
                  <div style="font-weight:500;margin-top:2px">${props.lease ?? ''}</div>
                  <div style="color:#6b7280">${props.operator ?? ''}</div>
                  <div style="color:#6b7280;font-size:11px">Filed: ${props.date ?? ''}</div>
                </div>`)
                .addTo(map.current)
            })
            map.current.on('mouseenter', 'permits-layer', () => {
              m.getCanvas().style.cursor = 'pointer'
            })
            map.current.on('mouseleave', 'permits-layer', () => {
              m.getCanvas().style.cursor = ''
            })
          }
        })
    }

    m.on('load', tryAddLayers)

    return () => { map.current?.remove(); map.current = null; layersReady.current = false }
  }, [])

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return
    if (map.current.getLayer('wells-layer')) {
      map.current.setLayoutProperty('wells-layer', 'visibility', showWells ? 'visible' : 'none')
    }
    if (map.current.getLayer('permits-layer')) {
      map.current.setLayoutProperty('permits-layer', 'visibility', showPermits ? 'visible' : 'none')
    }
  }, [showWells, showPermits])

  return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
}
