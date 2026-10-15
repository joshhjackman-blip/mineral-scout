import assert from 'node:assert/strict'
import { deriveSkipTraceHits } from './skip-trace-usage'

// Live hits stay lookups minus original no-phone reviews, even after
// researcher recoveries (13 of 28 later found → remaining miss is 15).
assert.deepEqual(deriveSkipTraceHits(73, 0, 28), { hits: 45, misses: 28 })
assert.deepEqual(deriveSkipTraceHits(5, 0, 1), { hits: 4, misses: 1 })
assert.deepEqual(deriveSkipTraceHits(18, 0, 13), { hits: 5, misses: 13 })
assert.deepEqual(deriveSkipTraceHits(10, 7, 3), { hits: 7, misses: 3 })
assert.deepEqual(deriveSkipTraceHits(0, 0, 0), { hits: 0, misses: 0 })
assert.deepEqual(deriveSkipTraceHits(4, 0, 4), { hits: 0, misses: 4 })
// Mid-month hit_count rollout: 5 new hits stored, 49 earlier hits only in reviews.
assert.deepEqual(deriveSkipTraceHits(78, 5, 29), { hits: 49, misses: 29 })

console.log('skip-trace-usage tests passed')
