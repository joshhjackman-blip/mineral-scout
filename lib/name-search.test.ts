import assert from 'node:assert/strict'
import {
  compareNameMatches,
  escapeIlike,
  nameMatchesQuery,
  nameMatchScore,
  tokenizeName,
} from './name-search'

assert.deepEqual(tokenizeName('ADAMS JOSEPHINE LUCILLE'), ['ADAMS', 'JOSEPHINE', 'LUCILLE'])
assert.deepEqual(tokenizeName('Josephine Adams'), ['JOSEPHINE', 'ADAMS'])
assert.deepEqual(tokenizeName('BEASLEY THEODORE & BEULAH'), ['BEASLEY', 'THEODORE', 'BEULAH'])
assert.deepEqual(tokenizeName('CARL/WHITE TRUST'), ['CARL', 'WHITE', 'TRUST'])

assert.equal(nameMatchesQuery('ADAMS JOSEPHINE LUCILLE', 'Josephine Adams'), true)
assert.equal(nameMatchesQuery('ADAMS JOSEPHINE LUCILLE', 'Adams Josephine'), true)
assert.equal(nameMatchesQuery('GROVES JILL SIDES', 'Jill Groves'), true)
assert.equal(nameMatchesQuery('HUNSAKER JULIE L SPL NDS TRST', 'Julie Hunsaker'), true)
assert.equal(nameMatchesQuery('LAWRENCE CHAD G', 'Chad Lawrence'), true)
assert.equal(nameMatchesQuery('ADAMS JOSEPHINE LUCILLE', 'Josephine Smith'), false)
assert.equal(nameMatchesQuery('CADDO MINERALS INC', 'Josephine Adams'), false)

const josephine = nameMatchScore('ADAMS JOSEPHINE LUCILLE', 'Josephine Adams')
const typedRoll = nameMatchScore('ADAMS JOSEPHINE LUCILLE', 'Adams Josephine')
const firstLastStored = nameMatchScore('JOSEPHINE ADAMS TRUST', 'Josephine Adams')
assert.ok(josephine > firstLastStored)
assert.ok(typedRoll > 0)

const ranked = [
  'JOSEPHINE ADAMS TRUST',
  'ADAMS JOSEPHINE LUCILLE',
  'SMITH JOSEPHINE ADAMS',
].sort((a, b) => compareNameMatches(a, b, 'Josephine Adams'))
assert.equal(ranked[0], 'ADAMS JOSEPHINE LUCILLE')

assert.equal(escapeIlike('SMITH_JOHN'), 'SMITH\\_JOHN')
assert.equal(escapeIlike('100%'), '100\\%')

console.log('name-search tests passed')
