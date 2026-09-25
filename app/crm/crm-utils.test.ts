import assert from 'node:assert/strict'
import { dealMatchesQuery, getDealCounty, parseCountyField } from './crm-utils'

assert.equal(parseCountyField('glasscock'), 'glasscock')
assert.equal(parseCountyField('Glasscock County'), 'glasscock')
assert.equal(parseCountyField('Glasscock County, TX'), 'glasscock')
assert.equal(parseCountyField('  Pecos County, TX  '), 'pecos')
assert.equal(parseCountyField('Crane County, TX'), 'crane')
assert.equal(parseCountyField(null), null)
assert.equal(parseCountyField('not-a-county'), null)

assert.equal(
  getDealCounty({ id: '1', owner_name: 'ROSE MELINDA ANNE', county: 'Glasscock County, TX', operator_name: 'DIAMONDBACK E&P LLC' }),
  'glasscock',
)
assert.equal(
  getDealCounty({ id: '2', owner_name: 'Test', county: 'howard' }),
  'howard',
)

assert.equal(dealMatchesQuery(
  { id: '3', owner_name: 'ADAMS JOSEPHINE LUCILLE', operator_name: 'DIAMONDBACK' },
  'Josephine Adams',
), true)
assert.equal(dealMatchesQuery(
  { id: '3', owner_name: 'ADAMS JOSEPHINE LUCILLE' },
  'Adams Josephine',
), true)
assert.equal(dealMatchesQuery(
  { id: '3', owner_name: 'ADAMS JOSEPHINE LUCILLE' },
  'Josephine Smith',
), false)

console.log('crm-utils tests passed')
