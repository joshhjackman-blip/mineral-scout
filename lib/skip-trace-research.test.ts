import assert from 'node:assert/strict'
import {
  parseResearchAttempts,
  personTargetsFromReview,
  shouldSkipResearch,
} from './skip-trace-research'
import type { SkipTraceReview } from './skip-trace-review'

function review(partial: Partial<SkipTraceReview>): SkipTraceReview {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    owner_name: 'ALENICK MONROE E',
    owner_name_key: 'ALENICK MONROE E',
    first_name: 'MONROE',
    last_name: 'ALENICK',
    mailing_address: '1 MAIN',
    mailing_city: 'MIDLAND',
    mailing_state: 'TX',
    mailing_zip: '79701-1234',
    emails: [],
    phones: [],
    status: 'open',
    created_at: '2026-09-28T00:00:00.000Z',
    updated_at: '2026-09-28T00:00:00.000Z',
    ...partial,
  }
}

const alenick = personTargetsFromReview(review({}))
assert.equal(alenick[0].firstName, 'MONROE E')
assert.equal(alenick[0].lastName, 'ALENICK')
assert.equal(alenick[0].zip, '79701')

const foster = personTargetsFromReview(
  review({
    owner_name: 'FOSTER MICHAEL DAVID LVG TR',
    first_name: 'MICHAEL',
    last_name: 'FOSTER',
  }),
)
assert.equal(foster[0].firstName, 'MICHAEL DAVID')
assert.equal(foster[0].lastName, 'FOSTER')

const llc = personTargetsFromReview(
  review({
    owner_name: 'BROWN ROYALTIES INC',
    first_name: 'ROYALTIES',
    last_name: 'BROWN',
  }),
)
assert.deepEqual(llc, [])

const parsed = parseResearchAttempts(
  '[research 2026-09-28T12:00:00.000Z attempt=1] tried tax-roll-full:MONROE E ALENICK; no phone',
)
assert.equal(parsed.attempts, 1)
assert.ok(parsed.lastAt)

const recent = shouldSkipResearch(
  review({ notes: '[research 2099-01-01T00:00:00.000Z attempt=1] no phone' }),
  Date.parse('2099-01-01T01:00:00.000Z'),
)
assert.equal(recent.skip, true)

const exhausted = shouldSkipResearch(
  review({
    notes:
      '[research 2026-01-01T00:00:00.000Z attempt=3] no phone',
  }),
  Date.parse('2026-09-01T00:00:00.000Z'),
)
assert.equal(exhausted.skip, true)

const ready = shouldSkipResearch(review({ notes: null }), Date.now())
assert.equal(ready.skip, false)

console.log('skip-trace-research tests passed')
