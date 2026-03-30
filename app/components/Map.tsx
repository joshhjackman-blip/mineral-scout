'use client'
import { useEffect, useRef } from 'react'
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

      m.on('click', 'owners-layer', (e) => {
        const props = e.features?.[0]?.properties
        if (props?.raw) {
          onOwnerClick(JSON.parse(props.raw as string))
        }
      })
      m.on('mouseenter', 'owners-layer', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'owners-layer', () => { m.getCanvas().style.cursor = '' })
    })
  }, [onOwnerClick])

  useEffect(() => {
    if (!map.current) return
    const filtered = owners.filter(o => {
      if (motivatedOnly && !o.motivated) return false
      if (outOfStateOnly && !o.out_of_state) return false
      if (!showMotivated && o.motivated) return false
      if (o.propensity_score < minScore) return false
      return true
    })
    const source = map.current.getSource('owners') as mapboxgl.GeoJSONSource
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: filtered.map(o => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [Number(o.longitude), Number(o.latitude)],
          },
          properties: { ...o, raw: JSON.stringify(o) }
        })).filter((f) =>
          Number.isFinite(f.geometry.coordinates[0]) && Number.isFinite(f.geometry.coordinates[1])
        )
      })
    }
    const wellsSource = map.current.getSource('wells') as mapboxgl.GeoJSONSource
    if (wellsSource) {
      if (showWells) {
        wellsSource.setData({
          type: 'FeatureCollection',
          features: wells.map(w => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
            properties: { ...w, status: w.well_status }
          }))
        })
      } else {
        wellsSource.setData({ type: 'FeatureCollection', features: [] })
      }
    }
  }, [owners, wells, motivatedOnly, outOfStateOnly, minScore, showWells, showMotivated])

  return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
}
