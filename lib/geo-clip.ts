/**
 * Clip well points and laterals to a county polygon.
 *
 * Tract view should not show as-drilled laterals that leave the selected
 * county. Square Permian counties almost never have this, but concave
 * river borders (Reeves / Pecos) can put both endpoints inside the
 * county while the middle of the well crosses a meander into a neighbor.
 *
 * Basin view leaves laterals unclipped so the full well still draws
 * across county lines.
 */

export type LngLat = [number, number]
export type CountyPolygon = GeoJSON.Polygon | GeoJSON.MultiPolygon

const EPS = 1e-12
const ON_EDGE_EPS = 1e-10

function asLngLat(coord: number[]): LngLat {
  return [Number(coord[0]), Number(coord[1])]
}

function nearlyEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps
}

function samePoint(a: number[], b: number[], eps = ON_EDGE_EPS): boolean {
  return nearlyEqual(a[0], b[0], eps) && nearlyEqual(a[1], b[1], eps)
}

function lerp(a: number[], b: number[], t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function ringVertexCount(ring: number[][]): number {
  if (ring.length < 2) return ring.length
  const last = ring[ring.length - 1]
  const first = ring[0]
  if (samePoint(first, last)) return ring.length - 1
  return ring.length
}

/** Ray-casting, treating the closing vertex as a duplicate. */
export function pointInRing(point: LngLat, ring: number[][]): boolean {
  const n = ringVertexCount(ring)
  if (n < 3) return false
  const x = point[0]
  const y = point[1]
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const denom = yj - yi
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (denom === 0 ? 1 : denom) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function pointOnSegment(
  point: LngLat,
  a: number[],
  b: number[],
  eps = ON_EDGE_EPS,
): boolean {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const apx = point[0] - a[0]
  const apy = point[1] - a[1]
  const len2 = abx * abx + aby * aby
  if (len2 <= eps * eps) return samePoint(point, a, eps)
  const cross = abx * apy - aby * apx
  if (Math.abs(cross) > eps * Math.sqrt(len2)) return false
  const dot = apx * abx + apy * aby
  return dot >= -eps && dot <= len2 + eps
}

function pointOnRing(point: LngLat, ring: number[][]): boolean {
  const n = ringVertexCount(ring)
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    if (pointOnSegment(point, a, b)) return true
  }
  return false
}

function polygonRings(polygon: GeoJSON.Polygon): number[][][] {
  return polygon.coordinates as number[][][]
}

function iterPolygons(geom: CountyPolygon): GeoJSON.Polygon[] {
  if (geom.type === 'Polygon') return [geom]
  return geom.coordinates.map((coords) => ({
    type: 'Polygon' as const,
    coordinates: coords,
  }))
}

function iterRings(geom: CountyPolygon): number[][][] {
  const rings: number[][][] = []
  for (const polygon of iterPolygons(geom)) {
    for (const ring of polygonRings(polygon)) rings.push(ring)
  }
  return rings
}

/**
 * True when `point` is inside the county, including its boundary.
 * A point on a hole edge still counts as on the county line.
 */
export function pointInCounty(point: LngLat, geom: CountyPolygon): boolean {
  for (const ring of iterRings(geom)) {
    if (pointOnRing(point, ring)) return true
  }
  for (const polygon of iterPolygons(geom)) {
    const rings = polygonRings(polygon)
    const outer = rings[0]
    if (!outer || !pointInRing(point, outer)) continue
    const inHole = rings.slice(1).some((hole) => pointInRing(point, hole))
    if (!inHole) return true
  }
  return false
}

function geomBBox(geom: CountyPolygon): [number, number, number, number] | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of iterRings(geom)) {
    for (const coord of ring) {
      if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) continue
      if (coord[0] < minX) minX = coord[0]
      if (coord[1] < minY) minY = coord[1]
      if (coord[0] > maxX) maxX = coord[0]
      if (coord[1] > maxY) maxY = coord[1]
    }
  }
  if (!Number.isFinite(minX)) return null
  return [minX, minY, maxX, maxY]
}

function coordsBBox(coords: number[][]): [number, number, number, number] | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const coord of coords) {
    if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) continue
    if (coord[0] < minX) minX = coord[0]
    if (coord[1] < minY) minY = coord[1]
    if (coord[0] > maxX) maxX = coord[0]
    if (coord[1] > maxY) maxY = coord[1]
  }
  if (!Number.isFinite(minX)) return null
  return [minX, minY, maxX, maxY]
}

function bboxesDisjoint(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]
}

/** Parametric t on AB where AB intersects CD, or null. */
function segmentIntersectionT(
  a: number[],
  b: number[],
  c: number[],
  d: number[],
): number | null {
  const rx = b[0] - a[0]
  const ry = b[1] - a[1]
  const sx = d[0] - c[0]
  const sy = d[1] - c[1]
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-18) return null
  const cx = c[0] - a[0]
  const cy = c[1] - a[1]
  const t = (cx * sy - cy * sx) / denom
  const u = (cx * ry - cy * rx) / denom
  if (t < -EPS || t > 1 + EPS) return null
  if (u < -EPS || u > 1 + EPS) return null
  return Math.min(1, Math.max(0, t))
}

function intersectionTsOnSegment(
  a: number[],
  b: number[],
  geom: CountyPolygon,
): number[] {
  const ts: number[] = [0, 1]
  for (const ring of iterRings(geom)) {
    const n = ringVertexCount(ring)
    for (let i = 0; i < n; i += 1) {
      const c = ring[i]
      const d = ring[(i + 1) % n]
      if (samePoint(c, d)) continue
      const t = segmentIntersectionT(a, b, c, d)
      if (t == null) continue
      ts.push(t)
    }
  }
  ts.sort((x, y) => x - y)
  const unique: number[] = []
  for (const t of ts) {
    const prev = unique[unique.length - 1]
    if (prev == null || Math.abs(prev - t) > 1e-9) unique.push(t)
  }
  return unique
}

/**
 * Clip a polyline to the county. Returns zero or more LineString
 * coordinate arrays. A C-shaped / river-bay crossing becomes two
 * pieces cut at the county line.
 */
export function clipLineStringToCounty(
  coords: number[][],
  geom: CountyPolygon,
): number[][][] {
  const countyBox = geomBBox(geom)
  const lineBox = coordsBBox(coords)
  if (countyBox && lineBox && bboxesDisjoint(countyBox, lineBox)) return []

  const cleaned = coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))
  if (cleaned.length === 0) return []
  if (cleaned.length === 1) {
    return pointInCounty(asLngLat(cleaned[0]), geom) ? [cleaned] : []
  }

  const pieces: number[][][] = []
  let current: number[][] | null = null

  const append = (point: number[]) => {
    if (!current) {
      current = [point]
      return
    }
    const last = current[current.length - 1]
    if (!samePoint(last, point)) current.push(point)
  }
  const closePiece = () => {
    if (current && current.length >= 2) pieces.push(current)
    current = null
  }

  for (let i = 0; i < cleaned.length - 1; i += 1) {
    const a = cleaned[i]
    const b = cleaned[i + 1]
    if (samePoint(a, b)) continue
    const ts = intersectionTsOnSegment(a, b, geom)
    for (let k = 0; k < ts.length - 1; k += 1) {
      const t0 = ts[k]
      const t1 = ts[k + 1]
      if (t1 - t0 <= EPS) continue
      const mid = lerp(a, b, (t0 + t1) / 2)
      if (pointInCounty(mid, geom)) {
        append(lerp(a, b, t0))
        append(lerp(a, b, t1))
      } else {
        closePiece()
      }
    }
  }
  closePiece()
  return pieces
}

function lineGeometryFromPieces(pieces: number[][][]): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  if (pieces.length === 0) return null
  if (pieces.length === 1) {
    return { type: 'LineString', coordinates: pieces[0] }
  }
  return { type: 'MultiLineString', coordinates: pieces }
}

export function clipFeatureToCounty(
  feature: GeoJSON.Feature,
  geom: CountyPolygon,
): GeoJSON.Feature | null {
  const g = feature.geometry
  if (!g) return null

  if (g.type === 'Point') {
    const coord = asLngLat(g.coordinates as number[])
    if (!pointInCounty(coord, geom)) return null
    return feature
  }

  if (g.type === 'MultiPoint') {
    const kept = (g.coordinates as number[][]).filter((c) =>
      pointInCounty(asLngLat(c), geom),
    )
    if (kept.length === 0) return null
    return {
      type: 'Feature',
      properties: feature.properties ?? {},
      geometry: kept.length === 1
        ? { type: 'Point', coordinates: kept[0] }
        : { type: 'MultiPoint', coordinates: kept },
    }
  }

  if (g.type === 'LineString') {
    const pieces = clipLineStringToCounty(g.coordinates as number[][], geom)
    const clipped = lineGeometryFromPieces(pieces)
    if (!clipped) return null
    return {
      type: 'Feature',
      properties: feature.properties ?? {},
      geometry: clipped,
    }
  }

  if (g.type === 'MultiLineString') {
    const pieces = (g.coordinates as number[][][]).flatMap((line) =>
      clipLineStringToCounty(line, geom),
    )
    const clipped = lineGeometryFromPieces(pieces)
    if (!clipped) return null
    return {
      type: 'Feature',
      properties: feature.properties ?? {},
      geometry: clipped,
    }
  }

  return feature
}

export function clipWellFeaturesToCounty(
  fc: GeoJSON.FeatureCollection,
  countyGeom: GeoJSON.Geometry | null | undefined,
): GeoJSON.FeatureCollection {
  if (!countyGeom || (countyGeom.type !== 'Polygon' && countyGeom.type !== 'MultiPolygon')) {
    return fc
  }
  const features: GeoJSON.Feature[] = []
  for (const feature of fc.features) {
    const clipped = clipFeatureToCounty(feature, countyGeom)
    if (clipped) features.push(clipped)
  }
  return { type: 'FeatureCollection', features }
}

export function countyPolygonFromFeatures(
  features: GeoJSON.Feature[] | null | undefined,
  fips: string,
): CountyPolygon | null {
  if (!features || !fips) return null
  const feat = features.find((feature) => {
    const props = (feature.properties ?? {}) as Record<string, unknown>
    return String(feature.id ?? '') === fips || String(props.__fips ?? '') === fips
  })
  const geom = feat?.geometry
  if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) return geom
  return null
}
