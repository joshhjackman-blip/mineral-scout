import assert from 'node:assert/strict'
import { mergeSkipTraceCache } from './skip-trace-cache'

const owners = [
  { owner_name: 'BOYLES DRUE RITA FRENCH', abstract: 'A-1' },
  { owner_name: 'boyles drue rita french', abstract: 'A-99' },
  { owner_name: 'UNKNOWN LLC', abstract: 'A-2' },
]

const merged = mergeSkipTraceCache(owners, [
  {
    owner_name: 'BOYLES DRUE RITA FRENCH',
    phones: ['4325550100', '4325550100', ' 4325550199 '],
    emails: ['drue@example.com'],
  },
])

assert.equal(merged[0].phone, '4325550100')
assert.deepEqual(merged[0].phones, ['4325550100', '4325550199'])
assert.equal(merged[0].email, 'drue@example.com')
assert.equal(merged[0].abstract, 'A-1')

assert.equal(
  merged[1].phone,
  '4325550100',
  'same owner on another tract reuses the cache by name, case-insensitive',
)
assert.equal(merged[2].phone, null)
assert.deepEqual(merged[2].phones, [])

console.log('skip-trace-cache tests passed')
