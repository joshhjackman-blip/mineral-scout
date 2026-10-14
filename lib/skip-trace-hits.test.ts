import assert from 'node:assert/strict'
import { formatResearchHitNote } from './skip-trace-research-stats'
import {
  formatHitPhone,
  reviewToFoundHit,
  unackedFoundHits,
} from './skip-trace-hits'

const hitNote = formatResearchHitNote({
  attempt: 1,
  provider: 'accurateappend',
  method: 'tax-roll-full',
  person: 'TOYA ELIZABETH HALL',
  phones: ['4322693179', '4327562784'],
  tried: ['tax-roll-full:TOYA ELIZABETH HALL'],
})

const recovered = reviewToFoundHit({
  id: 'rev-1',
  owner_name: 'HALL TOYA ELIZABETH',
  phones: ['4322693179', '4327562784'],
  emails: [],
  notes: hitNote,
  status: 'resolved',
  deal_id: 'deal-1',
  resolved_at: '2026-10-12T00:15:27.199Z',
  updated_at: '2026-10-12T00:15:27.199Z',
})
assert.equal(recovered?.ownerName, 'HALL TOYA ELIZABETH')
assert.equal(recovered?.phones[0], '4322693179')
assert.equal(recovered?.dealId, 'deal-1')

assert.equal(
  reviewToFoundHit({
    id: 'open',
    owner_name: 'STILL MISSING',
    phones: [],
    notes: '[research 2026-10-12T00:00:00.000Z attempt=1 hit=0] no phone',
    status: 'open',
    updated_at: '2026-10-12T00:00:00.000Z',
  }),
  null,
)

assert.equal(
  reviewToFoundHit({
    id: 'human',
    owner_name: 'TYPED IN',
    phones: ['4325550100'],
    notes: 'Owner typed this in',
    status: 'resolved',
    updated_at: '2026-10-12T00:00:00.000Z',
  }),
  null,
)

const list = unackedFoundHits(
  [
    {
      id: 'rev-1',
      owner_name: 'HALL TOYA ELIZABETH',
      phones: ['4322693179'],
      notes: hitNote,
      status: 'resolved',
      updated_at: '2026-10-12T00:15:27.199Z',
    },
    {
      id: 'rev-2',
      owner_name: 'HOVER JANIS B',
      phones: ['4325283544'],
      notes: hitNote.replace('TOYA ELIZABETH HALL', 'JANIS B HOVER'),
      status: 'resolved',
      updated_at: '2026-10-12T00:15:22.000Z',
    },
  ],
  ['rev-1'],
)
assert.equal(list.length, 1)
assert.equal(list[0].ownerName, 'HOVER JANIS B')

assert.equal(formatHitPhone('4322693179'), '(432) 269-3179')
assert.equal(formatHitPhone('(432) 269-3179'), '(432) 269-3179')

console.log('skip-trace-hits tests passed')
