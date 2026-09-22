import assert from 'node:assert/strict'
import {
  clipLineStringToCounty,
  clipWellFeaturesToCounty,
  countyPolygonFromFeatures,
  pointInCounty,
  type CountyPolygon,
} from './geo-clip'

/**
 * C-shaped county opening to the east — a river-bay / meander.
 *
 *   (0,10) ---------------- (10,10)
 *     |                        |
 *     |          (3,7) ------ (10,7)
 *     |            |
 *     |          (3,3) ------ (10,3)
 *     |                        |
 *   (0,0) ----------------- (10,0)
 *
 * A north-south lateral at x=8 has both ends in the county (bottom and
 * top arms) but crosses the bay (y=3..7) into the neighbor.
 */
const C_COUNTY: CountyPolygon = {
  type: 'Polygon',
  coordinates: [[
    [0, 0],
    [10, 0],
    [10, 3],
    [3, 3],
    [3, 7],
    [10, 7],
    [10, 10],
    [0, 10],
    [0, 0],
  ]],
}

function almost(actual: number, expected: number, eps = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${expected}, got ${actual}`,
  )
}

assert.equal(pointInCounty([8, 1.5], C_COUNTY), true, 'bottom arm is inside')
assert.equal(pointInCounty([8, 8.5], C_COUNTY), true, 'top arm is inside')
assert.equal(pointInCounty([8, 5], C_COUNTY), false, 'bay is outside')
assert.equal(pointInCounty([1, 5], C_COUNTY), true, 'spine of the C is inside')
assert.equal(pointInCounty([10, 1.5], C_COUNTY), true, 'boundary counts as inside')
assert.equal(pointInCounty([11, 1.5], C_COUNTY), false, 'east of the county is outside')

const riverBayLateral = clipLineStringToCounty(
  [[8, 1.5], [8, 8.5]],
  C_COUNTY,
)
assert.equal(
  riverBayLateral.length,
  2,
  'C-shaped crossing must split into two pieces at the county line',
)

const [bottomPiece, topPiece] = riverBayLateral
assert.ok(bottomPiece && topPiece)
almost(bottomPiece[0][0], 8)
almost(bottomPiece[0][1], 1.5)
almost(bottomPiece[bottomPiece.length - 1][0], 8)
almost(bottomPiece[bottomPiece.length - 1][1], 3)
almost(topPiece[0][0], 8)
almost(topPiece[0][1], 7)
almost(topPiece[topPiece.length - 1][0], 8)
almost(topPiece[topPiece.length - 1][1], 8.5)

for (const piece of riverBayLateral) {
  for (const coord of piece) {
    assert.equal(
      pointInCounty([coord[0], coord[1]], C_COUNTY),
      true,
      `clipped vertex ${coord} should stay in the county`,
    )
  }
}

const square: CountyPolygon = {
  type: 'Polygon',
  coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
}
const fullyInside = clipLineStringToCounty([[2, 2], [8, 8]], square)
assert.equal(fullyInside.length, 1)
almost(fullyInside[0][0][0], 2)
almost(fullyInside[0][0][1], 2)
almost(fullyInside[0][1][0], 8)
almost(fullyInside[0][1][1], 8)

const fullyOutside = clipLineStringToCounty([[12, 0], [12, 10]], C_COUNTY)
assert.equal(fullyOutside.length, 0)

const exitsEast = clipLineStringToCounty([[1, 1.5], [12, 1.5]], C_COUNTY)
assert.equal(exitsEast.length, 1)
almost(exitsEast[0][0][0], 1)
almost(exitsEast[0][0][1], 1.5)
almost(exitsEast[0][1][0], 10)
almost(exitsEast[0][1][1], 1.5)

const wellFc: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { geom: 'line', kind: 'producing' },
      geometry: { type: 'LineString', coordinates: [[8, 1.5], [8, 8.5]] },
    },
    {
      type: 'Feature',
      properties: { geom: 'point', kind: 'producing' },
      geometry: { type: 'Point', coordinates: [8, 1.5] },
    },
    {
      type: 'Feature',
      properties: { geom: 'point', kind: 'duc' },
      geometry: { type: 'Point', coordinates: [8, 5] },
    },
    {
      type: 'Feature',
      properties: { geom: 'point', kind: 'producing' },
      geometry: { type: 'Point', coordinates: [8, 8.5] },
    },
  ],
}

const clippedWells = clipWellFeaturesToCounty(wellFc, C_COUNTY)
assert.equal(clippedWells.features.length, 3, 'drop the bay point, keep the two in-county points and the clipped lateral')

const line = clippedWells.features.find((f) => f.geometry?.type !== 'Point')
assert.ok(line)
assert.equal(line.geometry?.type, 'MultiLineString')
assert.equal((line.properties as { geom: string }).geom, 'line')

const points = clippedWells.features.filter((f) => f.geometry?.type === 'Point')
assert.equal(points.length, 2)
const pointYs = points
  .map((f) => (f.geometry as GeoJSON.Point).coordinates[1])
  .sort((a, b) => a - b)
almost(pointYs[0], 1.5)
almost(pointYs[1], 8.5)

const lookedUp = countyPolygonFromFeatures(
  [{
    type: 'Feature',
    id: '48389',
    properties: { __fips: '48389' },
    geometry: C_COUNTY,
  }],
  '48389',
)
assert.equal(lookedUp?.type, 'Polygon')

const passthrough = clipWellFeaturesToCounty(wellFc, null)
assert.equal(passthrough.features.length, 4)

// Cache safety: clipping must not mutate the source FeatureCollection.
assert.equal((wellFc.features[0].geometry as GeoJSON.LineString).type, 'LineString')
assert.equal((wellFc.features[0].geometry as GeoJSON.LineString).coordinates.length, 2)
assert.equal(wellFc.features.length, 4)

// MultiPolygon county (river island / disjoint lobes): keep the in-county
// pieces of a line that spans both lobes and the gap between them.
const multi: CountyPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [[[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]],
    [[[7, 0], [10, 0], [10, 3], [7, 3], [7, 0]]],
  ],
}
const multiPieces = clipLineStringToCounty([[1, 1.5], [9, 1.5]], multi)
assert.equal(multiPieces.length, 2)
almost(multiPieces[0][0][0], 1)
almost(multiPieces[0][multiPieces[0].length - 1][0], 3)
almost(multiPieces[1][0][0], 7)
almost(multiPieces[1][multiPieces[1].length - 1][0], 9)

console.log('geo-clip tests passed')
