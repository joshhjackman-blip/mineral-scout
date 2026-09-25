import assert from 'node:assert/strict'
import { hasPaidAccess, isSkipTraceWaivedFor } from './access'
import {
  SKIP_TRACE_PRICE_USD,
  estimateMonthlySkipTraceCost,
  isSkipTraceBillable,
} from './billing'
import { isSkipTraceCompedTeam } from './team'

assert.equal(SKIP_TRACE_PRICE_USD, 1)
assert.equal(hasPaidAccess({}, 'anyone@example.com'), true)

assert.equal(isSkipTraceCompedTeam('management@mineralmapllc.com'), true)
assert.equal(isSkipTraceCompedTeam('jordan@greatplainsinterestsllc.com'), true)
assert.equal(isSkipTraceCompedTeam('jordan@greatplainsinterests.com'), true)
assert.equal(isSkipTraceCompedTeam('JORDAN@GreatPlainsInterests.com'), true)
assert.equal(isSkipTraceCompedTeam('quatrocone@gmail.com'), false)
assert.equal(isSkipTraceCompedTeam('broker@example.com'), false)

assert.equal(
  isSkipTraceWaivedFor({
    userEmail: 'quatrocone@gmail.com',
    workspaceOwnerEmail: 'jordan@greatplainsinterests.com',
  }),
  true,
)
assert.equal(
  isSkipTraceWaivedFor({
    userEmail: 'member@acme.com',
    workspaceOwnerEmail: 'admin@acme.com',
  }),
  false,
)
assert.equal(
  isSkipTraceWaivedFor({ userEmail: 'management@mineralmapllc.com' }),
  true,
)

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
