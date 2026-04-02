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

const toWellType = (value: unknown): 'HORIZONTAL' | 'DIRECTIONAL' | 'VERTICAL' | 'UNKNOWN' => {
  const s = String(value ?? '').toUpperCase().trim()
  if (s.startsWith('H')) return 'HORIZONTAL'
  if (s.startsWith('D')) return 'DIRECTIONAL'
  if (s.startsWith('V')) return 'VERTICAL'
  if (!s) return 'UNKNOWN'
  return 'VERTICAL'
}

export default function Map({
  showActiveWells,
  showShutInWells,
  showUnknownWells,
  showPermits,
  onOwnerClick,
}: {
  showActiveWells: boolean
  showShutInWells: boolean
  showUnknownWells: boolean
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (map.current || !mapContainer.current) return

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-97.45, 29.45],
      zoom: 10
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

      console.log('Style ready, fetching parcels/wells/permits...')

      try {
        const [parcelsResponse, wellsResult, permitsResult] = await Promise.all([
          fetch('/api/parcels'),
          supabase
            .from('gonzales_wells')
            .select('latitude, longitude, well_status, operator_name, lease_name, well_type')
            .not('latitude', 'is', null)
            .not('longitude', 'is', null),
          supabase
            .from('gonzales_permits')
            .select('latitude, longitude, operator_name, lease_name, filed_date, permit_type')
            .not('latitude', 'is', null)
            .not('longitude', 'is', null),
        ])

        if (!parcelsResponse.ok) {
          throw new Error(`Parcels API failed (${parcelsResponse.status})`)
        }

        const parcelsData = await parcelsResponse.json()
        const wells = wellsResult.data ?? []
        const permits = permitsResult.data ?? []

        if (!map.current) return
        console.log('GeoJSON received, features:', parcelsData.features?.length)

        const scoreExpr = [
          'to-number',
          ['coalesce', ['get', 'max_propensity_score'], 0],
        ] as const

        if (map.current.getLayer('permits-layer')) map.current.removeLayer('permits-layer')
        if (map.current.getLayer('wells-unknown-layer')) map.current.removeLayer('wells-unknown-layer')
        if (map.current.getLayer('wells-shut-in-layer')) map.current.removeLayer('wells-shut-in-layer')
        if (map.current.getLayer('wells-active-layer')) map.current.removeLayer('wells-active-layer')
        if (map.current.getLayer('parcels-outline')) map.current.removeLayer('parcels-outline')
        if (map.current.getLayer('parcels-fill')) map.current.removeLayer('parcels-fill')
        if (map.current.getSource('permits')) map.current.removeSource('permits')
        if (map.current.getSource('wells')) map.current.removeSource('wells')
        if (map.current.getSource('parcels')) map.current.removeSource('parcels')

        // 1) Parcel fill (bottom)
        map.current.addSource('parcels', { type: 'geojson', data: parcelsData, generateId: true })
        map.current.addLayer({
          id: 'parcels-fill',
          type: 'fill',
          source: 'parcels',
          paint: {
            'fill-color': [
              'step', scoreExpr,
              '#9E9E9E',
              2, '#81C784',
              5, '#FF9800',
              8, '#F44336',
              10, '#B71C1C'
            ],
            'fill-opacity': [
              'step', scoreExpr,
              0.3,
              2, 0.45,
              5, 0.7,
              8, 0.88,
              10, 1.0
            ]
          }
        })

        // 2) Parcel outline (above fill)
        map.current.addLayer({
          id: 'parcels-outline',
          type: 'line',
          source: 'parcels',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': ['step', scoreExpr, '#2d6a2d', 5, '#FFC107', 8, '#F44336'],
            'line-width': ['step', scoreExpr, 1.1, 6, 1.6, 8, 2.2],
            'line-opacity': 0.92
          }
        })

        map.current.on('click', 'parcels-fill', (e) => {
          const props = e.features?.[0]?.properties
          if (props) {
            onOwnerClickRef.current(props as Record<string, unknown>)

            // Fly to clicked parcel
            if (e.features?.[0]?.geometry) {
              const geometry = e.features[0].geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
              const bounds = new mapboxgl.LngLatBounds()

              const addCoords = (coords: number[][]) => {
                coords.forEach((c) => bounds.extend([c[0], c[1]] as [number, number]))
              }

              if (geometry.type === 'Polygon') {
                addCoords(geometry.coordinates[0] as number[][])
              } else if (geometry.type === 'MultiPolygon') {
                geometry.coordinates.forEach((poly) => addCoords(poly[0] as number[][]))
              }

              if (!bounds.isEmpty()) {
                map.current?.fitBounds(bounds, {
                  padding: 120,
                  duration: 800,
                  maxZoom: 14
                })
              }
            }
          }
        })
        map.current.on('mouseenter', 'parcels-fill', () => {
          m.getCanvas().style.cursor = 'pointer'
        })
        map.current.on('mouseleave', 'parcels-fill', () => {
          m.getCanvas().style.cursor = ''
        })

        const toWellStatusGroup = (status: unknown): 'ACTIVE' | 'SHUT_IN' | 'UNKNOWN' => {
          const value = String(status ?? '').toUpperCase().trim()
          if (value.includes('PRODUCING') || value.includes('ACTIVE')) return 'ACTIVE'
          if (value.includes('SHUT')) return 'SHUT_IN'
          return 'UNKNOWN'
        }

        const wellsGeoJSON: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: wells
            .filter((w) => Number.isFinite(Number(w.longitude)) && Number.isFinite(Number(w.latitude)))
            .map((w) => ({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [Number(w.longitude), Number(w.latitude)] },
              properties: {
                status: w.well_status,
                status_group: toWellStatusGroup(w.well_status),
                operator: w.operator_name,
                lease: w.lease_name,
                well_type: toWellType(w.well_type),
              }
            }))
        }

        // 3) Wells dots split by status (above polygons)
        map.current.addSource('wells', { type: 'geojson', data: wellsGeoJSON })
        map.current.addLayer({
          id: 'wells-active-layer',
          type: 'circle',
          source: 'wells',
          filter: ['==', ['get', 'status_group'], 'ACTIVE'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 6,
            'circle-color': '#16a34a',
            'circle-opacity': 0.95,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': 1,
          }
        })
        map.current.addLayer({
          id: 'horizontal-wells-layer',
          type: 'circle',
          source: 'wells',
          filter: ['==', ['get', 'well_type'], 'HORIZONTAL'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 6.8,
            'circle-color': '#16a34a',
            'circle-opacity': 0.95,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': 1,
          }
        })
        map.current.addLayer({
          id: 'vertical-wells-layer',
          type: 'circle',
          source: 'wells',
          filter: ['!=', ['get', 'well_type'], 'HORIZONTAL'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 4.2,
            'circle-color': '#16a34a',
            'circle-opacity': 0.78,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': 1,
          }
        })
        map.current.addLayer({
          id: 'wells-shut-in-layer',
          type: 'circle',
          source: 'wells',
          filter: ['==', ['get', 'status_group'], 'SHUT_IN'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 5,
            'circle-color': '#dc2626',
            'circle-opacity': 0.95,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': 1,
          }
        })
        map.current.addLayer({
          id: 'wells-unknown-layer',
          type: 'circle',
          source: 'wells',
          filter: ['==', ['get', 'status_group'], 'UNKNOWN'],
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 4,
            'circle-color': '#9ca3af',
            'circle-opacity': 0.95,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': 1,
          }
        })

        const wellLayerIds = [
          'wells-active-layer',
          'horizontal-wells-layer',
          'vertical-wells-layer',
          'wells-shut-in-layer',
          'wells-unknown-layer',
        ] as const
        wellLayerIds.forEach((layerId) => {
          map.current?.on('click', layerId, (e) => {
            const props = e.features?.[0]?.properties
            if (!props || !map.current) return
            const statusGroup = String(props.status_group ?? 'UNKNOWN')
            const statusColor = statusGroup === 'ACTIVE' ? '#16a34a' : statusGroup === 'SHUT_IN' ? '#dc2626' : '#6b7280'
            new mapboxgl.Popup({ closeButton: false, offset: 10 })
              .setLngLat((e.features![0].geometry as GeoJSON.Point).coordinates as [number, number])
              .setHTML(`<div style="font-family:Inter,sans-serif;font-size:12px;padding:6px 8px">
                <div style="font-weight:600;color:#111827">${props.lease ?? 'Well'}</div>
                <div style="color:#6b7280">${props.operator ?? ''}</div>
                <div style="margin-top:4px;display:flex;gap:8px;align-items:center">
                  <span style="color:${statusColor}">● ${props.status ?? 'Unknown'}</span>
                  <span style="color:#6b7280;font-size:11px">${props.well_type ?? ''}</span>
                </div>
              </div>`)
              .addTo(map.current)
          })
          map.current?.on('mouseenter', layerId, () => {
            m.getCanvas().style.cursor = 'pointer'
          })
          map.current?.on('mouseleave', layerId, () => {
            m.getCanvas().style.cursor = ''
          })
        })

        const permitsGeoJSON: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: permits
            .filter((p) => Number.isFinite(Number(p.longitude)) && Number.isFinite(Number(p.latitude)))
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

        // 4) Permits dots (top-most)
        map.current.addSource('permits', { type: 'geojson', data: permitsGeoJSON })
        map.current.addLayer({
          id: 'permits-layer',
          type: 'circle',
          source: 'permits',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 7,
            'circle-color': '#2563eb',
            'circle-opacity': 0.85,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': 1,
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

        layersReady.current = true
        console.log('Parcel, wells, and permits layers added successfully')
      } catch (err) {
        console.error('Layer setup failed:', err)
        setTimeout(() => {
          void tryAddLayers()
        }, 1000)
      }
    }

    m.on('load', tryAddLayers)

    return () => { map.current?.remove(); map.current = null; layersReady.current = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return
    if (map.current.getLayer('wells-active-layer')) {
      map.current.setLayoutProperty('wells-active-layer', 'visibility', showActiveWells ? 'visible' : 'none')
    }
    if (map.current.getLayer('horizontal-wells-layer')) {
      map.current.setLayoutProperty('horizontal-wells-layer', 'visibility', showActiveWells ? 'visible' : 'none')
    }
    if (map.current.getLayer('vertical-wells-layer')) {
      map.current.setLayoutProperty('vertical-wells-layer', 'visibility', showActiveWells ? 'visible' : 'none')
    }
    if (map.current.getLayer('wells-shut-in-layer')) {
      map.current.setLayoutProperty('wells-shut-in-layer', 'visibility', showShutInWells ? 'visible' : 'none')
    }
    if (map.current.getLayer('wells-unknown-layer')) {
      map.current.setLayoutProperty('wells-unknown-layer', 'visibility', showUnknownWells ? 'visible' : 'none')
    }
    if (map.current.getLayer('permits-layer')) {
      map.current.setLayoutProperty('permits-layer', 'visibility', showPermits ? 'visible' : 'none')
    }
  }, [showActiveWells, showShutInWells, showUnknownWells, showPermits])

  return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
}
