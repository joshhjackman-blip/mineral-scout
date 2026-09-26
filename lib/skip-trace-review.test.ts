import assert from 'node:assert/strict'
import {
  mergeContactLines,
  parseContactLines,
  reviewReasonLabel,
} from './skip-trace-review'

assert.deepEqual(parseContactLines('4325550198\n432-555-0100'), [
  '4325550198',
  '432-555-0100',
])
assert.deepEqual(mergeContactLines(['4325550198'], ['(432) 555-0198', '4325550100']), [
  '4325550198',
  '(432) 555-0198',
  '4325550100',
])
assert.equal(reviewReasonLabel('wrong_number'), 'Wrong #')
assert.equal(reviewReasonLabel('no_phone'), 'No phone')
assert.equal(reviewReasonLabel(null), 'No phone')

console.log('skip-trace-review.test.ts ok')
