'use client'
import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

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
  onOwnerClick,
  focusTarget,
}: {
  onOwnerClick: (owner: Record<string, unknown>) => void
  focusTarget?: Record<string, unknown> | null
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

      console.log('Style ready, fetching parcels...')

      try {
        const parcelsResponse = await fetch('/api/parcels')

        if (!parcelsResponse.ok) {
          throw new Error(`Parcels API failed (${parcelsResponse.status})`)
        }

        const parcelsData = await parcelsResponse.json()

        if (!map.current) return
        console.log('GeoJSON received, features:', parcelsData.features?.length)

        const scoreExpr = [
          'to-number',
          ['coalesce', ['get', 'max_propensity_score'], 0],
        ] as const

        if (map.current.getLayer('parcels-outline')) map.current.removeLayer('parcels-outline')
        if (map.current.getLayer('parcels-fill')) map.current.removeLayer('parcels-fill')
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

        layersReady.current = true
        console.log('Parcel layers added successfully')
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
    if (!focusTarget || !map.current?.isStyleLoaded()) return

    const source = map.current.getSource('parcels') as mapboxgl.GeoJSONSource | undefined
    const sourceData = (source?._data as GeoJSON.FeatureCollection | undefined) ?? undefined
    const features = sourceData?.features ?? []

    const selectedAbstract = String(
      focusTarget.abstract_label ?? focusTarget.ABSTRACT_L ?? ''
    ).trim()
    const selectedSurvey = String(
      focusTarget.level1_sur ?? focusTarget.LEVEL1_SUR ?? ''
    ).trim()

    if (!selectedAbstract || !selectedSurvey) return

    const matched = features.find((feature) => {
      const props = (feature.properties ?? {}) as Record<string, unknown>
      const featureAbstract = String(props.abstract_label ?? props.ABSTRACT_L ?? '').trim()
      const featureSurvey = String(props.level1_sur ?? props.LEVEL1_SUR ?? '').trim()
      return featureAbstract === selectedAbstract && featureSurvey === selectedSurvey
    })

    if (!matched?.geometry) return

    const bounds = new mapboxgl.LngLatBounds()
    const addCoords = (coords: number[][]) => {
      coords.forEach((c) => bounds.extend([c[0], c[1]] as [number, number]))
    }

    if (matched.geometry.type === 'Polygon') {
      addCoords((matched.geometry.coordinates[0] as number[][]) ?? [])
    } else if (matched.geometry.type === 'MultiPolygon') {
      matched.geometry.coordinates.forEach((poly) => addCoords((poly[0] as number[][]) ?? []))
    }

    if (!bounds.isEmpty()) {
      map.current.fitBounds(bounds, { padding: 120, duration: 800, maxZoom: 14 })
    }
  }, [focusTarget])

  return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
}
