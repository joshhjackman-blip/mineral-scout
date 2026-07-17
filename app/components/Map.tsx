'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { supabase } from '@/lib/supabase'
import { COUNTIES } from '@/lib/counties'
import type { County, CountyKey } from '@/lib/counties'
import TractSearch from './TractSearch'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

// Flatten a GeoJSON polygon/multipolygon geometry into a flat array of [lng, lat]
// coordinate pairs so we can compute a rough bbox-based centroid without adding
// @turf as a dependency.
// Bare-abstract normalizer used by every parcel-lookup site in this
// file: strips a leading "A-" so a shapefile-labeled 'A-160' matches
// a compute-script-keyed '160' in tract_development_status.
const bareAbstract = (raw: unknown): string =>
  String(raw ?? '').replace(/^A-\s*/i, '').trim()

// Unified lifecycle statuses used to color the tract fills. Every tract
// on the map falls into exactly ONE of these buckets — the old split
// between "Activity" (production_status) and "Development" (dev_status)
// caused the same concept to render in two different colors (PDP was
// yellow on one view and green on the other), which was confusing, so
// they've been merged. All coloring, toggles, and legend rows work off
// map_status now.
type UnifiedStatus =
  | 'PDP'
  | 'PUD_DUC'
  | 'PUD_PERMITTED'
  | 'PUD_INFILL'
  | 'LEASING_ACTIVE'
  | 'FRONTIER'

// Map a production_status string (older schema, always populated on the
// baked geojson) into the unified dev-status space. Used as a fallback
// when tract_development_status hasn't been computed for a county yet
// (e.g. Martin only has production_status right now, not dev status).
function productionStatusToUnified(production: string): UnifiedStatus {
  const p = production.toLowerCase()
  if (p === 'pdp') return 'PDP'
  if (p === 'pud' || p === 'new_permit' || p === 'pending_permit') return 'PUD_PERMITTED'
  return 'FRONTIER'
}

// Compute the unified map_status for a single feature from whichever
// signal is stronger: dev-status classification wins when it's not
// FRONTIER; otherwise fall back to production_status. Result is written
// to feature.properties.map_status.
function deriveMapStatus(
  props: GeoJSON.GeoJsonProperties,
  entry: { development_status?: string } | undefined,
): UnifiedStatus {
  const devStatus = entry?.development_status
  if (devStatus && devStatus !== 'FRONTIER') return devStatus as UnifiedStatus
  return productionStatusToUnified(String(props?.production_status ?? 'none'))
}

function injectDevStatusIntoFeatures(
  collection: GeoJSON.FeatureCollection,
  lookup: Record<string, {
    development_status?: string
    pud_score?: number
    signal_detail?: {
      permits?: unknown[]
      ducs?: unknown[]
      adjacent_permit_count?: number
      infill_gaps?: number
    }
  }>,
): void {
  const hasLookup = lookup && Object.keys(lookup).length > 0
  for (const feature of collection.features) {
    const props = feature.properties ?? {}
    const key = bareAbstract(props.ABSTRACT_L ?? props.ABSTRACT_N)
    const entry = hasLookup && key ? lookup[key] : undefined
    const mapStatus = deriveMapStatus(props, entry)
    feature.properties = {
      ...props,
      development_status: entry?.development_status ?? 'FRONTIER',
      pud_score: entry?.pud_score ?? 0,
      map_status: mapStatus,
    }
  }
}

const flattenPolygonCoords = (geometry: GeoJSON.Geometry | null | undefined): number[][] => {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return (geometry.coordinates[0] ?? []) as number[][]
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as unknown as number[][][][]).flatMap(
      (poly) => (poly[0] ?? []) as number[][]
    )
  }
  return []
}

const featureBboxCenter = (
  feature: GeoJSON.Feature | undefined | null
): [number, number] | null => {
  if (!feature) return null
  const coords = flattenPolygonCoords(feature.geometry)
  if (coords.length === 0) return null
  const lngs: number[] = []
  const lats: number[] = []
  for (const c of coords) {
    const lng = Number(c[0])
    const lat = Number(c[1])
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      lngs.push(lng)
      lats.push(lat)
    }
  }
  if (lngs.length === 0) return null
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ]
}

const buildBlockLabelFeatureCollection = (
  featureCollection: GeoJSON.FeatureCollection
): GeoJSON.FeatureCollection => {
  // `Map` the identifier is the default-exported component in this file, so
  // we use a plain object keyed by block name instead of the built-in Map.
  const blockCentroids: Record<string, { lngSum: number; latSum: number; count: number }> = {}
  for (const feature of featureCollection.features) {
    const props = (feature.properties ?? {}) as Record<string, unknown>
    // Howard's Abstracts.shp exposes ``Block`` ("31 T2N"), Martin's exposes
    // ``LEVEL2_BLO`` ("35 T1N", "A", "HA"); accept either so the centroid
    // labels show up for all counties without per-county special casing.
    const blockRaw = props.Block ?? props.block ?? props.LEVEL2_BLO ?? props.level2_blo
    const blockValue = typeof blockRaw === 'string'
      ? blockRaw.trim()
      : blockRaw != null
        ? String(blockRaw).trim()
        : ''
    if (!blockValue) continue

    const center = featureBboxCenter(feature)
    if (!center) continue

    const entry = blockCentroids[blockValue] ?? { lngSum: 0, latSum: 0, count: 0 }
    entry.lngSum += center[0]
    entry.latSum += center[1]
    entry.count += 1
    blockCentroids[blockValue] = entry
  }

  const features: GeoJSON.Feature[] = []
  for (const block of Object.keys(blockCentroids)) {
    const { lngSum, latSum, count } = blockCentroids[block]
    if (count === 0) continue
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lngSum / count, latSum / count],
      },
      properties: { block },
    })
  }

  return { type: 'FeatureCollection', features }
}

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

type TractLayerHandlers = {
  layerId: string
  mouseEnterHandler: () => void
  mouseLeaveHandler: () => void
}

type PermitLayerHandlers = {
  clickHandler?: (event: mapboxgl.MapLayerMouseEvent) => void
  mouseEnterHandler?: () => void
  mouseLeaveHandler?: () => void
}

type CountyOverviewHandlers = {
  moveHandler?: (event: mapboxgl.MapLayerMouseEvent) => void
  leaveHandler?: () => void
  clickHandler?: (event: mapboxgl.MapLayerMouseEvent) => void
  hoveredFips: string | null
}

export type DevelopmentStatusKey =
  | 'PDP'
  | 'PUD_DUC'
  | 'PUD_PERMITTED'
  | 'PUD_INFILL'
  | 'LEASING_ACTIVE'
  | 'FRONTIER'

export type DevStatusMapEntry = {
  development_status: DevelopmentStatusKey
  pud_score: number
}

export default function Map({
  onOwnerClick,
  focusTarget,
  selectedCounty,
  mapFlyToRef,
  mapLevel,
  onCountySelect,
  onCountySwitch,
  devStatusByAbstract,
}: {
  onOwnerClick: (owner: Record<string, unknown>) => void
  focusTarget?: Record<string, unknown> | null
  selectedCounty: CountyKey
  mapFlyToRef?: React.MutableRefObject<((center: [number, number], zoom: number) => void) | null>
  mapLevel: 'county' | 'tract'
  onCountySelect?: (countyKey: CountyKey) => void
  onCountySwitch: (countyId: string) => void
  devStatusByAbstract?: Record<string, DevStatusMapEntry>
}) {
  // In-map layer toggles. Every tract on the map is classified into one
  // of the 6 UnifiedStatus buckets (see deriveMapStatus at the top of
  // this file). Each toggle controls whether that bucket is visible on
  // the fill — turning one off drops its fill-opacity + outline-width
  // to 0, effectively hiding those tracts. The Rigs toggle is separate:
  // it drives a red-dot overlay showing wells currently drilling,
  // which is a live signal that's meaningful regardless of the tract's
  // primary classification.
  const [statusVisible, setStatusVisible] = useState<Record<UnifiedStatus, boolean>>({
    PDP: true,
    PUD_DUC: true,
    PUD_PERMITTED: true,
    PUD_INFILL: true,
    LEASING_ACTIVE: true,
    FRONTIER: true,
  })
  const setStatus = useCallback((key: UnifiedStatus, v: boolean) => {
    setStatusVisible((prev) => ({ ...prev, [key]: v }))
  }, [])
  const [showRigs, setShowRigs] = useState(true)
  // Latest devStatusByAbstract in a ref so the setupTractLevel closure
  // (memoized on countyEntries only) still sees fresh data.
  const devStatusByAbstractRef = useRef(devStatusByAbstract ?? {})
  useEffect(() => {
    devStatusByAbstractRef.current = devStatusByAbstract ?? {}
  }, [devStatusByAbstract])
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const onOwnerClickRef = useRef(onOwnerClick)
  const onCountySwitchRef = useRef(onCountySwitch)
  const onCountySelectRef = useRef(onCountySelect)
  const selectedCountyRef = useRef<CountyKey>(selectedCounty)
  const lastClickTimeRef = useRef(0)
  const renderForCurrentLevelRef = useRef<() => Promise<void>>(async () => {})
  const renderTokenRef = useRef(0)
  const currentParcelsByCountyRef = useRef<Partial<Record<CountyKey, GeoJSON.FeatureCollection>>>({})
  const countyMarkersRef = useRef<mapboxgl.Marker[]>([])
  const tractHandlersRef = useRef<TractLayerHandlers[]>([])
  const tractClickHandlerRef = useRef<((event: mapboxgl.MapMouseEvent) => void) | null>(null)
  const permitHandlersRef = useRef<PermitLayerHandlers>({})
  const countyOverviewHandlersRef = useRef<CountyOverviewHandlers>({ hoveredFips: null })
  const activeCountyByFipsRef = useRef<Record<string, CountyKey>>({})
  // The county that was last visually styled as "active" by
  // applyTractCountyStyles. Used to short-circuit the all-counties pass on
  // every click so we only repaint the two counties whose styling actually
  // flipped (old active → muted, new active → bright).
  const lastStyledSelectedCountyRef = useRef<CountyKey | null>(null)
  // Cache permit GeoJSON by county id so flipping between counties doesn't
  // re-issue a Supabase round-trip every time.
  const permitsCacheRef = useRef<Partial<Record<CountyKey, GeoJSON.FeatureCollection>>>({})

  const TEXAS_OVERVIEW_CENTER: [number, number] = [-99.5, 31.0]
  const TEXAS_OVERVIEW_ZOOM = 5.5

  const countyEntries = useMemo(
    () => Object.entries(COUNTIES) as Array<[CountyKey, County]>,
    []
  )

  useEffect(() => {
    onOwnerClickRef.current = onOwnerClick
  }, [onOwnerClick])

  useEffect(() => {
    onCountySwitchRef.current = onCountySwitch
  }, [onCountySwitch])

  useEffect(() => {
    onCountySelectRef.current = onCountySelect
  }, [onCountySelect])

  useEffect(() => {
    selectedCountyRef.current = selectedCounty
  }, [selectedCounty])

  const removeLayerIfExists = (mapInstance: mapboxgl.Map, layerId: string) => {
    if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId)
  }

  const removeSourceIfExists = (mapInstance: mapboxgl.Map, sourceId: string) => {
    if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId)
  }

  const clearCountyMarkers = useCallback(() => {
    countyMarkersRef.current.forEach((marker) => marker.remove())
    countyMarkersRef.current = []
  }, [])

  const fitGeometry = (
    mapInstance: mapboxgl.Map,
    geometry: GeoJSON.Geometry,
    options?: { padding?: number; duration?: number; maxZoom?: number }
  ) => {
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
      mapInstance.fitBounds(bounds, {
        padding: options?.padding ?? 120,
        duration: options?.duration ?? 800,
        maxZoom: options?.maxZoom ?? 14,
      })
    }
  }

  const clearCountyOverviewLayers = useCallback((mapInstance: mapboxgl.Map) => {
    const handlers = countyOverviewHandlersRef.current
    if (handlers.moveHandler) mapInstance.off('mousemove', 'tx-counties-active-fill', handlers.moveHandler)
    if (handlers.leaveHandler) mapInstance.off('mouseleave', 'tx-counties-active-fill', handlers.leaveHandler)
    if (handlers.clickHandler) mapInstance.off('click', 'tx-counties-active-fill', handlers.clickHandler)
    countyOverviewHandlersRef.current = { hoveredFips: null }
    activeCountyByFipsRef.current = {}

    removeLayerIfExists(mapInstance, 'tx-counties-active-outline')
    removeLayerIfExists(mapInstance, 'tx-counties-active-fill')
    removeLayerIfExists(mapInstance, 'tx-counties-outline')
    removeLayerIfExists(mapInstance, 'tx-counties-fill')
    removeSourceIfExists(mapInstance, 'tx-counties')
  }, [])

  const clearTractLayers = useCallback((mapInstance: mapboxgl.Map) => {
    tractHandlersRef.current.forEach((handlers) => {
      mapInstance.off('mouseenter', handlers.layerId, handlers.mouseEnterHandler)
      mapInstance.off('mouseleave', handlers.layerId, handlers.mouseLeaveHandler)
    })
    tractHandlersRef.current = []
    if (tractClickHandlerRef.current) {
      map.current?.off('click', tractClickHandlerRef.current)
      tractClickHandlerRef.current = null
    }

    // Detach the click/hover listeners attached to any of the three
    // per-category permit sub-layers. permitHandlersRef only preserves the
    // last-attached bundle; the others get wiped when the map removes the
    // source below, which detaches all listeners on those layer ids.
    for (const layerId of ['permits-approved-layer', 'permits-pending-layer', 'permits-rigs-layer']) {
      if (permitHandlersRef.current.clickHandler) {
        mapInstance.off('click', layerId, permitHandlersRef.current.clickHandler)
      }
      if (permitHandlersRef.current.mouseEnterHandler) {
        mapInstance.off('mouseenter', layerId, permitHandlersRef.current.mouseEnterHandler)
      }
      if (permitHandlersRef.current.mouseLeaveHandler) {
        mapInstance.off('mouseleave', layerId, permitHandlersRef.current.mouseLeaveHandler)
      }
    }
    permitHandlersRef.current = {}
    // Layers are about to be removed — invalidate the cached "last styled"
    // marker so the next applyTractCountyStyles re-applies the full pass.
    lastStyledSelectedCountyRef.current = null

    removeLayerIfExists(mapInstance, 'permits-approved-layer')
    removeLayerIfExists(mapInstance, 'permits-pending-layer')
    removeLayerIfExists(mapInstance, 'permits-rigs-layer')
    removeSourceIfExists(mapInstance, 'permits')

    countyEntries.forEach(([, countyConfig]) => {
      removeLayerIfExists(mapInstance, `block-labels-${countyConfig.id}`)
      removeSourceIfExists(mapInstance, `block-labels-source-${countyConfig.id}`)
      // Ticket 1.3 multi-color overlay dots (one per secondary signal).
      removeLayerIfExists(mapInstance, `parcels-permit-dot-${countyConfig.id}`)
      removeLayerIfExists(mapInstance, `parcels-duc-dot-${countyConfig.id}`)
      removeLayerIfExists(mapInstance, `parcels-infill-dot-${countyConfig.id}`)
      removeLayerIfExists(mapInstance, `parcels-pending-dot-${countyConfig.id}`)
      // Old singular dot layer id from before the multi-color refactor.
      // Left in the cleanup list so a mid-deploy source swap can tear
      // it down without a `getLayer` guard.
      removeLayerIfExists(mapInstance, `parcels-permit-dots-${countyConfig.id}`)
      removeLayerIfExists(mapInstance, `parcels-sections-${countyConfig.id}`)
      removeLayerIfExists(mapInstance, `parcels-labels-${countyConfig.id}`)
      removeLayerIfExists(mapInstance, `parcels-outline-${countyConfig.id}`)
      removeLayerIfExists(mapInstance, `parcels-fill-${countyConfig.id}`)
      removeSourceIfExists(mapInstance, `parcels-${countyConfig.id}`)
    })
    currentParcelsByCountyRef.current = {}
  }, [countyEntries])

  // Parcels are colored by well-activity classification. `production_status`
  // is written per tract by scripts/add_production_status.py:
  //   pdp             — tract has ≥1 drilled + completed well (bottom-hole)
  //   pud             — tract has wells but none with a bottom-hole record
  //   new_permit      — no wells; approved permit in <county>_permits
  //   pending_permit  — no wells; pending permit
  //   none            — no wells and no permits
  //
  // Permit-only tracts do NOT get a colored fill anymore — instead a small
  // blue dot is placed at the parcel centroid by a separate symbol layer
  // (`parcels-permit-dots-{countyId}`) below. Users read PDP/PUD via fill
  // color and permits via the dot on top.
  // Unified lifecycle palette. Every tract paints via a match on
  // `map_status` (injected in deriveMapStatus). No more Activity vs
  // Development split — one status per tract, one color per status,
  // one legend row per status.
  const STATUS_FILL: Record<UnifiedStatus, string> = {
    PDP:            '#EAB308', // yellow — producing today
    PUD_DUC:        '#A855F7', // purple — drilled, awaiting completion
    PUD_PERMITTED:  '#2563EB', // blue — approved permit, not drilled
    PUD_INFILL:     '#F97316', // orange — spacing-gap infill candidate
    LEASING_ACTIVE: '#16A34A', // green — fresh lease memo
    FRONTIER:       '#E5E7EB', // gray — no signals yet
  }
  const STATUS_OUTLINE: Record<UnifiedStatus, string> = {
    PDP:            '#A16207',
    PUD_DUC:        '#6B21A8',
    PUD_PERMITTED:  '#1D4ED8',
    PUD_INFILL:     '#C2410C',
    LEASING_ACTIVE: '#166534',
    FRONTIER:       '#CBD5E1',
  }
  const STATUS_LABEL: Record<UnifiedStatus, string> = {
    PDP:            'PDP',
    PUD_DUC:        'PUD (DUC)',
    PUD_PERMITTED:  'PUD (Permitted)',
    PUD_INFILL:     'PUD (Infill)',
    LEASING_ACTIVE: 'Leasing active',
    FRONTIER:       'Frontier',
  }
  // Baseline opacities per status (before per-status toggle is applied).
  // Classified tracts sit around 0.70; Frontier is dim so it recedes.
  const STATUS_OPACITY: Record<UnifiedStatus, number> = {
    PDP:            0.72,
    PUD_DUC:        0.82,
    PUD_PERMITTED:  0.78,
    PUD_INFILL:     0.75,
    LEASING_ACTIVE: 0.65,
    FRONTIER:       0.18,
  }
  const STATUS_OUTLINE_WIDTH: Record<UnifiedStatus, number> = {
    PDP:            1.6,
    PUD_DUC:        2.0,
    PUD_PERMITTED:  1.8,
    PUD_INFILL:     1.5,
    LEASING_ACTIVE: 1.4,
    FRONTIER:       0.9,
  }

  const selectedFillColorExpr = useMemo<mapboxgl.Expression>(
    () => [
      'match',
      ['coalesce', ['get', 'map_status'], 'FRONTIER'],
      'PDP',            STATUS_FILL.PDP,
      'PUD_DUC',        STATUS_FILL.PUD_DUC,
      'PUD_PERMITTED',  STATUS_FILL.PUD_PERMITTED,
      'PUD_INFILL',     STATUS_FILL.PUD_INFILL,
      'LEASING_ACTIVE', STATUS_FILL.LEASING_ACTIVE,
      STATUS_FILL.FRONTIER,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Toggling a status off drops its fill-opacity to 0. That's cheaper
  // than a `filter` update (no source refresh needed) and keeps the
  // outline/label layers in sync via the same trick below.
  const selectedFillOpacityExpr = useMemo<mapboxgl.Expression>(
    () => [
      'match',
      ['coalesce', ['get', 'map_status'], 'FRONTIER'],
      'PDP',            statusVisible.PDP            ? STATUS_OPACITY.PDP            : 0,
      'PUD_DUC',        statusVisible.PUD_DUC        ? STATUS_OPACITY.PUD_DUC        : 0,
      'PUD_PERMITTED',  statusVisible.PUD_PERMITTED  ? STATUS_OPACITY.PUD_PERMITTED  : 0,
      'PUD_INFILL',     statusVisible.PUD_INFILL     ? STATUS_OPACITY.PUD_INFILL     : 0,
      'LEASING_ACTIVE', statusVisible.LEASING_ACTIVE ? STATUS_OPACITY.LEASING_ACTIVE : 0,
      statusVisible.FRONTIER ? STATUS_OPACITY.FRONTIER : 0,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusVisible]
  )

  const selectedOutlineColorExpr = useMemo<mapboxgl.Expression>(
    () => [
      'match',
      ['coalesce', ['get', 'map_status'], 'FRONTIER'],
      'PDP',            STATUS_OUTLINE.PDP,
      'PUD_DUC',        STATUS_OUTLINE.PUD_DUC,
      'PUD_PERMITTED',  STATUS_OUTLINE.PUD_PERMITTED,
      'PUD_INFILL',     STATUS_OUTLINE.PUD_INFILL,
      'LEASING_ACTIVE', STATUS_OUTLINE.LEASING_ACTIVE,
      STATUS_OUTLINE.FRONTIER,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const selectedOutlineWidthExpr = useMemo<mapboxgl.Expression>(
    () => [
      'match',
      ['coalesce', ['get', 'map_status'], 'FRONTIER'],
      'PDP',            statusVisible.PDP            ? STATUS_OUTLINE_WIDTH.PDP            : 0,
      'PUD_DUC',        statusVisible.PUD_DUC        ? STATUS_OUTLINE_WIDTH.PUD_DUC        : 0,
      'PUD_PERMITTED',  statusVisible.PUD_PERMITTED  ? STATUS_OUTLINE_WIDTH.PUD_PERMITTED  : 0,
      'PUD_INFILL',     statusVisible.PUD_INFILL     ? STATUS_OUTLINE_WIDTH.PUD_INFILL     : 0,
      'LEASING_ACTIVE', statusVisible.LEASING_ACTIVE ? STATUS_OUTLINE_WIDTH.LEASING_ACTIVE : 0,
      statusVisible.FRONTIER ? STATUS_OUTLINE_WIDTH.FRONTIER : 0,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusVisible]
  )

  const applyTractCountyStyles = useCallback(() => {
    const mapInstance = map.current
    if (!mapInstance) return

    const newSelected = selectedCountyRef.current
    const previouslySelected = lastStyledSelectedCountyRef.current

    const stylePair = (
      countyKey: CountyKey,
      mode: 'active' | 'muted'
    ): boolean => {
      const countyConfig = COUNTIES[countyKey]
      const fillId = `parcels-fill-${countyConfig.id}`
      const outlineId = `parcels-outline-${countyConfig.id}`
      if (!mapInstance.getLayer(fillId) || !mapInstance.getLayer(outlineId)) {
        return false
      }
      if (mode === 'active') {
        mapInstance.setPaintProperty(fillId, 'fill-color', selectedFillColorExpr)
        mapInstance.setPaintProperty(fillId, 'fill-opacity', selectedFillOpacityExpr)
        mapInstance.setPaintProperty(outlineId, 'line-color', selectedOutlineColorExpr)
        mapInstance.setPaintProperty(outlineId, 'line-width', selectedOutlineWidthExpr)
        mapInstance.setPaintProperty(outlineId, 'line-opacity', 0.92)
      } else {
        mapInstance.setPaintProperty(fillId, 'fill-color', '#9E9E9E')
        mapInstance.setPaintProperty(fillId, 'fill-opacity', 0.25)
        mapInstance.setPaintProperty(outlineId, 'line-color', '#CBD5E1')
        mapInstance.setPaintProperty(outlineId, 'line-width', 0.8)
        mapInstance.setPaintProperty(outlineId, 'line-opacity', 1)
      }
      return true
    }

    if (previouslySelected === null) {
      // First pass after layers were just (re)created — set every county to
      // its correct mode in one go.
      countyEntries.forEach(([countyKey]) => {
        stylePair(countyKey, countyKey === newSelected ? 'active' : 'muted')
      })
    } else if (previouslySelected !== newSelected) {
      // Incremental update: only the two counties whose styling actually
      // changed need new paint properties. Skipping the others avoids
      // redundant style events on every click.
      stylePair(previouslySelected, 'muted')
      stylePair(newSelected, 'active')
    } else {
      // Same county — nothing to repaint.
      return
    }

    // Move the active county's symbol layers to the top of the stack. This
    // is intentionally only done when the active county actually changed
    // (the early return above prevents it on no-op calls); back-to-back
    // moveLayer calls force a worker collision-detection pass on every
    // symbol layer below them.
    const selectedConfig = COUNTIES[newSelected]
    const ids = [
      `parcels-fill-${selectedConfig.id}`,
      `parcels-outline-${selectedConfig.id}`,
      `parcels-labels-${selectedConfig.id}`,
      `parcels-sections-${selectedConfig.id}`,
      `block-labels-${selectedConfig.id}`,
    ]
    for (const id of ids) {
      if (mapInstance.getLayer(id)) mapInstance.moveLayer(id)
    }

    lastStyledSelectedCountyRef.current = newSelected
  }, [countyEntries, selectedFillColorExpr, selectedFillOpacityExpr, selectedOutlineColorExpr, selectedOutlineWidthExpr])

  const loadSelectedCountyPermits = useCallback(async () => {
    const mapInstance = map.current
    if (!mapInstance) return

    const countyKey = selectedCountyRef.current
    const countyConfig = COUNTIES[countyKey]
    const permitsTable = `${countyConfig.id}_permits`

    // Use cached GeoJSON if we already loaded permits for this county once.
    let permitsGeoJSON = permitsCacheRef.current[countyKey] ?? null

    if (!permitsGeoJSON) {
      let permitRows: Array<Record<string, unknown>> = []
      const permitsResult = await supabase
        .from(permitsTable)
        .select(
          'permit_number,api_number,operator_name,lease_name,latitude,longitude,permit_type,status,filed_date,approved_date'
        )
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)

      if (permitsResult.error) {
        // Table may not exist for this county (some Permian counties before
        // their migration lands). Fail soft: empty layers so nothing
        // misleading renders.
        console.warn(`[permits] ${permitsTable} unavailable:`, permitsResult.error.message)
      } else {
        permitRows = (permitsResult.data ?? []) as Array<Record<string, unknown>>
      }

      const permits = permitRows.filter((row) => {
        const lon = Number(row.longitude)
        const lat = Number(row.latitude)
        // Guard against junk values (e.g. RRC fixed-width parser artifacts where
        // lat/lon come through as multi-billion integers).
        return (
          Number.isFinite(lon) &&
          Number.isFinite(lat) &&
          lon >= -180 && lon <= 180 &&
          lat >= -90 && lat <= 90
        )
      })

      // Categorize each row into one of three activity layers. The RRC
      // scraper (scripts/scrape_rrc_permits.py) tags rows so this maps 1:1:
      //   permit_type contains 'Drill' -> rig    (wells currently drilling
      //                                            via SYMNUM=21 fallback)
      //   status contains 'PEND'/'FILED' -> pre_permit (application filed)
      //   everything else               -> permit (approved permit or
      //                                            unknown status)
      const categorize = (row: Record<string, unknown>): 'permit' | 'pre_permit' | 'rig' => {
        const type = String(row.permit_type ?? '').toUpperCase()
        const status = String(row.status ?? '').toUpperCase()
        if (type.includes('DRILL') || type.includes('RIG') || status.includes('DRILL')) {
          return 'rig'
        }
        if (status.includes('PEND') || status.includes('FILED') || status.includes('HELD')) {
          return 'pre_permit'
        }
        return 'permit'
      }

      permitsGeoJSON = {
        type: 'FeatureCollection',
        features: permits.map((permit) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [Number(permit.longitude), Number(permit.latitude)],
          },
          properties: {
            operator: String(permit.operator_name ?? ''),
            lease: String(permit.lease_name ?? ''),
            date: String(permit.filed_date ?? permit.approved_date ?? ''),
            type: String(permit.permit_type ?? ''),
            status: String(permit.status ?? ''),
            category: categorize(permit),
          },
        })),
      }
      permitsCacheRef.current[countyKey] = permitsGeoJSON

      // Bail out if the user switched away from this county while the
      // network round-trip was in flight.
      if (countyKey !== selectedCountyRef.current || !map.current) return
    }

    // Three sub-layers, each filtered on `category`. Adds up to a single
    // toggleable set of activity dots without duplicating the source.
    const PERMIT_LAYERS: Array<{
      id: string
      category: 'permit' | 'pre_permit' | 'rig'
      color: string
      strokeColor: string
      radius: number
      visible: boolean
      popupTitle: string
      popupColor: string
    }> = [
      // Only "currently drilling" survives as a per-point overlay.
      // Approved / pending permits are subsumed by the tract-level
      // PUD (Permitted) fill in the unified palette, so drawing an
      // individual blue dot for every permit on top of an already-
      // blue tract was double-encoding the same signal.
      {
        id: 'permits-rigs-layer',
        category: 'rig',
        color: '#DC2626',
        strokeColor: '#ffffff',
        radius: 7,
        visible: showRigs,
        popupTitle: 'Rig — Currently Drilling',
        popupColor: '#991b1b',
      },
    ]

    if (!mapInstance.getSource('permits')) {
      mapInstance.addSource('permits', { type: 'geojson', data: permitsGeoJSON })
      for (const layer of PERMIT_LAYERS) {
        mapInstance.addLayer({
          id: layer.id,
          type: 'circle',
          source: 'permits',
          filter: ['==', ['get', 'category'], layer.category],
          layout: { visibility: layer.visible ? 'visible' : 'none' },
          paint: {
            'circle-radius': layer.radius,
            'circle-color': layer.color,
            'circle-opacity': 0.85,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': layer.strokeColor,
            'circle-stroke-opacity': 1,
          },
        })
      }

      // One popup + cursor handler per sub-layer. The popup color +
      // heading text swap depending on which layer was clicked so users
      // see "Rig", "Pre-Permit", or "Approved Permit" correctly.
      const handlerBundles: Array<{ layerId: string; handlers: PermitLayerHandlers }> = []
      for (const layer of PERMIT_LAYERS) {
        const clickHandler = (event: mapboxgl.MapLayerMouseEvent) => {
          const feature = event.features?.[0]
          const props = feature?.properties
          if (!props || !map.current) return
          new mapboxgl.Popup({ closeButton: false, offset: 10 })
            .setLngLat((feature.geometry as GeoJSON.Point).coordinates as [number, number])
            .setHTML(`<div style="font-family:Inter,sans-serif;font-size:12px;padding:6px">
              <div style="font-weight:600;color:${layer.popupColor}">${layer.popupTitle}</div>
              <div style="font-weight:500;margin-top:2px">${props.lease ?? ''}</div>
              <div style="color:#6b7280">${props.operator ?? ''}</div>
              <div style="color:#6b7280;font-size:11px">${props.date ? `Filed: ${props.date}` : ''}</div>
            </div>`)
            .addTo(map.current)
        }
        const mouseEnterHandler = () => {
          map.current?.getCanvas().style.setProperty('cursor', 'pointer')
        }
        const mouseLeaveHandler = () => {
          if (map.current) map.current.getCanvas().style.cursor = ''
        }
        mapInstance.on('click', layer.id, clickHandler)
        mapInstance.on('mouseenter', layer.id, mouseEnterHandler)
        mapInstance.on('mouseleave', layer.id, mouseLeaveHandler)
        handlerBundles.push({
          layerId: layer.id,
          handlers: { clickHandler, mouseEnterHandler, mouseLeaveHandler },
        })
      }
      // Preserve first bundle's handlers on the ref for backwards-compat
      // cleanup. All handlers get wiped when clearTractLayers removes
      // the source anyway; we only need this ref for the click/hover
      // detach path in clearTractLayers (see the loop that follows).
      permitHandlersRef.current = handlerBundles[0]?.handlers ?? {}
    } else {
      const source = mapInstance.getSource('permits') as mapboxgl.GeoJSONSource
      source.setData(permitsGeoJSON)
    }

    for (const layer of PERMIT_LAYERS) {
      if (mapInstance.getLayer(layer.id)) {
        mapInstance.setLayoutProperty(layer.id, 'visibility', layer.visible ? 'visible' : 'none')
      }
    }
  }, [showRigs])

  const setupCountyOverview = useCallback(async () => {
    const mapInstance = map.current
    if (!mapInstance) return

    const renderToken = ++renderTokenRef.current
    clearTractLayers(mapInstance)
    clearCountyOverviewLayers(mapInstance)
    clearCountyMarkers()

    const response = await fetch('https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json')
    if (!response.ok || renderToken !== renderTokenRef.current || !map.current) return

    const geojson = await response.json() as GeoJSON.FeatureCollection
    if (renderToken !== renderTokenRef.current || !map.current) return

    const activeFipsSet = new Set<string>()
    const activeCountyByFips: Record<string, CountyKey> = {}
    countyEntries.forEach(([countyKey, countyConfig]) => {
      activeFipsSet.add(countyConfig.fips)
      activeCountyByFips[countyConfig.fips] = countyKey
    })
    activeCountyByFipsRef.current = activeCountyByFips

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

    if (!map.current) return
    map.current.addSource('tx-counties', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: texasFeatures },
    })

    if (!map.current) return
    map.current.addLayer({
      id: 'tx-counties-fill',
      type: 'fill',
      source: 'tx-counties',
      paint: { 'fill-color': '#E5E7EB', 'fill-opacity': 0.35 },
    })
    if (!map.current) return
    map.current.addLayer({
      id: 'tx-counties-outline',
      type: 'line',
      source: 'tx-counties',
      paint: { 'line-color': '#D1D5DB', 'line-width': 0.5 },
    })
    if (!map.current) return
    map.current.addLayer({
      id: 'tx-counties-active-fill',
      type: 'fill',
      source: 'tx-counties',
      filter: ['in', ['get', '__fips'], ['literal', Array.from(activeFipsSet)]],
      paint: {
        'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#D97706', '#EF9F27'],
        'fill-opacity': 0.75,
      },
    })
    if (!map.current) return
    map.current.addLayer({
      id: 'tx-counties-active-outline',
      type: 'line',
      source: 'tx-counties',
      filter: ['in', ['get', '__fips'], ['literal', Array.from(activeFipsSet)]],
      paint: { 'line-color': '#D97706', 'line-width': 1.5 },
    })

    const moveHandler = (event: mapboxgl.MapLayerMouseEvent) => {
      if (!map.current) return
      map.current.getCanvas().style.cursor = 'pointer'
      const feature = event.features?.[0]
      const fips = String(feature?.id ?? ((feature?.properties ?? {}) as Record<string, unknown>).__fips ?? '').trim()
      if (!fips) return
      const previous = countyOverviewHandlersRef.current.hoveredFips
      if (previous && previous !== fips) {
        map.current.setFeatureState({ source: 'tx-counties', id: previous }, { hover: false })
      }
      countyOverviewHandlersRef.current.hoveredFips = fips
      map.current.setFeatureState({ source: 'tx-counties', id: fips }, { hover: true })
    }
    const leaveHandler = () => {
      if (!map.current) return
      map.current.getCanvas().style.cursor = ''
      const previous = countyOverviewHandlersRef.current.hoveredFips
      if (previous) map.current.setFeatureState({ source: 'tx-counties', id: previous }, { hover: false })
      countyOverviewHandlersRef.current.hoveredFips = null
    }
    const clickHandler = (event: mapboxgl.MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      const fips = String(feature?.id ?? ((feature?.properties ?? {}) as Record<string, unknown>).__fips ?? '').trim()
      const countyKey = activeCountyByFipsRef.current[fips]
      if (!countyKey) return
      if (onCountySelectRef.current) {
        onCountySelectRef.current(countyKey)
      } else {
        onCountySwitchRef.current(countyKey)
      }
    }

    countyOverviewHandlersRef.current = { moveHandler, leaveHandler, clickHandler, hoveredFips: null }
    map.current.on('mousemove', 'tx-counties-active-fill', moveHandler)
    map.current.on('mouseleave', 'tx-counties-active-fill', leaveHandler)
    map.current.on('click', 'tx-counties-active-fill', clickHandler)

    countyEntries.forEach(([, countyConfig]) => {
      const markerElement = document.createElement('div')
      markerElement.style.background = '#FFFFFF'
      markerElement.style.border = '1px solid #E5E7EB'
      markerElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)'
      markerElement.style.fontSize = '11px'
      markerElement.style.padding = '6px 12px'
      markerElement.style.borderRadius = '999px'
      markerElement.style.pointerEvents = 'none'
      markerElement.style.fontFamily = 'Geist, Inter, system-ui, sans-serif'
      markerElement.style.color = '#111827'
      markerElement.style.whiteSpace = 'nowrap'
      markerElement.style.lineHeight = '1.2'
      markerElement.innerHTML = `<div style="font-weight:700">${countyConfig.name} County</div><div style="color:#6B7280">~${(countyConfig.totalLeads / 1000).toFixed(0)},000 leads</div>`

      const marker = new mapboxgl.Marker({ element: markerElement, anchor: 'center' })
        .setLngLat(countyConfig.mapCenter)
        .addTo(map.current as mapboxgl.Map)
      countyMarkersRef.current.push(marker)
    })

    map.current.flyTo({ center: TEXAS_OVERVIEW_CENTER, zoom: TEXAS_OVERVIEW_ZOOM, duration: 800 })
  }, [clearCountyMarkers, clearCountyOverviewLayers, clearTractLayers, countyEntries])

  const setupTractLevel = useCallback(async () => {
    const mapInstance = map.current
    if (!mapInstance) return

    const renderToken = ++renderTokenRef.current
    clearCountyOverviewLayers(mapInstance)
    clearCountyMarkers()
    clearTractLayers(mapInstance)

    // Always pull the slim map-only GeoJSON (props the renderer needs, no
    // owners_json payload). The full enriched file is still fetched by the
    // side panel in app/page.tsx for owner data. Counties load in parallel
    // so adding more never serializes the cold-load latency.
    const fetchTasks = countyEntries.map(async ([countyKey, countyConfig]) => {
      const response = await fetch(countyConfig.mapGeoJsonPath ?? countyConfig.geoJsonPath)
      if (!response.ok) {
        throw new Error(`Parcels source failed for ${countyConfig.id} (${response.status})`)
      }
      const geojson = await response.json() as GeoJSON.FeatureCollection
      return [countyKey, geojson] as const
    })
    const parcelsByCounty: Array<readonly [CountyKey, GeoJSON.FeatureCollection]> = await Promise.all(fetchTasks)
    if (renderToken !== renderTokenRef.current || !map.current) return

    currentParcelsByCountyRef.current = {}
    parcelsByCounty.forEach(([countyKey, geojson]) => {
      injectDevStatusIntoFeatures(geojson, devStatusByAbstractRef.current)
      currentParcelsByCountyRef.current[countyKey] = geojson
      const countyConfig = COUNTIES[countyKey]
      const sourceId = `parcels-${countyConfig.id}`
      const fillId = `parcels-fill-${countyConfig.id}`
      const outlineId = `parcels-outline-${countyConfig.id}`
      const labelsId = `parcels-labels-${countyConfig.id}`

      if (!map.current) return
      map.current.addSource(sourceId, {
        type: 'geojson',
        data: geojson,
        generateId: true,
        // Default tolerance is 0.375 px which aggressively simplifies small
        // polygons at low zoom — Howard's RRC abstract sections are tightly
        // clustered ~2 km wide and were collapsing out of low-zoom tiles, so
        // the fill layer had nothing to paint until you zoomed past 10. The
        // lower tolerance keeps every polygon present from the first tile
        // load while still trimming redundant vertices. The buffer bump
        // reduces edge clipping artifacts when panning at the tract level.
        tolerance: 0.05,
        buffer: 256,
      })
      if (!map.current) return
      map.current.addLayer({
        id: fillId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#9E9E9E',
          'fill-opacity': 0.25,
        },
      })
      if (!map.current) return
      map.current.addLayer({
        id: outlineId,
        type: 'line',
        source: sourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#CBD5E1',
          'line-width': 0.8,
          'line-opacity': 1,
        },
      })

      if (!map.current) return
      // Parcel labels. Two zoom bands so the user always sees enough
      // context to place themselves without cluttering low-zoom views:
      //   z9–z11: just the abstract label (e.g. "A-543"). Small, dense.
      //   z11+  : full legal description
      //           ("T2N BLK 31 SEC 20 A-543" for T&P counties,
      //            "COOK, W H A-160" for Gonzales-style abstracts),
      //           precomputed per-tract by scripts/build_map_geojson.py
      //           into the `legal_desc` prop.
      // `text-field` switches on zoom via a step expression rather than
      // adding a second layer — Mapbox handles the swap without needing
      // us to manage two symbol layers' visibility.
      map.current.addLayer({
        id: labelsId,
        type: 'symbol',
        source: sourceId,
        minzoom: 9,
        layout: {
          'text-field': [
            'step',
            ['zoom'],
            [
              'coalesce',
              ['get', 'ABSTRACT_L'],
              ['concat', 'A-', ['to-string', ['get', 'ABSTRACT_N']]],
              '',
            ],
            11,
            [
              'coalesce',
              ['get', 'legal_desc'],
              ['get', 'ABSTRACT_L'],
              '',
            ],
          ],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 9,
            12, 11,
            14, 13,
          ],
          'text-anchor': 'center',
          'text-justify': 'center',
          'text-max-width': 10,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'symbol-placement': 'point',
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.4,
          'text-halo-blur': 0.6,
          'text-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            9, 0,
            10, 1,
          ],
        },
      })

      if (!map.current) return
      // Per-tract section number. Only shown at z10+ so we don't clutter
      // the overview zooms. Field-name convention varies by county:
      //   Howard   → Surv_Sect ("20", "25", "26", …)
      //   Martin   → LEVEL3_SUR ("131", "36", …)
      //   Gonzales → no section number in the source shapefile
      // `coalesce` picks the first non-null so the same paint spec works
      // for every county.
      const sectionsId = `parcels-sections-${countyConfig.id}`
      map.current.addLayer({
        id: sectionsId,
        type: 'symbol',
        source: sourceId,
        minzoom: 10,
        layout: {
          'text-field': [
            'coalesce',
            ['get', 'Surv_Sect'],
            ['get', 'LEVEL3_SUR'],
            '',
          ],
          'text-size': 11,
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
          'text-anchor': 'center',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'symbol-placement': 'point',
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#1a1a1a',
          'text-halo-width': 1.5,
        },
      })

      if (!map.current) return
      // Secondary centroid dots (permit / DUC / infill / pending) were
      // removed with the unified-legend redesign. Each of those signals
      // now paints as the tract's primary color via the map_status
      // derivation in deriveMapStatus (PUD_PERMITTED, PUD_DUC, and
      // PUD_INFILL respectively). If a broker wants the exact spud
      // location for a permit they click the tract and read the
      // permits list in the OwnerDrawer.

      if (!map.current) return
      // Block labels: one point per distinct Block value, placed at the
      // averaged centroid of all tracts in that block. Visible earlier than
      // section numbers since blocks are larger aggregations.
      const blockSourceId = `block-labels-source-${countyConfig.id}`
      const blockLayerId = `block-labels-${countyConfig.id}`
      const blockFeatureCollection = buildBlockLabelFeatureCollection(geojson)
      if (blockFeatureCollection.features.length > 0) {
        map.current.addSource(blockSourceId, { type: 'geojson', data: blockFeatureCollection })
        if (!map.current) return
        map.current.addLayer({
          id: blockLayerId,
          type: 'symbol',
          source: blockSourceId,
          minzoom: 8,
          layout: {
            'text-field': ['concat', 'Block ', ['get', 'block']],
            'text-size': 13,
            'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
            'text-anchor': 'center',
            'text-allow-overlap': false,
            'symbol-placement': 'point',
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 2,
          },
        })
      }

      const mouseEnterHandler = () => {
        map.current?.getCanvas().style.setProperty('cursor', 'pointer')
      }
      const mouseLeaveHandler = () => {
        if (map.current) map.current.getCanvas().style.cursor = ''
      }

      tractHandlersRef.current.push({
        layerId: fillId,
        mouseEnterHandler,
        mouseLeaveHandler,
      })

      if (!map.current) return
      map.current.on('mouseenter', fillId, mouseEnterHandler)
      map.current.on('mouseleave', fillId, mouseLeaveHandler)
    })

    if (tractClickHandlerRef.current) {
      map.current?.off('click', tractClickHandlerRef.current)
      tractClickHandlerRef.current = null
    }

    const handler = (event: mapboxgl.MapMouseEvent) => {
      if (!map.current) return
      const now = Date.now()
      if (now - lastClickTimeRef.current < 1000) return
      lastClickTimeRef.current = now

      const layerIds = countyEntries
        .map(([, countyConfig]) => `parcels-fill-${countyConfig.id}`)
        .filter((id) => !!map.current?.getLayer(id))
      if (layerIds.length === 0) return

      const features = map.current.queryRenderedFeatures(event.point, { layers: layerIds })
      if (!features?.length) return

      const selectedLayerId = `parcels-fill-${COUNTIES[selectedCountyRef.current].id}`
      const topFeature = features.find((feature) => feature.layer?.id === selectedLayerId) ?? features[0]
      const topLayerId = topFeature.layer?.id
      if (!topLayerId) return
      const topCountyId = topLayerId.replace('parcels-fill-', '')
      const countyKey = countyEntries.find(([, countyConfig]) => countyConfig.id === topCountyId)?.[0]
      if (!countyKey) return

      const props = topFeature.properties as Record<string, unknown> | undefined
      if (countyKey !== selectedCountyRef.current) {
        onCountySwitchRef.current(countyKey)
        return
      }

      if (props) {
        onOwnerClickRef.current(props as Record<string, unknown>)
      }

      const clickedAbstract = props?.ABSTRACT_L ?? props?.CODE ?? props?.abstract_label
      const countyGeoJSON = currentParcelsByCountyRef.current[countyKey]
      const matchedFeature = countyGeoJSON?.features?.find((feature) => {
        const featureProps = feature.properties as Record<string, unknown>
        return featureProps?.ABSTRACT_L === clickedAbstract ||
          featureProps?.CODE === clickedAbstract ||
          String(featureProps?.CODE) === String(clickedAbstract)
      })
      const geometry = matchedFeature?.geometry ?? (topFeature.geometry as GeoJSON.Geometry | undefined)
      if (geometry) {
        setTimeout(() => {
          if (map.current) {
            try {
              fitGeometry(map.current, geometry)
            } catch (e) {
              console.error('fitGeometry error:', e)
            }
          }
        }, 200)
      }
    }

    tractClickHandlerRef.current = handler
    if (!map.current) return
    map.current.on('click', handler)

    await loadSelectedCountyPermits()
    if (renderToken !== renderTokenRef.current || !map.current) return
    applyTractCountyStyles()
  }, [applyTractCountyStyles, clearCountyMarkers, clearCountyOverviewLayers, clearTractLayers, countyEntries, loadSelectedCountyPermits])

  const renderForCurrentLevel = useCallback(async () => {
    if (!map.current) return
    if (mapLevel === 'county') {
      await setupCountyOverview()
      return
    }
    await setupTractLevel()
  }, [mapLevel, setupCountyOverview, setupTractLevel])

  useEffect(() => {
    renderForCurrentLevelRef.current = renderForCurrentLevel
  }, [renderForCurrentLevel])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (map.current || !mapContainer.current) return

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: TEXAS_OVERVIEW_CENTER,
      zoom: TEXAS_OVERVIEW_ZOOM,
    })
    map.current = mapInstance

    const onLoad = () => {
      setMapReady(true)
      void renderForCurrentLevelRef.current()
    }
    mapInstance.on('load', onLoad)

    return () => {
      clearCountyMarkers()
      if (map.current) {
        if (tractClickHandlerRef.current) {
          map.current.off('click', tractClickHandlerRef.current)
          tractClickHandlerRef.current = null
        }
        clearCountyOverviewLayers(map.current)
        clearTractLayers(map.current)
      }
      map.current?.remove()
      map.current = null
      setMapReady(false)
      renderTokenRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!map.current) return
    if (!map.current.isStyleLoaded()) {
      map.current.once('load', () => {
        void renderForCurrentLevelRef.current()
      })
      return
    }
    void renderForCurrentLevelRef.current()
  }, [mapLevel])

  useEffect(() => {
    if (!mapFlyToRef) return
    mapFlyToRef.current = (center, zoom) => {
      map.current?.flyTo({ center, zoom, duration: 800 })
    }
    return () => {
      mapFlyToRef.current = null
    }
  }, [mapFlyToRef])

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return
    if (mapLevel !== 'tract') return
    applyTractCountyStyles()
    void loadSelectedCountyPermits()
  }, [applyTractCountyStyles, loadSelectedCountyPermits, mapLevel, selectedCounty])

  // When any per-status toggle flips, applyTractCountyStyles's own
  // "same county, nothing to repaint" optimization would swallow the
  // update. Force a repaint by invalidating the last-styled ref before
  // the effect above re-fires (applyTractCountyStyles is memoized on
  // the fill/opacity expressions, which depend on statusVisible).
  useEffect(() => {
    lastStyledSelectedCountyRef.current = null
  }, [statusVisible])

  // Re-inject development_status + secondary flags onto every loaded
  // feature when the per-county dev-status lookup changes (initial
  // fetch + county switch). Without this, features loaded before the
  // Supabase query returns would stay tagged FRONTIER forever.
  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance) return
    const lookup = devStatusByAbstract ?? {}
    if (Object.keys(lookup).length === 0) return
    let updated = 0
    for (const [countyKey, collection] of Object.entries(currentParcelsByCountyRef.current)) {
      if (!collection) continue
      injectDevStatusIntoFeatures(collection, lookup)
      const sourceId = `parcels-${COUNTIES[countyKey as CountyKey].id}`
      const source = mapInstance.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined
      if (source) {
        source.setData(collection)
        updated += 1
      }
    }
    if (updated > 0) {
      lastStyledSelectedCountyRef.current = null
    }
  }, [devStatusByAbstract])

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return
    if (!map.current) return
    const mapInstance = map.current
    const tractLevel = mapLevel === 'tract'
    // Only the rigs overlay remains as an independent dot layer.
    // Approved / pre-permits used to be here but they're now expressed
    // as PUD (Permitted) tract fills via the unified legend.
    if (mapInstance.getLayer('permits-rigs-layer')) {
      mapInstance.setLayoutProperty(
        'permits-rigs-layer',
        'visibility',
        tractLevel && showRigs ? 'visible' : 'none',
      )
    }
  }, [mapLevel, showRigs])

  useEffect(() => {
    if (mapLevel !== 'tract') return
    if (!focusTarget || !map.current?.isStyleLoaded()) return

    const features = currentParcelsByCountyRef.current[selectedCountyRef.current]?.features ?? []
    const selectedAbstract = String(focusTarget.abstract_label ?? focusTarget.ABSTRACT_L ?? '').trim()
    const selectedSurvey = String(focusTarget.level1_sur ?? focusTarget.LEVEL1_SUR ?? '').trim()
    if (!selectedAbstract || !selectedSurvey) return

    const matched = features.find((feature) => {
      const props = (feature.properties ?? {}) as Record<string, unknown>
      const featureAbstract = String(props.abstract_label ?? props.ABSTRACT_L ?? '').trim()
      const featureSurvey = String(props.level1_sur ?? props.LEVEL1_SUR ?? '').trim()
      return featureAbstract === selectedAbstract && featureSurvey === selectedSurvey
    })

    if (matched?.geometry) {
      fitGeometry(map.current, matched.geometry)
    }
  }, [focusTarget, mapLevel, selectedCounty])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      {mapReady && (
        <TractSearch
          map={map.current}
          geojsonUrl={COUNTIES[selectedCounty].mapGeoJsonPath ?? COUNTIES[selectedCounty].geoJsonPath}
        />
      )}
      {mapReady && mapLevel === 'tract' && (
        <LayerTogglePanel
          statusVisible={statusVisible}
          onStatus={setStatus}
          statusPalette={STATUS_FILL}
          statusLabels={STATUS_LABEL}
          rigsVisible={showRigs}
          onRigs={setShowRigs}
        />
      )}
    </div>
  )
}

// In-map layer control. Fixed to the top-right of the map viewport.
// Single unified LEGEND — one row per UnifiedStatus, one color per
// status, one toggle per row. Checking a row shows those tracts;
// unchecking hides them by dropping fill-opacity to 0. Below the
// legend a single OVERLAYS section carries the Active rigs dot
// toggle, which is the one signal that doesn't collapse cleanly
// into the primary tract classification.
function LayerTogglePanel({
  statusVisible, onStatus,
  statusPalette, statusLabels,
  rigsVisible, onRigs,
}: {
  statusVisible: Record<UnifiedStatus, boolean>
  onStatus: (key: UnifiedStatus, v: boolean) => void
  statusPalette: Record<UnifiedStatus, string>
  statusLabels: Record<UnifiedStatus, string>
  rigsVisible: boolean
  onRigs: (v: boolean) => void
}) {
  const statusKeys: UnifiedStatus[] = [
    'PDP', 'PUD_DUC', 'PUD_PERMITTED', 'PUD_INFILL', 'LEASING_ACTIVE', 'FRONTIER',
  ]
  const legendRows = statusKeys.map((key) => ({
    label: statusLabels[key],
    swatch: 'fill' as const,
    color: statusPalette[key],
    checked: statusVisible[key],
    onChange: (v: boolean) => onStatus(key, v),
  }))

  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        top: 12,
        background: 'rgba(255,255,255,0.97)',
        border: '1px solid #E5E7EB',
        borderRadius: 8,
        padding: '10px 12px',
        boxShadow: '0 4px 16px rgba(15,23,42,0.10)',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 12,
        color: '#0F172A',
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 210,
        maxWidth: 250,
      }}
    >
      <div>
        <div style={sectionHeadingStyle}>Legend</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {legendRows.map((row) => (
            <ToggleRow key={row.label} row={row} />
          ))}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 8 }}>
        <div style={sectionHeadingStyle}>Overlays</div>
        <ToggleRow
          row={{
            label: 'Active rigs',
            swatch: 'dot',
            color: '#DC2626',
            checked: rigsVisible,
            onChange: onRigs,
          }}
        />
        <div style={{ marginTop: 4, marginLeft: 22, fontSize: 10.5, color: '#64748B', lineHeight: 1.35 }}>
          Red dot per well currently drilling.
        </div>
      </div>
    </div>
  )
}

const sectionHeadingStyle: React.CSSProperties = {
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: '#475569',
  fontSize: 10,
  marginBottom: 6,
}

function ToggleRow({
  row,
}: {
  row: {
    label: string
    swatch: 'fill' | 'dot'
    color: string
    checked: boolean
    onChange: (v: boolean) => void
  }
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: 12.5,
      }}
    >
      <input
        type="checkbox"
        checked={row.checked}
        onChange={(e) => row.onChange(e.target.checked)}
        style={{ margin: 0, accentColor: row.color, cursor: 'pointer', width: 14, height: 14 }}
      />
      <span
        style={{
          width: 14,
          height: 14,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {row.swatch === 'fill' ? (
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              background: row.color,
              border: '1px solid rgba(15,23,42,0.25)',
              opacity: row.checked ? 1 : 0.35,
            }}
          />
        ) : (
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: row.color,
              border: '1.5px solid #ffffff',
              boxShadow: '0 0 0 1px rgba(15,23,42,0.35)',
              opacity: row.checked ? 1 : 0.35,
            }}
          />
        )}
      </span>
      <span style={{ color: row.checked ? '#0F172A' : '#94A3B8' }}>{row.label}</span>
    </label>
  )
}

// (ProductionStatusLegend removed — its role has been merged into
// LayerTogglePanel above so the swatches double as toggle controls.)
