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
  showPermits,
  onOwnerClick,
  focusTarget,
  selectedCounty,
}: {
  showPermits: boolean
  onOwnerClick: (owner: Record<string, unknown>) => void
  focusTarget?: Record<string, unknown> | null
  selectedCounty: 'gonzales' | 'howard'
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const onOwnerClickRef = useRef(onOwnerClick)
  const layersReady = useRef(false)

  type WellLayerRecord = {
    latitude: number | string | null
    longitude: number | string | null
    operator_name?: string | null
    lease_name?: string | null
    completion_date?: string | null
    well_type?: string | null
  }

  useEffect(() => {
    onOwnerClickRef.current = onOwnerClick
  }, [onOwnerClick])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (map.current || !mapContainer.current) return

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: selectedCounty === 'howard' ? [-101.45, 32.3] : [-97.45, 29.45],
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

      console.log('Style ready, fetching parcels/wells...')

      try {
        const wellsPromise =
          selectedCounty === 'howard'
            ? supabase
              .from('howard_wells')
              .select('api_number,latitude,longitude,well_type,oil_gas_code,well_status')
              .not('latitude', 'is', null)
              .not('longitude', 'is', null)
            : supabase
              .from('gonzales_wells')
              .select('api_number,latitude,longitude,operator_name,well_status,lease_name,rrc_lease_id,completion_date,well_type')
              .not('latitude', 'is', null)
              .not('longitude', 'is', null)

        const [parcelsResponse, wellsResult] = await Promise.all([
          fetch(
            selectedCounty === 'howard'
              ? '/howard_parcels_enriched.geojson'
              : '/api/parcels'
          ),
          wellsPromise,
        ])

        if (!parcelsResponse.ok) {
          throw new Error(`Parcels API failed (${parcelsResponse.status})`)
        }

        const parcelsData = await parcelsResponse.json()
        const wells: WellLayerRecord[] =
          selectedCounty === 'howard'
            ? ((wellsResult.data ?? []) as Array<Record<string, unknown>>).map((well) => ({
              latitude: (well.latitude as number | string | null) ?? null,
              longitude: (well.longitude as number | string | null) ?? null,
              well_type: (well.well_type as string | null) ?? '',
              operator_name: '',
              lease_name: '',
              completion_date: '',
            }))
            : ((wellsResult.data ?? []) as WellLayerRecord[])

        if (!map.current) return
        console.log('GeoJSON received, features:', parcelsData.features?.length)

        const scoreExpr = [
          'to-number',
          ['coalesce', ['get', 'max_propensity_score'], 0],
        ] as const

        if (map.current.getLayer('permits-layer')) map.current.removeLayer('permits-layer')
        if (map.current.getLayer('parcels-outline')) map.current.removeLayer('parcels-outline')
        if (map.current.getLayer('parcels-fill')) map.current.removeLayer('parcels-fill')
        if (map.current.getSource('permits')) map.current.removeSource('permits')
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

        const permitsGeoJSON: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: wells
            .filter((p) => Number.isFinite(Number(p.longitude)) && Number.isFinite(Number(p.latitude)))
            .map((p) => ({
              type: 'Feature' as const,
              geometry: {
                type: 'Point' as const,
                coordinates: [Number(p.longitude), Number(p.latitude)],
              },
              properties: {
                operator: p.operator_name ?? '',
                lease: p.lease_name ?? '',
                date: p.completion_date ?? '',
                type: p.well_type ?? '',
              },
            })),
        }

        map.current.addSource('permits', { type: 'geojson', data: permitsGeoJSON })
        map.current.addLayer({
          id: 'permits-layer',
          type: 'circle',
          source: 'permits',
          layout: { visibility: showPermits ? 'visible' : 'none' },
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
        console.log('Parcel and permits layers added successfully')
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
  }, [selectedCounty])

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return
    if (map.current.getLayer('permits-layer')) {
      map.current.setLayoutProperty('permits-layer', 'visibility', showPermits ? 'visible' : 'none')
    }
  }, [showPermits])

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
