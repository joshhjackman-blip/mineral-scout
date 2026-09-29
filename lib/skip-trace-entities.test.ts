import assert from 'node:assert/strict'
import {
  peopleFromFtasDetail,
  corporateOfficerNames,
  corporateOfficersToRecurse,
  gpSearchQueries,
  isGpTitle,
  looksLikeLimitedPartnership,
  unwrapFtasPeople,
} from './skip-trace-entities'

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

assert.equal(isGpTitle('GENERAL PA'), true)
assert.equal(isGpTitle('GENERAL PARTNER'), true)
assert.equal(isGpTitle('MEMBER'), false)
assert.equal(looksLikeLimitedPartnership('BLUE SKY PROPERTIES, LP'), true)
assert.ok(gpSearchQueries('BLUE SKY PROPERTIES, LP').some((q) => q.includes('GP')))

const blueSkyGp = corporateOfficersToRecurse({
  name: 'BLUE SKY PROPERTIES, LP',
  officerInfo: [
    { AGNT_NM: 'PROUGH AVIATION, LLC', AGNT_TITL_TX: 'GENERAL PA' },
    { AGNT_NM: 'OTHER HOLDINGS LLC', AGNT_TITL_TX: 'MEMBER' },
  ],
})
assert.equal(blueSkyGp[0].name, 'PROUGH AVIATION, LLC')
assert.equal(blueSkyGp[0].title, 'GENERAL PA')

const catalog: Record<string, Parameters<typeof unwrapFtasPeople>[0]> = {
  'PROUGH AVIATION, LLC': {
    name: 'PROUGH AVIATION, LLC',
    taxpayerId: '32001677338',
    registeredAgentName: 'ROBERT J PROUGH',
    officerInfo: [
      { AGNT_NM: 'DEBRA J PROUGH', AGNT_TITL_TX: 'MEMBER' },
      { AGNT_NM: 'ROBERT J PROUGH', AGNT_TITL_TX: 'MEMBER' },
    ],
  },
  'NESTED GP LLC': {
    name: 'NESTED GP LLC',
    taxpayerId: '2',
    officerInfo: [{ AGNT_NM: 'INNER HOLDINGS LLC', AGNT_TITL_TX: 'GENERAL PA' }],
  },
  'INNER HOLDINGS LLC': {
    name: 'INNER HOLDINGS LLC',
    taxpayerId: '3',
    officerInfo: [{ AGNT_NM: 'JANE Q PUBLIC', AGNT_TITL_TX: 'MANAGER' }],
  },
}

async function lookup(name: string) {
  const needle = name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
  for (const [key, detail] of Object.entries(catalog)) {
    const hay = key.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
    if (needle === hay || needle.includes(hay) || hay.includes(needle)) return detail
  }
  return null
}

async function runAsyncCases() {
  const blueSkyPeople = await unwrapFtasPeople(
    {
      name: 'BLUE SKY PROPERTIES, LP',
      taxpayerId: '17528451630',
      registeredAgentName: 'ROBERT J PROUGH',
      officerInfo: [{ AGNT_NM: 'PROUGH AVIATION, LLC', AGNT_TITL_TX: 'GENERAL PA' }],
    },
    { lookup },
  )
  assert.ok(blueSkyPeople.some((p) => p.lastName === 'PROUGH' && p.firstName === 'DEBRA J'))
  assert.ok(blueSkyPeople.some((p) => p.title?.includes('GP') && p.lastName === 'PROUGH'))

  const twoHop = await unwrapFtasPeople(
    {
      name: 'STACKED MINERALS LP',
      taxpayerId: '1',
      officerInfo: [{ AGNT_NM: 'NESTED GP LLC', AGNT_TITL_TX: 'GENERAL PA' }],
    },
    { lookup },
  )
  assert.equal(twoHop.some((p) => p.lastName === 'PUBLIC' && p.firstName === 'JANE Q'), true)
  assert.ok(twoHop[0].title?.includes('GP'))

  const cycleLookups: string[] = []
  const cyclePeople = await unwrapFtasPeople(
    {
      name: 'LOOP A LLC',
      taxpayerId: 'a',
      officerInfo: [{ AGNT_NM: 'LOOP B LLC', AGNT_TITL_TX: 'GENERAL PA' }],
    },
    {
      lookup: async (name) => {
        cycleLookups.push(name)
        if (name.includes('LOOP B')) {
          return {
            name: 'LOOP B LLC',
            taxpayerId: 'b',
            officerInfo: [{ AGNT_NM: 'LOOP A LLC', AGNT_TITL_TX: 'GENERAL PA' }],
          }
        }
        return null
      },
    },
  )
  assert.ok(cycleLookups.length <= 2)
  assert.equal(cyclePeople.length, 0)
}

void runAsyncCases()
  .then(() => {
    console.log('skip-trace-entities tests passed')
  })
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
