import assert from 'node:assert/strict'
import {
  resolveSkipTraceProviders,
  shouldFallbackToSplitLineTypeProducts,
  type SkipTraceProviderName,
} from './skip-trace-providers'

assert.equal(shouldFallbackToSplitLineTypeProducts(401), true)
assert.equal(shouldFallbackToSplitLineTypeProducts(403), true)
assert.equal(shouldFallbackToSplitLineTypeProducts(200), false)
assert.equal(shouldFallbackToSplitLineTypeProducts(400), false)
assert.equal(shouldFallbackToSplitLineTypeProducts(404), false)

assert.deepEqual(resolveSkipTraceProviders(), [
  'idicore',
  'accurateappend',
  'batchdata',
  'tracerfy',
])
assert.deepEqual(resolveSkipTraceProviders(['accurateappend']), ['accurateappend'])
assert.deepEqual(resolveSkipTraceProviders(['accurateappend', 'idicore']), [
  'accurateappend',
  'idicore',
])
assert.deepEqual(
  resolveSkipTraceProviders(['accurateappend', 'nope'] as unknown as SkipTraceProviderName[]),
  ['accurateappend'],
)
assert.deepEqual(resolveSkipTraceProviders([]), [
  'idicore',
  'accurateappend',
  'batchdata',
  'tracerfy',
])

console.log('skip-trace-providers tests passed')
