'use client'
import { useCallback, useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { supabase } from '@/lib/supabase'
import { COUNTIES } from '@/lib/counties'
import type { County, CountyKey } from '@/lib/counties'

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
  mapLevel,
  onCountySelect,
}: {
  showPermits: boolean
  onOwnerClick: (owner: Record<string, unknown>) => void
  focusTarget?: Record<string, unknown> | null
  selectedCounty: CountyKey
  mapLevel: 'county' | 'tract'
  onCountySelect: (countyKey: CountyKey) => void
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const onOwnerClickRef = useRef(onOwnerClick)
  const onCountySelectRef = useRef(onCountySelect)
  const renderTokenRef = useRef(0)
  const currentParcelsDataRef = useRef<GeoJSON.FeatureCollection | null>(null)
  const countyMarkersRef = useRef<mapboxgl.Marker[]>([])
  const tractHandlersRef = useRef<{
    parcelClick?: (e: mapboxgl.MapLayerMouseEvent) => void
    parcelMouseEnter?: () => void
    parcelMouseLeave?: () => void
    permitsClick?: (e: mapboxgl.MapLayerMouseEvent) => void
    permitsMouseEnter?: () => void
    permitsMouseLeave?: () => void
  }>({})
  const countyHandlersRef = useRef<{
    activeMove?: (e: mapboxgl.MapLayerMouseEvent) => void
    activeLeave?: () => void
    activeClick?: (e: mapboxgl.MapLayerMouseEvent) => void
    hoveredFips: string | null
  }>({ hoveredFips: null })
  const activeCountyByFipsRef = useRef<Record<string, CountyKey>>({})
  const county = COUNTIES[selectedCounty]
  const TEXAS_OVERVIEW_CENTER: [number, number] = [-99.5, 31.0]
  const TEXAS_OVERVIEW_ZOOM = 5.5

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

  useEffect(() => {
    onCountySelectRef.current = onCountySelect
  }, [onCountySelect])

  const removeLayerIfExists = (mapInstance: mapboxgl.Map, layerId: string) => {
    if (mapInstance.getLayer(layerId)) {
      mapInstance.removeLayer(layerId)
    }
  }

  const removeSourceIfExists = (mapInstance: mapboxgl.Map, sourceId: string) => {
    if (mapInstance.getSource(sourceId)) {
      mapInstance.removeSource(sourceId)
    }
  }

  const clearCountyMarkers = useCallback(() => {
    countyMarkersRef.current.forEach((marker) => marker.remove())
    countyMarkersRef.current = []
  }, [])

  const clearTractLayers = useCallback((mapInstance: mapboxgl.Map) => {
    const handlers = tractHandlersRef.current
    if (handlers.parcelClick) mapInstance.off('click', 'parcels-fill', handlers.parcelClick)
    if (handlers.parcelMouseEnter) mapInstance.off('mouseenter', 'parcels-fill', handlers.parcelMouseEnter)
    if (handlers.parcelMouseLeave) mapInstance.off('mouseleave', 'parcels-fill', handlers.parcelMouseLeave)
    if (handlers.permitsClick) mapInstance.off('click', 'permits-layer', handlers.permitsClick)
    if (handlers.permitsMouseEnter) mapInstance.off('mouseenter', 'permits-layer', handlers.permitsMouseEnter)
    if (handlers.permitsMouseLeave) mapInstance.off('mouseleave', 'permits-layer', handlers.permitsMouseLeave)
    tractHandlersRef.current = {}

    removeLayerIfExists(mapInstance, 'permits-layer')
    removeLayerIfExists(mapInstance, 'parcels-outline')
    removeLayerIfExists(mapInstance, 'parcels-fill')
    removeSourceIfExists(mapInstance, 'permits')
    removeSourceIfExists(mapInstance, 'parcels')
    currentParcelsDataRef.current = null
  }, [])

  const clearCountyLayers = useCallback((mapInstance: mapboxgl.Map) => {
    const handlers = countyHandlersRef.current
    if (handlers.activeMove) mapInstance.off('mousemove', 'tx-counties-active-fill', handlers.activeMove)
    if (handlers.activeLeave) mapInstance.off('mouseleave', 'tx-counties-active-fill', handlers.activeLeave)
    if (handlers.activeClick) mapInstance.off('click', 'tx-counties-active-fill', handlers.activeClick)
    countyHandlersRef.current = { hoveredFips: null }
    activeCountyByFipsRef.current = {}

    removeLayerIfExists(mapInstance, 'tx-counties-active-outline')
    removeLayerIfExists(mapInstance, 'tx-counties-active-fill')
    removeLayerIfExists(mapInstance, 'tx-counties-outline')
    removeLayerIfExists(mapInstance, 'tx-counties-fill')
    removeSourceIfExists(mapInstance, 'tx-counties')
  }, [])

  const setupCountyOverview = useCallback(async () => {
    const mapInstance = map.current
    if (!mapInstance) return

    const renderToken = ++renderTokenRef.current

    clearTractLayers(mapInstance)
    clearCountyLayers(mapInstance)
    clearCountyMarkers()

    const response = await fetch('https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json')
    if (!response.ok || renderToken !== renderTokenRef.current || !map.current) return

    const countyGeoJson = await response.json() as GeoJSON.FeatureCollection
    if (renderToken !== renderTokenRef.current || !map.current) return

    const countyEntries = Object.entries(COUNTIES) as Array<[CountyKey, County]>
    const activeFipsSet = new Set<string>()
    const activeCountyByFips: Record<string, CountyKey> = {}

    countyEntries.forEach(([countyKey, countyConfig]) => {
      activeFipsSet.add(countyConfig.fips)
      activeCountyByFips[countyConfig.fips] = countyKey
    })
    activeCountyByFipsRef.current = activeCountyByFips

    const texasFeatures = (countyGeoJson.features ?? [])
      .map((feature) => {
        const properties = (feature.properties ?? {}) as Record<string, unknown>
        const rawFips = String(feature.id ?? properties.GEOID ?? properties.FIPS ?? '').trim()
        if (!rawFips.startsWith('48')) return null
        return {
          ...feature,
          id: rawFips,
          properties: {
            ...properties,
            __fips: rawFips,
          },
        } as GeoJSON.Feature
      })
      .filter(Boolean) as GeoJSON.Feature[]

    const texasCountyCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: texasFeatures,
    }

    map.current.addSource('tx-counties', { type: 'geojson', data: texasCountyCollection })

    map.current.addLayer({
      id: 'tx-counties-fill',
      type: 'fill',
      source: 'tx-counties',
      paint: {
        'fill-color': '#E5E7EB',
        'fill-opacity': 0.35,
      },
    })

    map.current.addLayer({
      id: 'tx-counties-outline',
      type: 'line',
      source: 'tx-counties',
      paint: {
        'line-color': '#D1D5DB',
        'line-width': 0.5,
      },
    })

    map.current.addLayer({
      id: 'tx-counties-active-fill',
      type: 'fill',
      source: 'tx-counties',
      filter: ['in', ['get', '__fips'], ['literal', Array.from(activeFipsSet)]],
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          '#D97706',
          '#EF9F27',
        ],
        'fill-opacity': 0.75,
      },
    })

    map.current.addLayer({
      id: 'tx-counties-active-outline',
      type: 'line',
      source: 'tx-counties',
      filter: ['in', ['get', '__fips'], ['literal', Array.from(activeFipsSet)]],
      paint: {
        'line-color': '#D97706',
        'line-width': 1.5,
      },
    })

    const onActiveMove = (event: mapboxgl.MapLayerMouseEvent) => {
      if (!map.current) return
      map.current.getCanvas().style.cursor = 'pointer'
      const hoveredFeature = event.features?.[0]
      const hoveredFips = String(
        hoveredFeature?.id ??
        (hoveredFeature?.properties as Record<string, unknown> | undefined)?.__fips ??
        ''
      )
      if (!hoveredFips) return

      const previousHovered = countyHandlersRef.current.hoveredFips
      if (previousHovered && previousHovered !== hoveredFips) {
        map.current.setFeatureState({ source: 'tx-counties', id: previousHovered }, { hover: false })
      }
      countyHandlersRef.current.hoveredFips = hoveredFips
      map.current.setFeatureState({ source: 'tx-counties', id: hoveredFips }, { hover: true })
    }

    const onActiveLeave = () => {
      if (!map.current) return
      map.current.getCanvas().style.cursor = ''
      const previousHovered = countyHandlersRef.current.hoveredFips
      if (previousHovered) {
        map.current.setFeatureState({ source: 'tx-counties', id: previousHovered }, { hover: false })
      }
      countyHandlersRef.current.hoveredFips = null
    }

    const onActiveClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const activeFeature = event.features?.[0]
      const fips = String(
        activeFeature?.id ??
        (activeFeature?.properties as Record<string, unknown> | undefined)?.__fips ??
        ''
      ).trim()
      const countyKey = activeCountyByFipsRef.current[fips]
      if (!countyKey) return
      onCountySelectRef.current(countyKey)
    }

    countyHandlersRef.current.activeMove = onActiveMove
    countyHandlersRef.current.activeLeave = onActiveLeave
    countyHandlersRef.current.activeClick = onActiveClick

    map.current.on('mousemove', 'tx-counties-active-fill', onActiveMove)
    map.current.on('mouseleave', 'tx-counties-active-fill', onActiveLeave)
    map.current.on('click', 'tx-counties-active-fill', onActiveClick)

    countyEntries.forEach(([, countyConfig]) => {
      const markerElement = document.createElement('div')
      markerElement.style.background = '#FFFFFF'
      markerElement.style.border = '1px solid #E5E7EB'
      markerElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)'
      markerElement.style.fontSize = '11px'
      markerElement.style.padding = '6px 12px'
      markerElement.style.borderRadius = '999px'
      markerElement.style.pointerEvents = 'none'
      markerElement.style.fontFamily = 'Inter, sans-serif'
      markerElement.style.color = '#111827'
      markerElement.style.whiteSpace = 'nowrap'
      markerElement.style.lineHeight = '1.2'

      const leadsK = (countyConfig.totalLeads / 1000).toFixed(0)
      markerElement.innerHTML = `<div style="font-weight:700">${countyConfig.name} County</div><div style="color:#6B7280">~${leadsK},000 leads</div>`

      const marker = new mapboxgl.Marker({ element: markerElement, anchor: 'center' })
        .setLngLat(countyConfig.mapCenter)
        .addTo(map.current as mapboxgl.Map)
      countyMarkersRef.current.push(marker)
    })

    map.current.flyTo({
      center: TEXAS_OVERVIEW_CENTER,
      zoom: TEXAS_OVERVIEW_ZOOM,
      duration: 800,
    })
  }, [clearCountyLayers, clearCountyMarkers, clearTractLayers])

  const setupTractLevel = useCallback(async () => {
    const mapInstance = map.current
    if (!mapInstance) return

    const renderToken = ++renderTokenRef.current

    clearCountyLayers(mapInstance)
    clearCountyMarkers()
    clearTractLayers(mapInstance)

    const wellsPromise = supabase
      .from(county.wellsTable)
      .select(
        'api_number,latitude,longitude,operator_name,well_status,lease_name,rrc_lease_id,completion_date,well_type,oil_gas_code'
      )
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)

    const [parcelsResponse, wellsResult] = await Promise.all([
      fetch(county.geoJsonPath),
      wellsPromise,
    ])

    if (!parcelsResponse.ok) {
      throw new Error(`Parcels API failed (${parcelsResponse.status})`)
    }
    if (renderToken !== renderTokenRef.current || !map.current) return

    const parcelsData = await parcelsResponse.json() as GeoJSON.FeatureCollection
    if (renderToken !== renderTokenRef.current || !map.current) return

    currentParcelsDataRef.current = parcelsData
    const wells: WellLayerRecord[] = ((wellsResult.data ?? []) as Array<Record<string, unknown>>).map((well) => ({
      latitude: (well.latitude as number | string | null) ?? null,
      longitude: (well.longitude as number | string | null) ?? null,
      well_type: (well.well_type as string | null) ?? '',
      operator_name: (well.operator_name as string | null) ?? '',
      lease_name: (well.lease_name as string | null) ?? '',
      completion_date: (well.completion_date as string | null) ?? '',
    }))

    const scoreExpr = [
      'to-number',
      ['coalesce', ['get', 'max_propensity_score'], 0],
    ] as const

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

    const parcelClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const props = event.features?.[0]?.properties
      if (props) {
        onOwnerClickRef.current(props as Record<string, unknown>)

        if (event.features?.[0]?.geometry) {
          const geometry = event.features[0].geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
          const bounds = new mapboxgl.LngLatBounds()

          const addCoords = (coords: number[][]) => {
            coords.forEach((coord) => bounds.extend([coord[0], coord[1]] as [number, number]))
          }

          if (geometry.type === 'Polygon') {
            addCoords(geometry.coordinates[0] as number[][])
          } else if (geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach((polygon) => addCoords(polygon[0] as number[][]))
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
    }
    const parcelMouseEnter = () => {
      map.current?.getCanvas().style.setProperty('cursor', 'pointer')
    }
    const parcelMouseLeave = () => {
      if (map.current) map.current.getCanvas().style.cursor = ''
    }

    tractHandlersRef.current.parcelClick = parcelClick
    tractHandlersRef.current.parcelMouseEnter = parcelMouseEnter
    tractHandlersRef.current.parcelMouseLeave = parcelMouseLeave

    map.current.on('click', 'parcels-fill', parcelClick)
    map.current.on('mouseenter', 'parcels-fill', parcelMouseEnter)
    map.current.on('mouseleave', 'parcels-fill', parcelMouseLeave)

    const permitsGeoJSON: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: wells
        .filter((well) => Number.isFinite(Number(well.longitude)) && Number.isFinite(Number(well.latitude)))
        .map((well) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [Number(well.longitude), Number(well.latitude)],
          },
          properties: {
            operator: well.operator_name ?? '',
            lease: well.lease_name ?? '',
            date: well.completion_date ?? '',
            type: well.well_type ?? '',
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

    const permitsClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const props = event.features?.[0]?.properties
      if (!props || !map.current) return
      new mapboxgl.Popup({ closeButton: false, offset: 10 })
        .setLngLat((event.features?.[0]?.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(`<div style="font-family:Inter,sans-serif;font-size:12px;padding:6px">
          <div style="font-weight:600;color:#1d4ed8">New Permit Filed</div>
          <div style="font-weight:500;margin-top:2px">${props.lease ?? ''}</div>
          <div style="color:#6b7280">${props.operator ?? ''}</div>
          <div style="color:#6b7280;font-size:11px">Filed: ${props.date ?? ''}</div>
        </div>`)
        .addTo(map.current)
    }
    const permitsMouseEnter = () => {
      map.current?.getCanvas().style.setProperty('cursor', 'pointer')
    }
    const permitsMouseLeave = () => {
      if (map.current) map.current.getCanvas().style.cursor = ''
    }

    tractHandlersRef.current.permitsClick = permitsClick
    tractHandlersRef.current.permitsMouseEnter = permitsMouseEnter
    tractHandlersRef.current.permitsMouseLeave = permitsMouseLeave
    map.current.on('click', 'permits-layer', permitsClick)
    map.current.on('mouseenter', 'permits-layer', permitsMouseEnter)
    map.current.on('mouseleave', 'permits-layer', permitsMouseLeave)

    map.current.flyTo({
      center: county.mapCenter,
      zoom: county.mapZoom,
      duration: 800,
    })
  }, [clearCountyLayers, clearCountyMarkers, clearTractLayers, county.geoJsonPath, county.mapCenter, county.mapZoom, county.wellsTable, showPermits])

  const renderMapByLevel = useCallback(async () => {
    if (!map.current) return
    if (mapLevel === 'county') {
      await setupCountyOverview()
      return
    }
    await setupTractLevel()
  }, [mapLevel, setupCountyOverview, setupTractLevel])

  useEffect(() => {
    if (map.current || !mapContainer.current) return

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: mapLevel === 'county' ? TEXAS_OVERVIEW_CENTER : county.mapCenter,
      zoom: mapLevel === 'county' ? TEXAS_OVERVIEW_ZOOM : county.mapZoom
    })
    map.current = m

    const handleLoad = () => {
      void renderMapByLevel()
    }
    m.on('load', handleLoad)

    return () => {
      clearCountyMarkers()
      if (map.current) {
        clearCountyLayers(map.current)
        clearTractLayers(map.current)
      }
      map.current?.remove()
      map.current = null
      renderTokenRef.current += 1
    }
  }, [clearCountyLayers, clearCountyMarkers, clearTractLayers, county.mapCenter, county.mapZoom, mapLevel, renderMapByLevel])

  useEffect(() => {
    if (!map.current) return
    if (!map.current.isStyleLoaded()) {
      map.current.once('load', () => {
        void renderMapByLevel()
      })
      return
    }
    void renderMapByLevel()
  }, [renderMapByLevel, selectedCounty, mapLevel])

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return
    if (mapLevel !== 'tract') return
    if (map.current.getLayer('permits-layer')) {
      map.current.setLayoutProperty('permits-layer', 'visibility', showPermits ? 'visible' : 'none')
    }
  }, [mapLevel, showPermits])

  useEffect(() => {
    if (mapLevel !== 'tract') return
    if (!focusTarget || !map.current?.isStyleLoaded()) return

    const features = currentParcelsDataRef.current?.features ?? []

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
  }, [focusTarget, mapLevel])

  return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
}
