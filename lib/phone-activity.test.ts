import assert from 'node:assert/strict'
import {
  applyCallOutcome,
  formatLastCalled,
  hasPhone,
  parsePhoneActivity,
  phoneKey,
  waitingOnNumber,
  waitingOnNumberCopy,
} from './phone-activity'

assert.equal(phoneKey('(432) 555-0198'), '4325550198')
assert.equal(phoneKey('+14325550198'), '4325550198')

const first = applyCallOutcome({}, '4325550198', 'voicemail', {
  at: '2026-09-14T12:00:00.000Z',
  calledByName: 'Josh',
})
assert.equal(first.activity['4325550198']?.lastOutcome, 'voicemail')
assert.equal(first.connectedPhone, null)

const picked = applyCallOutcome(first.activity, '432-555-0100', 'connected', {
  at: '2026-09-14T13:00:00.000Z',
})
assert.equal(picked.connectedPhone, '4325550100')
assert.equal(picked.activity['4325550100']?.connected, true)
assert.equal(picked.activity['4325550198']?.connected, false)

const parsed = parsePhoneActivity(picked.activity)
assert.equal(parsed['4325550100']?.lastOutcome, 'connected')

assert.equal(hasPhone({ phone: null, phones: [] }), false)
assert.equal(hasPhone({ phone: '4325550198', phones: [] }), true)
assert.equal(waitingOnNumber({ tag: 'skip_traced', phone: null, phones: [] }), true)
assert.equal(waitingOnNumber({ tag: 'prospect', phone: null, phones: [] }), false)
assert.equal(waitingOnNumber({ needs_phone: true, phone: null, phones: [] }), true)
assert.equal(waitingOnNumber({ tag: 'skip_traced', phone: '4325550198' }), false)
assert.equal(waitingOnNumberCopy(1), '1 lead waiting on a number')
assert.equal(waitingOnNumberCopy(12), '12 leads waiting on a number')
assert.equal(formatLastCalled(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()), '2h ago')

console.log('phone-activity tests passed')
