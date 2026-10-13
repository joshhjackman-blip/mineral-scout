import assert from 'node:assert/strict'
import { isFastResearchExhausted } from './skip-trace-research'
import {
  deterministicDeepCandidates,
  identityKey,
  isUntraceableOwner,
  parseDeepAttempts,
  triedIdentityKeys,
} from './skip-trace-deep-names'
import { pickReviewsForDeepResearch } from './skip-trace-deep-research'

assert.equal(isUntraceableOwner('UNKNOWN - LSE 3107'), true)
assert.equal(isUntraceableOwner('LSE 3107'), true)
assert.equal(isUntraceableOwner('HERD JH'), false)
assert.equal(isUntraceableOwner('FAEE ENTERPRISES'), false)

const dyerNotes =
  '[research 2026-10-12T00:00:00.000Z attempt=3 hit=0] tried tax-roll-full:MATHEW D DYER | tax-roll-first:MATHEW DYER; no phone'
const dyer = deterministicDeepCandidates('DYER MATHEW D', dyerNotes)
assert.ok(dyer.some((c) => c.firstName === 'MATTHEW D' && c.lastName === 'DYER'))
assert.ok(dyer.some((c) => c.firstName === 'MATTHEW' && c.lastName === 'DYER'))
assert.equal(
  dyer.some((c) => identityKey(c.firstName, c.lastName) === 'MATHEW D|DYER'),
  false,
)

const caroling = deterministicDeepCandidates(
  'DANNENBAUM CAROLING HEAD',
  'tried tax-roll-full:CAROLING HEAD DANNENBAUM | tax-roll-first:CAROLING DANNENBAUM; no phone',
)
assert.ok(caroling.some((c) => c.firstName.includes('CAROLINE') && c.lastName === 'DANNENBAUM'))

const maiden = deterministicDeepCandidates(
  'BARRY LESLIE ANNE PACE',
  'tried tax-roll-full:LESLIE ANNE PACE BARRY | tax-roll-first:LESLIE BARRY; no phone',
)
assert.ok(maiden.some((c) => c.lastName === 'PACE' && c.firstName.startsWith('LESLIE')))

const snyder = deterministicDeepCandidates(
  'CHESNUTT MARY L SNYDER REV TR',
  'tried tax-roll-full:MARY L SNYDER CHESNUTT | tax-roll-first:MARY CHESNUTT; no phone',
)
assert.ok(snyder.some((c) => c.lastName === 'SNYDER'))

const initials = deterministicDeepCandidates(
  'HERD JH',
  'tried tax-roll-full:JH HERD; no phone',
)
assert.deepEqual(initials, [])

assert.deepEqual(deterministicDeepCandidates('UNKNOWN - LSE 3107'), [])
assert.equal(
  deterministicDeepCandidates(
    'BOUCHARD MARY ELIZABETH',
    'tried tax-roll-full:MARY ELIZABETH BOUCHARD; no phone',
  ).some((c) => c.lastName === 'ELIZABETH'),
  false,
)

const tried = triedIdentityKeys(dyerNotes)
assert.ok(tried.has('MATHEW D|DYER'))
assert.ok(tried.has('MATHEW|DYER'))

const deepParsed = parseDeepAttempts(
  '[deep-research 2026-10-13T12:00:00.000Z attempt=1 exhausted=1 hit=0] no new identities',
)
assert.equal(deepParsed.attempts, 1)
assert.equal(deepParsed.exhausted, true)

const exhaustedNotes =
  '[research 2026-01-01T00:00:00.000Z attempt=3] tried tax-roll-full:MATHEW D DYER; no phone'
assert.equal(
  isFastResearchExhausted({ owner_name: 'DYER MATHEW D', notes: exhaustedNotes }),
  true,
)

const picked = pickReviewsForDeepResearch(
  [
    {
      owner_name: 'DYER MATHEW D',
      notes: exhaustedNotes,
      created_at: '2026-10-11T00:00:00.000Z',
    },
    {
      owner_name: 'STILL FRESH',
      notes: '[research 2026-10-13T00:00:00.000Z attempt=1] no phone',
      created_at: '2026-10-13T00:00:00.000Z',
    },
    {
      owner_name: 'ALREADY DEEP',
      notes: `${exhaustedNotes}\n[deep-research 2026-10-13T00:00:00.000Z attempt=1 exhausted=1 hit=0] done`,
      created_at: '2026-10-10T00:00:00.000Z',
    },
  ],
  { limit: 10, now: Date.parse('2026-10-13T12:00:00.000Z') },
)
assert.equal(picked.length, 1)
assert.equal(picked[0].owner_name, 'DYER MATHEW D')

console.log('skip-trace-deep-names tests passed')
