import assert from 'node:assert/strict'
import { peopleFromFtasDetail, corporateOfficerNames } from './skip-trace-entities'

const brown = peopleFromFtasDetail({
  name: 'BROWN ROYALTIES',
  registeredAgentName: 'DEBORAH BROWN GRISSEN',
  registeredOfficeAddressStreet: '3152 EXECUTIVE DR',
  registeredOfficeAddressCity: 'SAN ANGELO',
  registeredOfficeAddressState: 'TX',
  registeredOfficeAddressZip: '76904',
  officerInfo: [
    { AGNT_NM: 'CAROLYN B WINSTON', AGNT_TITL_TX: 'DIRECTOR' },
    { AGNT_NM: 'MARSHALL EVANS BROWN', AGNT_TITL_TX: 'PRESIDENT', CITY_NM: 'SAN ANGELO', ST_CD: 'TX', AD_ZP: '76902' },
    { AGNT_NM: 'DEBORAH B GRISSEN', AGNT_TITL_TX: 'VP' },
  ],
})
assert.equal(brown[0].firstName, 'MARSHALL EVANS')
assert.equal(brown[0].lastName, 'BROWN')
assert.equal(brown[0].title, 'PRESIDENT')
assert.ok(brown.some((p) => p.lastName === 'GRISSEN'))

const collins = peopleFromFtasDetail({
  name: 'COLLINS OIL AND GAS, LTD.',
  registeredAgentName: 'DOROTHY DANN COLLINS',
  officerInfo: [{ AGNT_NM: 'COLLINS AMERICAN CAPITAL CORP.', AGNT_TITL_TX: 'GENERAL PA' }],
})
assert.equal(collins.length, 1)
assert.equal(collins[0].firstName, 'DOROTHY DANN')
assert.equal(collins[0].lastName, 'COLLINS')
assert.deepEqual(corporateOfficerNames({
  officerInfo: [{ AGNT_NM: 'COLLINS AMERICAN CAPITAL CORP.', AGNT_TITL_TX: 'GENERAL PA' }],
}), ['COLLINS AMERICAN CAPITAL CORP.'])

const csc = peopleFromFtasDetail({
  registeredAgentName: 'CORPORATION SERVICE COMPANY',
  officerInfo: [{ AGNT_NM: 'JANE Q PUBLIC', AGNT_TITL_TX: 'MEMBER' }],
})
assert.equal(csc.length, 1)
assert.equal(csc[0].lastName, 'PUBLIC')

console.log('skip-trace-entities tests passed')
