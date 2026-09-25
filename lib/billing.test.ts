import assert from 'node:assert/strict'
import {
  SKIP_TRACE_PRICE_USD,
  estimateMonthlySkipTraceCost,
  isSkipTraceBillable,
} from './billing'

assert.equal(SKIP_TRACE_PRICE_USD, 1)

assert.equal(isSkipTraceBillable({ cached: true, phoneCount: 2 }), false)
assert.equal(isSkipTraceBillable({ waived: true, phoneCount: 2 }), false)
assert.equal(isSkipTraceBillable({ phoneCount: 0 }), false)
assert.equal(isSkipTraceBillable({ phoneCount: 0, cached: false }), false)
assert.equal(isSkipTraceBillable({ phoneCount: 1 }), true)
assert.equal(isSkipTraceBillable({ phoneCount: 3, cached: false, waived: false }), true)
assert.equal(isSkipTraceBillable({}), false)

assert.equal(estimateMonthlySkipTraceCost(0), 0)
assert.equal(estimateMonthlySkipTraceCost(7), 7)
assert.equal(estimateMonthlySkipTraceCost(-2), 0)

console.log('billing.test.ts ok')
