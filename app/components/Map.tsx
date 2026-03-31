'use client'
import { useCallback, useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { supabase } from '@/lib/supabase'

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
  showWells,
  onOwnerClick,
  focusedTract,
}: {
  showWells: boolean
  onOwnerClick: (owner: Record<string, unknown>) => void
  focusedTract?: { abstract_label: string } | null
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)

  const flyToSelectedTract = useCallback(() => {
    if (!map.current || !map.current.isStyleLoaded() || !focusedTract?.abstract_label) return
    const parcels = map.current.getSource('parcels') as mapboxgl.GeoJSONSource | undefined
    const rawData = (parcels as unknown as { _data?: GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJSON.GeoJsonProperties> })?._data
    if (!rawData?.features?.length) return

    const feature = rawData.features.find(
      (ft) => String(ft.properties?.ABSTRACT_L ?? '') === focusedTract.abstract_label
    )
    if (!feature || !feature.geometry) return

    const bbox = new mapboxgl.LngLatBounds()
    const pushCoords = (coords: unknown): void => {
      if (!Array.isArray(coords)) return
      if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        bbox.extend([coords[0], coords[1]])
        return
      }
      for (const c of coords) pushCoords(c)
    }
    const geometry = feature.geometry as GeoJSON.Geometry
    if ('coordinates' in geometry) {
      pushCoords(geometry.coordinates as unknown)
    } else if ('geometries' in geometry) {
      for (const g of geometry.geometries) {
        if ('coordinates' in g) {
          pushCoords(g.coordinates as unknown)
        }
      }
    }
    if (!bbox.isEmpty()) {
      map.current.fitBounds(bbox, { padding: 50, duration: 700 })
    }
  }, [focusedTract?.abstract_label])

  useEffect(() => {
    if (map.current || !mapContainer.current) return
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-97.45, 29.45],
      zoom: 10
    })

    const handleParcelClick = (e: mapboxgl.MapLayerMouseEvent) => {
      console.log('Parcel clicked:', e.features?.[0]?.properties)
      const props = e.features?.[0]?.properties
      if (props && onOwnerClick) {
        onOwnerClick(props as unknown as Record<string, unknown>)
      }
    }
    const handleParcelEnter = () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer'
    }
    const handleParcelLeave = () => {
      if (map.current) map.current.getCanvas().style.cursor = ''
    }
    const handleWellsClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const props = e.features?.[0]?.properties as Record<string, unknown> | undefined
      if (!props || !map.current) return
      new mapboxgl.Popup({ closeButton: false, offset: 10 })
        .setLngLat((e.features?.[0]?.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(`
          <div style="font-family:Inter,sans-serif;font-size:12px;padding:4px">
            <div style="font-weight:600;margin-bottom:2px">${String(props.lease ?? 'Well')}</div>
            <div style="color:#6b7280">${String(props.operator ?? '')}</div>
            <div style="margin-top:4px;font-size:11px;color:${props.status === 'PRODUCING' ? '#16a34a' : '#dc2626'}">
              ● ${String(props.status ?? 'Unknown')}
            </div>
          </div>
        `)
        .addTo(map.current)
    }
    const handleWellsEnter = () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer'
    }
    const handleWellsLeave = () => {
      if (map.current) map.current.getCanvas().style.cursor = ''
    }

    const addLayers = () => {
      if (!map.current) return
      const m = map.current

      // Remove existing style-bound layers/sources so re-adding is deterministic.
      if (m.getLayer('parcels-fill')) m.removeLayer('parcels-fill')
      if (m.getLayer('parcels-outline')) m.removeLayer('parcels-outline')
      if (m.getLayer('wells-layer')) m.removeLayer('wells-layer')
      if (m.getSource('parcels')) m.removeSource('parcels')
      if (m.getSource('wells')) m.removeSource('wells')

      fetch('/gonzales_parcels_enriched.geojson')
        .then((r) => r.json())
        .then((data) => {
          if (!map.current) return
          const mm = map.current

          if (mm.getSource('parcels')) {
            ;(mm.getSource('parcels') as mapboxgl.GeoJSONSource).setData(data)
          } else {
            mm.addSource('parcels', { type: 'geojson', data })
          }

          if (!mm.getLayer('parcels-fill')) {
            mm.addLayer({
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

          if (!mm.getLayer('parcels-outline')) {
            mm.addLayer({
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

          mm.off('click', 'parcels-fill', handleParcelClick)
          mm.off('mouseenter', 'parcels-fill', handleParcelEnter)
          mm.off('mouseleave', 'parcels-fill', handleParcelLeave)
          mm.on('click', 'parcels-fill', handleParcelClick)
          mm.on('mouseenter', 'parcels-fill', handleParcelEnter)
          mm.on('mouseleave', 'parcels-fill', handleParcelLeave)

          // Add wells layer from Supabase
          supabase
            .from('gonzales_wells')
            .select('latitude, longitude, well_status, operator_name, lease_name')
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
            .then(({ data: wellsRows }) => {
              if (!wellsRows || !map.current) return
              const wellsGeoJSON: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: wellsRows
                  .map((w) => ({
                    type: 'Feature' as const,
                    geometry: {
                      type: 'Point' as const,
                      coordinates: [Number(w.longitude), Number(w.latitude)],
                    },
                    properties: {
                      status: w.well_status,
                      operator: w.operator_name,
                      lease: w.lease_name,
                    },
                  }))
                  .filter(
                    (f) =>
                      Number.isFinite((f.geometry as GeoJSON.Point).coordinates[0]) &&
                      Number.isFinite((f.geometry as GeoJSON.Point).coordinates[1])
                  ),
              }

              if (map.current.getSource('wells')) {
                ;(map.current.getSource('wells') as mapboxgl.GeoJSONSource).setData(wellsGeoJSON)
              } else {
                map.current.addSource('wells', { type: 'geojson', data: wellsGeoJSON })
                map.current.addLayer({
                  id: 'wells-layer',
                  type: 'circle',
                  source: 'wells',
                  paint: {
                    'circle-radius': 4,
                    'circle-color': [
                      'case',
                      ['==', ['get', 'status'], 'PRODUCING'], '#16a34a',
                      ['==', ['get', 'status'], 'SHUT IN'], '#dc2626',
                      '#9ca3af',
                    ],
                    'circle-opacity': 0.85,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-opacity': 0.6,
                  },
                })

                map.current.off('click', 'wells-layer', handleWellsClick)
                map.current.off('mouseenter', 'wells-layer', handleWellsEnter)
                map.current.off('mouseleave', 'wells-layer', handleWellsLeave)
                map.current.on('click', 'wells-layer', handleWellsClick)
                map.current.on('mouseenter', 'wells-layer', handleWellsEnter)
                map.current.on('mouseleave', 'wells-layer', handleWellsLeave)
              }

              if (map.current.getLayer('wells-layer')) {
                map.current.setLayoutProperty('wells-layer', 'visibility', showWells ? 'visible' : 'none')
              }
            })
        })
        .catch((err) => {
          console.error('Failed to load parcels GeoJSON:', err)
        })
      flyToSelectedTract()
    }

    map.current.on('style.load', addLayers)
    if (map.current.isStyleLoaded()) addLayers()

    return () => {
      if (!map.current) return
      map.current.off('style.load', addLayers)
    }
  }, [onOwnerClick, flyToSelectedTract, showWells])

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return
    if (map.current.getLayer('wells-layer')) {
      map.current.setLayoutProperty('wells-layer', 'visibility', showWells ? 'visible' : 'none')
    }
    flyToSelectedTract()
  }, [showWells, flyToSelectedTract])

  return <div ref={mapContainer} style={{ width: '100%', height: '100%', background: '#F8F8F8' }} />
}
