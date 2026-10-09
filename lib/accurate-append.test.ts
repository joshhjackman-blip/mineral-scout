import assert from 'node:assert/strict'
import {
  accurateAppendPeople,
  accurateAppendStreet,
  classifyAccurateAppendProbe,
  redactAccurateAppendKey,
} from './accurate-append'

assert.deepEqual(classifyAccurateAppendProbe(401, 'License key is required'), {
  ok: false,
  error: 'License key is required',
})
assert.deepEqual(classifyAccurateAppendProbe(400, 'First name, last name required'), {
  ok: true,
  error: null,
})
assert.equal(classifyAccurateAppendProbe(200, null).ok, true)

assert.equal(
  redactAccurateAppendKey('/AppendPhone/Ads/abc-123/', 'abc-123'),
  '/AppendPhone/Ads/[KEY]/',
)

assert.equal(accurateAppendStreet('PO BOX 1790'), '')
assert.equal(accurateAppendStreet('123 MAIN ST'), '123 MAIN ST')

assert.deepEqual(
  accurateAppendPeople({
    ownerName: 'BAUER HOLLY M',
    firstName: 'HOLLY M',
    lastName: 'BAUER',
    expandNameCandidates: true,
  }).map((p) => `${p.firstName}|${p.lastName}`),
  ['HOLLY M|BAUER', 'HOLLY|BAUER'],
)

assert.deepEqual(
  accurateAppendPeople({
    ownerName: 'ANDERSON JIMMIE L & MARILYN',
    firstName: 'JIMMIE L',
    lastName: 'ANDERSON',
    expandNameCandidates: true,
  }).map((p) => `${p.firstName}|${p.lastName}`),
  ['JIMMIE L|ANDERSON', 'JIMMIE|ANDERSON', 'MARILYN|ANDERSON'],
)

console.log('accurate-append tests passed')
