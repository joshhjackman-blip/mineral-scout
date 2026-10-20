import assert from 'node:assert/strict'
import {
  parseQuotaProvider,
  providerLabel,
  providerQuota,
  quotaCandidateAllowed,
  quotaMonth,
  remainingQuota,
} from './skip-trace-quota'
import {
  clampQuotaTarget,
  quotaTargetPresets,
  quotaTargetStep,
} from './skip-trace-quota-target'

assert.equal(quotaMonth(new Date('2026-10-20T00:00:00.000Z')), '2026-10')
assert.equal(quotaMonth(new Date('2026-01-01T00:00:00.000Z')), '2026-01')

assert.equal(remainingQuota(12500, 100), 12400)
assert.equal(remainingQuota(3333, 4000), 0)
assert.equal(remainingQuota(3333, -5), 3333)

assert.equal(clampQuotaTarget(10660, null), 10660)
assert.equal(clampQuotaTarget(10660, 500), 500)
assert.equal(clampQuotaTarget(10660, 50000), 10660)
assert.equal(clampQuotaTarget(10660, 0), 1)
assert.equal(clampQuotaTarget(0, 100), 0)
assert.equal(quotaTargetStep(10660), 50)
assert.deepEqual(quotaTargetPresets(3333), [250, 500, 1000, 2500, 3333])

assert.equal(parseQuotaProvider('idicore'), 'idicore')
assert.equal(parseQuotaProvider('AccurateAppend'), 'accurateappend')
assert.equal(parseQuotaProvider('batchdata'), null)

assert.equal(providerLabel('idicore'), 'idiCORE')
assert.equal(providerLabel('accurateappend'), 'Accurate Append')

const prevIdicore = process.env.IDICORE_MONTHLY_QUOTA
const prevAccurate = process.env.ACCURATE_APPEND_MONTHLY_QUOTA
delete process.env.IDICORE_MONTHLY_QUOTA
delete process.env.ACCURATE_APPEND_MONTHLY_QUOTA
assert.equal(providerQuota('idicore'), 12500)
assert.equal(providerQuota('accurateappend'), 3333)
assert.equal(providerQuota('batchdata'), 0)
if (prevIdicore === undefined) delete process.env.IDICORE_MONTHLY_QUOTA
else process.env.IDICORE_MONTHLY_QUOTA = prevIdicore
if (prevAccurate === undefined) delete process.env.ACCURATE_APPEND_MONTHLY_QUOTA
else process.env.ACCURATE_APPEND_MONTHLY_QUOTA = prevAccurate

assert.equal(
  quotaCandidateAllowed('idicore', {
    ownerName: 'FOSTER MICHAEL DAVID',
    address: '1 Main',
    city: 'Midland',
  }),
  true,
)
assert.equal(
  quotaCandidateAllowed('idicore', {
    ownerName: 'BROWN ROYALTIES INC',
    address: '1 Main',
    city: 'Midland',
  }),
  false,
  'idiCORE person search should skip companies',
)
assert.equal(
  quotaCandidateAllowed('accurateappend', {
    ownerName: 'BROWN ROYALTIES INC',
    address: '1 Main',
    city: 'Midland',
  }),
  true,
  'Accurate Append can burn leftover credits on businesses',
)
assert.equal(
  quotaCandidateAllowed('idicore', {
    ownerName: 'SMITH',
    address: '1 Main',
    city: 'Midland',
  }),
  false,
)
assert.equal(
  quotaCandidateAllowed('idicore', {
    ownerName: 'FOSTER MICHAEL DAVID',
    address: '',
    city: '',
  }),
  false,
)

console.log('skip-trace-quota tests passed')
