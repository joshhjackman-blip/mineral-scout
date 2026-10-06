import assert from 'node:assert/strict'
import { hasPaidAccess, isSkipTraceWaivedFor } from './access'
import {
  SKIP_TRACE_PRICE_USD,
  billingMonthKey,
  estimateMonthlySkipTraceCost,
  isSkipTraceBillable,
  previousBillingMonthKey,
} from './billing'
import { isGreatPlainsMember, isSkipTraceCompedTeam } from './team'

assert.equal(SKIP_TRACE_PRICE_USD, 1)
assert.equal(hasPaidAccess({}, 'anyone@example.com'), true)

assert.equal(isSkipTraceCompedTeam('management@mineralmapllc.com'), true)
assert.equal(isSkipTraceCompedTeam('jordan@greatplainsinterestsllc.com'), true)
assert.equal(isSkipTraceCompedTeam('jordan@greatplainsinterests.com'), true)
assert.equal(isSkipTraceCompedTeam('JORDAN@GreatPlainsInterests.com'), true)
assert.equal(isSkipTraceCompedTeam('quatrocone@gmail.com'), false)
assert.equal(isSkipTraceCompedTeam('broker@example.com'), false)
assert.equal(isGreatPlainsMember('mtfminerals@gmail.com'), true)
assert.equal(isGreatPlainsMember('MTFMinerals@Gmail.com'), true)
assert.equal(isGreatPlainsMember('quatrocone@gmail.com'), false)
assert.equal(isSkipTraceCompedTeam('mtfminerals@gmail.com'), false)

assert.equal(
  isSkipTraceWaivedFor({
    userEmail: 'mtfminerals@gmail.com',
  }),
  true,
)
assert.equal(
  isSkipTraceWaivedFor({
    userEmail: 'MTFMinerals@gmail.com',
    workspaceOwnerEmail: 'jordan@greatplainsinterests.com',
  }),
  true,
)
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

assert.equal(billingMonthKey(new Date('2026-09-29T12:00:00Z')), '2026-09')
assert.equal(previousBillingMonthKey(new Date('2026-09-01T06:00:00Z')), '2026-08')
assert.equal(previousBillingMonthKey(new Date('2026-01-01T00:00:00Z')), '2025-12')

console.log('billing.test.ts ok')
