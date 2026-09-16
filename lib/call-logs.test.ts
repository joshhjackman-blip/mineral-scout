import assert from 'node:assert/strict'
import {
  callLogDisplayLabel,
  designationLabel,
  isCallLogDesignation,
  joinCallLogDateTime,
  parseCallLogRows,
  splitCallLogDateTime,
} from './call-logs'

assert.equal(designationLabel('offer_declined'), 'Offer declined')
assert.equal(designationLabel('already_sold'), 'Already sold')
assert.equal(isCallLogDesignation('offer_declined'), true)
assert.equal(isCallLogDesignation('no_answer'), false)

const { date, time } = splitCallLogDateTime('2026-09-16T18:05:00.000Z')
assert.match(date, /^\d{4}-\d{2}-\d{2}$/)
assert.match(time, /^\d{2}:\d{2}$/)
const joined = joinCallLogDateTime('2026-09-16', '13:04')
assert.equal(new Date(joined).getFullYear(), 2026)

assert.equal(callLogDisplayLabel({ designation: 'already_sold', outcome: 'connected' }), 'Already sold')
assert.equal(callLogDisplayLabel({ designation: null, outcome: 'voicemail' }), 'Voicemail')
assert.equal(callLogDisplayLabel({ designation: null, outcome: 'logged' }), 'Call logged')

const parsed = parseCallLogRows([
  {
    id: 'a',
    called_at: '2026-09-16T18:00:00.000Z',
    designation: 'offer_declined',
    notes: 'Asked us to stand down',
    outcome: 'connected',
    phone_display: '4325550144',
    called_by_name: 'Josh',
  },
  { id: 'b', called_at: '2026-09-15T12:00:00.000Z', designation: null, notes: '  ', outcome: 'no_answer' },
])
assert.equal(parsed[0]?.id, 'a')
assert.equal(parsed[1]?.notes, null)

console.log('call-logs tests passed')
