import assert from 'node:assert/strict'
import {
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

console.log('skip-trace-name tests passed')
