'use client'
import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

const SAMPLE_OWNERS = [
  { id: 1, name: 'Margaret L. Hoffmann', lat: 29.45, lng: -97.45, score: 9, operator: 'EOG Resources', state: 'OH', motivated: true },
  { id: 2, name: 'Patricia M. Swenson', lat: 29.52, lng: -97.38, score: 9, operator: 'EOG Resources', state: 'WI', motivated: true },
  { id: 3, name: 'Linda J. Vasquez', lat: 29.41, lng: -97.51, score: 9, operator: 'Baytex Energy', state: 'AZ', motivated: true },
  { id: 4, name: 'Estate of Roy T. Briggs', lat: 29.48, lng: -97.42, score: 8, operator: 'EOG Resources', state: 'TX', motivated: true },
  { id: 5, name: 'Carol Ann Petersen', lat: 29.55, lng: -97.48, score: 8, operator: 'Baytex Energy', state: 'MN', motivated: true },
  { id: 6, name: 'Sunrise Minerals LLC', lat: 29.43, lng: -97.55, score: 7, operator: 'EOG Resources', state: 'DE', motivated: true },
  { id: 7, name: 'Thomas P. Blanchard Jr.', lat: 29.38, lng: -97.44, score: 7, operator: 'Marathon Oil', state: 'FL', motivated: true },
  { id: 8, name: 'R&J Land Holdings LLC', lat: 29.50, lng: -97.35, score: 8, operator: 'Baytex Energy', state: 'NV', motivated: true },
  { id: 9, name: 'Barbara N. Hutchins', lat: 29.46, lng: -97.58, score: 4, operator: 'EOG Resources', state: 'TX', motivated: false },
  { id: 10, name: 'James & Ruth Calloway', lat: 29.53, lng: -97.41, score: 3, operator: 'Marathon Oil', state: 'TX', motivated: false },
  { id: 11, name: 'Bobby D. Thornton', lat: 29.39, lng: -97.47, score: 4, operator: 'EOG Resources', state: 'TX', motivated: false },
  { id: 12, name: 'High Plains Mineral Co.', lat: 29.57, lng: -97.52, score: 5, operator: 'Baytex Energy', state: 'TX', motivated: false },
  { id: 13, name: 'Gerald Kowalski', lat: 29.44, lng: -97.39, score: 6, operator: 'Marathon Oil', state: 'TX', motivated: false },
  { id: 14, name: 'Creekside Royalty Trust', lat: 29.47, lng: -97.46, score: 5, operator: 'EOG Resources', state: 'TX', motivated: false },
  { id: 15, name: 'Walter E. Simmons III', lat: 29.51, lng: -97.43, score: 7, operator: 'Baytex Energy', state: 'GA', motivated: true },
]

const SAMPLE_WELLS = [
  { id: 'w1', lat: 29.451, lng: -97.448, status: 'PRODUCING', operator: 'EOG Resources' },
  { id: 'w2', lat: 29.521, lng: -97.381, status: 'PRODUCING', operator: 'EOG Resources' },
  { id: 'w3', lat: 29.411, lng: -97.512, status: 'PRODUCING', operator: 'Baytex Energy' },
  { id: 'w4', lat: 29.481, lng: -97.422, status: 'SHUT IN', operator: 'EOG Resources' },
  { id: 'w5', lat: 29.551, lng: -97.482, status: 'PRODUCING', operator: 'Baytex Energy' },
  { id: 'w6', lat: 29.431, lng: -97.552, status: 'PRODUCING', operator: 'Marathon Oil' },
  { id: 'w7', lat: 29.381, lng: -97.442, status: 'SHUT IN', operator: 'EOG Resources' },
  { id: 'w8', lat: 29.501, lng: -97.352, status: 'PRODUCING', operator: 'Baytex Energy' },
  { id: 'w9', lat: 29.461, lng: -97.582, status: 'PRODUCING', operator: 'EOG Resources' },
  { id: 'w10', lat: 29.531, lng: -97.412, status: 'PRODUCING', operator: 'Marathon Oil' },
]

export default function Map({ motivatedOnly, outOfStateOnly, minScore, showWells, showMotivated, onOwnerClick }: {
  motivatedOnly: boolean
  outOfStateOnly: boolean
  minScore: number
  showWells: boolean
  showMotivated: boolean
  onOwnerClick: (owner: typeof SAMPLE_OWNERS[0]) => void
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
          features: SAMPLE_WELLS.map(w => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
            properties: w
          }))
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
        if (props) onOwnerClick(JSON.parse(props.raw))
      })
      m.on('mouseenter', 'owners-layer', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'owners-layer', () => { m.getCanvas().style.cursor = '' })
    })
  }, [])

  useEffect(() => {
    if (!map.current) return
    const filtered = SAMPLE_OWNERS.filter(o => {
      if (motivatedOnly && !o.motivated) return false
      if (outOfStateOnly && o.state === 'TX') return false
      if (o.score < minScore) return false
      return true
    })
    const source = map.current.getSource('owners') as mapboxgl.GeoJSONSource
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: filtered.map(o => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [o.lng, o.lat] },
          properties: { ...o, raw: JSON.stringify(o) }
        }))
      })
    }
    const wellsSource = map.current.getSource('wells') as mapboxgl.GeoJSONSource
    if (wellsSource) {
      if (showWells) {
        wellsSource.setData({
          type: 'FeatureCollection',
          features: SAMPLE_WELLS.map(w => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
            properties: w
          }))
        })
      } else {
        wellsSource.setData({ type: 'FeatureCollection', features: [] })
      }
    }
  }, [motivatedOnly, outOfStateOnly, minScore, showWells, showMotivated])

  return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
}
