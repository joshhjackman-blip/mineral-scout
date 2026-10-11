import assert from 'node:assert/strict'
import { shouldFallbackToSplitLineTypeProducts } from './skip-trace-providers'

assert.equal(shouldFallbackToSplitLineTypeProducts(401), true)
assert.equal(shouldFallbackToSplitLineTypeProducts(403), true)
assert.equal(shouldFallbackToSplitLineTypeProducts(200), false)
assert.equal(shouldFallbackToSplitLineTypeProducts(400), false)
assert.equal(shouldFallbackToSplitLineTypeProducts(404), false)

console.log('skip-trace-providers tests passed')
