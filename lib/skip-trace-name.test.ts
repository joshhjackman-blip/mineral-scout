import assert from 'node:assert/strict'
import {
  buildIdicoreSearchPlan,
  enrichPersonTraceArgs,
  entitySearchQueries,
  isBusinessOwner,
  parseTaxRollOwner,
  parseWesternPersonName,
  personCandidatesFromTaxRoll,
  scoreEntityNameMatch,
} from './skip-trace-name'

const alenick = parseTaxRollOwner('ALENICK MONROE E')
assert.equal(alenick.kind, 'person')
assert.equal(alenick.lastName, 'ALENICK')
assert.equal(alenick.firstName, 'MONROE E')
assert.deepEqual(
  personCandidatesFromTaxRoll('ALENICK MONROE E').map((c) => `${c.firstName}|${c.lastName}`),
  ['MONROE E|ALENICK', 'MONROE|ALENICK'],
)
assert.deepEqual(
  personCandidatesFromTaxRoll('ANDERSON JIMMIE L & MARILYN').map(
    (c) => `${c.firstName}|${c.lastName}`,
  ),
  ['JIMMIE L|ANDERSON', 'JIMMIE|ANDERSON', 'MARILYN|ANDERSON'],
)
assert.deepEqual(
  personCandidatesFromTaxRoll('BAUER HOLLY M').map((c) => `${c.firstName}|${c.lastName}`),
  ['HOLLY M|BAUER', 'HOLLY|BAUER'],
)
assert.deepEqual(
  personCandidatesFromTaxRoll('ANDERSON MARK ALLEN').map(
    (c) => `${c.firstName}|${c.lastName}`,
  ),
  ['MARK ALLEN|ANDERSON', 'MARK|ANDERSON'],
)

const trustee = parseTaxRollOwner('BROWN JESSEE M TRSTEE')
assert.equal(trustee.kind, 'trust')
assert.equal(trustee.lastName, 'BROWN')
assert.equal(trustee.firstName, 'JESSEE M')

const living = parseTaxRollOwner('FOSTER MICHAEL DAVID LVG TR')
assert.equal(living.kind, 'trust')
assert.equal(living.lastName, 'FOSTER')
assert.equal(living.firstName, 'MICHAEL DAVID')

const snp = parseTaxRollOwner('AYCOCK JUDITH ANN SNP')
assert.equal(snp.kind, 'person')
assert.equal(snp.firstName, 'JUDITH ANN')
assert.equal(snp.lastName, 'AYCOCK')

const elaine = parseTaxRollOwner('BARNES V ELAINE')
assert.equal(elaine.kind, 'person')
assert.equal(elaine.firstName, 'V ELAINE')
assert.equal(elaine.lastName, 'BARNES')

const brad = parseTaxRollOwner('ALLEN J BRAD')
assert.equal(brad.firstName, 'J BRAD')
assert.equal(brad.lastName, 'ALLEN')

const jr = parseTaxRollOwner('ANGELO ERNEST JR')
assert.equal(jr.kind, 'person')
assert.equal(jr.firstName, 'ERNEST')
assert.equal(jr.lastName, 'ANGELO')

const ely = parseTaxRollOwner('ELY JAMES E REV TRUST')
assert.equal(ely.kind, 'trust')
assert.equal(ely.lastName, 'ELY')
assert.equal(ely.firstName, 'JAMES E')

const family = parseTaxRollOwner('MORROW FAMILY REV LIVING TRUST')
assert.equal(family.kind, 'trust')
assert.equal(family.lastName, 'MORROW')
assert.equal(family.firstName, null)

const coats = parseTaxRollOwner('COATS SIGRID MARTIN TRUST')
assert.equal(coats.kind, 'trust')
assert.equal(coats.firstName, 'SIGRID MARTIN')

assert.equal(parseTaxRollOwner('BROWN ROYALTIES INC').kind, 'business')
assert.equal(parseTaxRollOwner('COLLINS OIL & GAS LTD').kind, 'business')
assert.equal(parseTaxRollOwner('BEDLAM INVESTMENTS LLC').kind, 'business')
assert.equal(parseTaxRollOwner('WATCH TOWER BIBLE TRACT').kind, 'business')
assert.equal(parseTaxRollOwner('DAVIS & HAYNES INVESTMENTS').kind, 'business')
assert.equal(parseTaxRollOwner('CHARIS EXPLORATION').kind, 'business')
assert.equal(parseTaxRollOwner('MONGER MANAGEMENT LLC DBA').kind, 'business')
assert.equal(isBusinessOwner('BROWN JESSEE M TRSTEE'), false)
assert.equal(isBusinessOwner('FOSTER MICHAEL DAVID LVG TR'), false)

const enriched = enrichPersonTraceArgs({
  ownerName: 'BARNES V ELAINE',
  firstName: 'V',
  lastName: 'BARNES',
  zip: '76116-9999',
})
assert.equal(enriched.firstName, 'V ELAINE')
assert.equal(enriched.lastName, 'BARNES')
assert.equal(enriched.zip, '76116')

const jointEnriched = enrichPersonTraceArgs({
  ownerName: 'ANDERSON JIMMIE L & MARILYN',
  firstName: 'JIMMIE',
  lastName: 'ANDERSON',
})
assert.equal(jointEnriched.firstName, 'JIMMIE L')
assert.equal(jointEnriched.lastName, 'ANDERSON')

const officer = parseWesternPersonName('MARSHALL EVANS BROWN')
assert.equal(officer?.firstName, 'MARSHALL EVANS')
assert.equal(officer?.lastName, 'BROWN')
assert.equal(parseWesternPersonName('COLLINS AMERICAN CAPITAL CORP.'), null)
assert.equal(parseWesternPersonName('D GREGORY BARBUTTI')?.firstName, 'D GREGORY')

const queries = entitySearchQueries('COLLINS OIL & GAS LTD')
assert.ok(queries.includes('COLLINS OIL GAS'))
assert.ok(scoreEntityNameMatch('COLLINS OIL GAS', 'COLLINS OIL AND GAS, LTD.') >= 70)
assert.ok(
  scoreEntityNameMatch('BROWN ROYALTIES', 'BROWN ROYALTIES') >
    scoreEntityNameMatch('BROWN ROYALTIES', 'BROWN FAMILY ROYALTIES LLC'),
)

const bauerPlan = buildIdicoreSearchPlan({
  ownerName: 'BAUER HOLLY M',
  firstName: 'HOLLY M',
  lastName: 'BAUER',
  address: 'PO BOX 1790',
  city: 'RANCHO SANTA FE',
  state: 'CA',
  zip: '92067',
  expandNameCandidates: true,
})
assert.deepEqual(
  bauerPlan.map((row) => `${row.label}:${row.firstName}|${row.lastName}|${row.address}`),
  [
    'drop-bad-street/tax-roll-full:HOLLY M|BAUER|',
    'drop-bad-street/tax-roll-first:HOLLY|BAUER|',
  ],
)

const markPlan = buildIdicoreSearchPlan({
  ownerName: 'ANDERSON MARK ALLEN',
  firstName: 'MARK ALLEN',
  lastName: 'ANDERSON',
  address: '123 MAIN ST',
  city: 'PUEBLO',
  state: 'CO',
  zip: '81001',
  expandNameCandidates: true,
})
assert.deepEqual(
  markPlan.map((row) => `${row.label}:${row.firstName}|${row.address}`),
  [
    'full/tax-roll-full:MARK ALLEN|123 MAIN ST',
    'full/tax-roll-first:MARK|123 MAIN ST',
    'name-city-zip/tax-roll-full:MARK ALLEN|',
    'name-city-zip/tax-roll-first:MARK|',
  ],
)

const jointPlan = buildIdicoreSearchPlan({
  ownerName: 'ANDERSON JIMMIE L & MARILYN',
  firstName: 'JIMMIE L',
  lastName: 'ANDERSON',
  address: 'PO BOX 12',
  city: 'PUEBLO',
  state: 'CO',
  expandNameCandidates: true,
})
assert.deepEqual(
  jointPlan.map((row) => `${row.firstName}|${row.lastName}`),
  ['JIMMIE L|ANDERSON', 'JIMMIE|ANDERSON', 'MARILYN|ANDERSON'],
)

const researchPlan = buildIdicoreSearchPlan({
  ownerName: 'ALENICK MONROE E',
  firstName: 'MONROE E',
  lastName: 'ALENICK',
  address: '1 MAIN',
})
assert.deepEqual(
  researchPlan.map((row) => `${row.label}:${row.firstName}`),
  ['full/incoming:MONROE E', 'name-city-zip/incoming:MONROE E'],
)

console.log('skip-trace-name tests passed')
