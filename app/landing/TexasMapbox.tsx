'use client'

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { COUNTIES } from '@/lib/counties'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

/** Brand navy — matches `--cs-navy` in coming-soon.css */
const NAVY = '#0B2A5C'
const AMBER = '#EF9F27'

/** Same Permian roadmap counties as the in-app county overview. */
const UPCOMING_COUNTIES: Array<{ fips: string }> = [
  { fips: '48173' }, // Glasscock
  { fips: '48103' }, // Crane
  { fips: '48371' }, // Pecos
  { fips: '48495' }, // Winkler
  { fips: '48389' }, // Reeves
]

const TX_BOUNDS: [[number, number], [number, number]] = [
  [-106.75, 25.7],
  [-93.4, 36.55],
]

/**
 * Accurate Mapbox Texas map using TIGER/FIPS county polygons
 * (same Plotly counties GeoJSON as the product map).
 * Navy fill + county outlines — amber outlines on Permian counties.
 */
export default function TexasMapbox() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)

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
      },
      bounds: TX_BOUNDS,
      fitBoundsOptions: { padding: 8 },
      interactive: false,
      attributionControl: false,
      logoPosition: 'bottom-left',
    })
    mapRef.current = map

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

        mapRef.current.addLayer({
          id: 'tx-fill',
          type: 'fill',
          source: 'tx-counties',
          paint: {
            'fill-color': NAVY,
            'fill-opacity': 1,
          },
        })

        // Light county mesh so the navy silhouette reads as a real map
        mapRef.current.addLayer({
          id: 'tx-outline',
          type: 'line',
          source: 'tx-counties',
          paint: {
            'line-color': '#FFFFFF',
            'line-width': 0.55,
            'line-opacity': 0.22,
          },
        })

        const liveFips = Object.values(COUNTIES).map((c) => c.fips)
        const upcomingFips = UPCOMING_COUNTIES.map((c) => c.fips)
        const permianFips = [...liveFips, ...upcomingFips]

        mapRef.current.addLayer({
          id: 'tx-permian-outline',
          type: 'line',
          source: 'tx-counties',
          filter: ['in', ['get', '__fips'], ['literal', permianFips]],
          paint: {
            'line-color': AMBER,
            'line-width': 2,
            'line-opacity': 1,
          },
        })

        map.fitBounds(TX_BOUNDS, { padding: 8, duration: 0 })
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
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="cs-mbx-map" aria-hidden="true" />
}
