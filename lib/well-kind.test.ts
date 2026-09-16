import assert from 'node:assert/strict'
import { isInjectionWell, omitInjectionWellFeatures } from './well-kind'

assert.equal(isInjectionWell({ kind: 'injection' }), true)
assert.equal(isInjectionWell({ kind: 'producing' }), false)
assert.equal(isInjectionWell({ well_status: 'INJECTION' }), true)
assert.equal(isInjectionWell({ status: 'DISPOSAL' }), true)
assert.equal(isInjectionWell({ lease_name: 'SMITH SWD 12' }), true)
assert.equal(isInjectionWell({ lease_name: 'JONES WATER GATHERING' }), true)
assert.equal(isInjectionWell({ lease_name: 'SMITH 12H' }), false)

const kept = omitInjectionWellFeatures({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { kind: 'producing' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 1] },
      properties: { kind: 'injection' },
    },
  ],
})
assert.equal(kept.features.length, 1)
assert.equal((kept.features[0].properties as { kind: string }).kind, 'producing')

console.log('well-kind tests passed')
