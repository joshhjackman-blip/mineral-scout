import assert from 'node:assert/strict'
import { getDealCounty, parseCountyField } from './crm-utils'

assert.equal(parseCountyField('glasscock'), 'glasscock')
assert.equal(parseCountyField('Glasscock County'), 'glasscock')
assert.equal(parseCountyField('Glasscock County, TX'), 'glasscock')
assert.equal(parseCountyField('  Pecos County, TX  '), 'pecos')
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

console.log('crm-utils tests passed')
