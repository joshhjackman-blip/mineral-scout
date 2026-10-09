import assert from 'node:assert/strict'
import {
  parseResearchAttempts,
  personTargetsFromReview,
  shouldSkipResearch,
} from './skip-trace-research'
import {
  formatResearchHitNote,
  methodLabel,
  parseLatestResearchLine,
  providerLabel,
  summarizeResearchReviews,
} from './skip-trace-research-stats'
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

const joint = personTargetsFromReview(
  review({
    owner_name: 'ANDERSON JIMMIE L & MARILYN',
    first_name: 'JIMMIE',
    last_name: 'ANDERSON',
  }),
)
assert.deepEqual(
  joint.map((t) => `${t.firstName}|${t.lastName}`),
  ['JIMMIE L|ANDERSON', 'JIMMIE|ANDERSON', 'MARILYN|ANDERSON'],
)

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

const llcNeedsGpHop = shouldSkipResearch(
  review({
    owner_name: 'BLUE SKY PROPERTIES LP',
    notes:
      '[research 2026-01-01T00:00:00.000Z attempt=3] tried officer:REGISTERED AGENT:ROBERT J PROUGH; no phone',
  }),
  Date.parse('2026-01-01T01:00:00.000Z'),
)
assert.equal(llcNeedsGpHop.skip, false)

const llcAlreadyUnwrappedGp = shouldSkipResearch(
  review({
    owner_name: 'BLUE SKY PROPERTIES LP',
    notes:
      '[research 2026-01-01T00:00:00.000Z attempt=3] tried officer:GP>MEMBER:DEBRA J PROUGH; no phone',
  }),
  Date.parse('2026-09-01T00:00:00.000Z'),
)
assert.equal(llcAlreadyUnwrappedGp.skip, true)

const ready = shouldSkipResearch(review({ notes: null }), Date.now())
assert.equal(ready.skip, false)

const hitNote = formatResearchHitNote({
  attempt: 1,
  provider: 'idicore',
  method: 'officer:PRESIDENT',
  person: 'MARSHALL EVANS BROWN',
  phones: ['3255550199'],
  tried: ['officer:PRESIDENT:MARSHALL EVANS BROWN'],
})
const hitParsed = parseLatestResearchLine(hitNote)
assert.equal(hitParsed?.hit, true)
assert.equal(hitParsed?.provider, 'idicore')
assert.equal(hitParsed?.method, 'officer:PRESIDENT')
assert.equal(hitParsed?.person, 'MARSHALL EVANS BROWN')
assert.equal(methodLabel('joint-spouse'), 'Joint spouse')
assert.equal(methodLabel('officer:PRESIDENT'), 'TX officer · PRESIDENT')
assert.equal(methodLabel('officer:GP>MEMBER'), 'TX GP · MEMBER')
assert.equal(methodLabel('officer:GP>GP>MANAGER'), 'TX GP · MANAGER')
assert.equal(providerLabel('research-idicore'), 'idiCORE')

const missNote =
  '[research 2026-09-28T12:00:00.000Z attempt=1 hit=0] tried tax-roll-full:MONROE E ALENICK; no phone'
const missParsed = parseLatestResearchLine(missNote)
assert.equal(missParsed?.hit, false)

const stats = summarizeResearchReviews(
  [review({ notes: missNote })],
  [
    review({
      id: 'hit-1',
      owner_name: 'BROWN ROYALTIES INC',
      phones: ['3255550199'],
      status: 'resolved',
      notes: hitNote,
      resolved_at: '2026-09-28T21:00:00.000Z',
    }),
  ],
  Date.parse('2026-09-28T22:00:00.000Z'),
)
assert.equal(stats.hits, 1)
assert.equal(stats.hitsToday, 1)
assert.equal(stats.recentHits[0].ownerName, 'BROWN ROYALTIES INC')
assert.ok(stats.byProvider.some((row) => row.name === 'idiCORE' && row.count === 1))
assert.ok(stats.byMethod.some((row) => row.name === 'TX officer · PRESIDENT' && row.count === 1))

console.log('skip-trace-research tests passed')
