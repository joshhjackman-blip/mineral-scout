'use client'

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { COUNTIES } from '@/lib/counties'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

const NAVY = '#0B2A5C'
const NAVY_LINE = '#071E42'
const AMBER = '#EF9F27'

/** Same Permian roadmap counties as the in-app county overview. */
const UPCOMING_COUNTIES: Array<{ name: string; fips: string; mapCenter: [number, number] }> = [
  { name: 'Midland', fips: '48329', mapCenter: [-102.08, 31.87] },
  { name: 'Glasscock', fips: '48173', mapCenter: [-101.52, 31.87] },
  { name: 'Upton', fips: '48461', mapCenter: [-102.05, 31.37] },
  { name: 'Reagan', fips: '48383', mapCenter: [-101.53, 31.37] },
  { name: 'Crane', fips: '48103', mapCenter: [-102.55, 31.40] },
  { name: 'Pecos', fips: '48371', mapCenter: [-102.72, 30.87] },
  { name: 'Ward', fips: '48475', mapCenter: [-103.10, 31.53] },
  { name: 'Winkler', fips: '48495', mapCenter: [-103.05, 31.85] },
  { name: 'Loving', fips: '48301', mapCenter: [-103.58, 31.85] },
  { name: 'Reeves', fips: '48389', mapCenter: [-103.68, 31.30] },
]

const TX_BOUNDS: [[number, number], [number, number]] = [
  [-106.75, 25.7],
  [-93.4, 36.55],
]

function makePinElement(label: string, live: boolean): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = live ? 'cs-mbx-pin cs-mbx-pin-live' : 'cs-mbx-pin cs-mbx-pin-soon'
  wrap.innerHTML = `
    <div class="cs-mbx-pin-mark" aria-hidden="true">
      <svg width="${live ? 28 : 18}" height="${live ? 36 : 24}" viewBox="0 0 28 36" fill="none">
        <path d="M14 1C7.4 1 2 6.4 2 13c0 9.5 12 21.5 12 21.5S26 22.5 26 13C26 6.4 20.6 1 14 1z" fill="${AMBER}"/>
        <circle cx="14" cy="13" r="4.5" fill="${NAVY}"/>
      </svg>
    </div>
    <div class="cs-mbx-pin-label">${label}</div>
  `
  return wrap
}

/**
 * Accurate Mapbox Texas map using TIGER/FIPS county polygons
 * (same Plotly counties GeoJSON as the product map).
 * Navy state fill + amber pins on live / roadmap Permian counties.
 */
export default function TexasMapbox() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (!mapboxgl.accessToken) {
      containerRef.current.innerHTML =
        '<div class="cs-mbx-fallback">Map unavailable</div>'
      return
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': 'rgba(0,0,0,0)' },
          },
        ],
        glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
      },
      bounds: TX_BOUNDS,
      fitBoundsOptions: { padding: 28 },
      interactive: false,
      attributionControl: false,
      logoPosition: 'bottom-left',
    })
    mapRef.current = map

    const clearMarkers = () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
    }

    const onLoad = async () => {
      try {
        const response = await fetch(
          'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json',
        )
        if (!response.ok || !mapRef.current) return
        const geojson = (await response.json()) as GeoJSON.FeatureCollection

        const texasFeatures = (geojson.features ?? [])
          .map((feature) => {
            const properties = (feature.properties ?? {}) as Record<string, unknown>
            const fips = String(feature.id ?? properties.GEOID ?? properties.FIPS ?? '').trim()
            if (!fips.startsWith('48')) return null
            return {
              ...feature,
              id: fips,
              properties: { ...properties, __fips: fips },
            } as GeoJSON.Feature
          })
          .filter(Boolean) as GeoJSON.Feature[]

        if (!mapRef.current) return

        mapRef.current.addSource('tx-counties', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: texasFeatures },
        })

        // Full state — navy
        mapRef.current.addLayer({
          id: 'tx-fill',
          type: 'fill',
          source: 'tx-counties',
          paint: {
            'fill-color': NAVY,
            'fill-opacity': 0.96,
          },
        })
        mapRef.current.addLayer({
          id: 'tx-outline',
          type: 'line',
          source: 'tx-counties',
          paint: {
            'line-color': NAVY_LINE,
            'line-width': 0.6,
            'line-opacity': 0.55,
          },
        })

        const liveFips = Object.values(COUNTIES).map((c) => c.fips)
        const upcomingFips = UPCOMING_COUNTIES.map((c) => c.fips)
        const pinnedFips = [...liveFips, ...upcomingFips]

        // Emphasize pinned Permian counties with an amber outline only —
        // the state stays navy; pins carry the amber accent.
        mapRef.current.addLayer({
          id: 'tx-pinned-outline',
          type: 'line',
          source: 'tx-counties',
          filter: ['in', ['get', '__fips'], ['literal', pinnedFips]],
          paint: {
            'line-color': AMBER,
            'line-width': 1.8,
            'line-opacity': 0.95,
          },
        })

        clearMarkers()

        Object.values(COUNTIES).forEach((county) => {
          const el = makePinElement(county.name, true)
          const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat(county.mapCenter)
            .addTo(map)
          markersRef.current.push(marker)
        })

        UPCOMING_COUNTIES.forEach((county) => {
          const el = makePinElement(county.name, false)
          const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat(county.mapCenter)
            .addTo(map)
          markersRef.current.push(marker)
        })

        map.fitBounds(TX_BOUNDS, { padding: 36, duration: 0 })
      } catch (err) {
        console.error('Landing Texas map failed:', err)
      }
    }

    map.on('load', () => {
      void onLoad()
    })

    const ro = new ResizeObserver(() => {
      map.resize()
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      clearMarkers()
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="cs-mbx-map" aria-hidden="true" />
}
