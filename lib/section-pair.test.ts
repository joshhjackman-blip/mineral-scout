import assert from 'node:assert/strict'
import {
  blockVariants,
  pairedSectionFromLease,
  parseGridKey,
  sameBlockTownship,
} from './section-pair'

assert.deepEqual(parseGridKey('B37-T3S-S36'), {
  block: '37',
  township: 'T3S',
  section: '36',
})
assert.equal(parseGridKey('A-548'), null)

assert.equal(pairedSectionFromLease('MARION WEST 36-25 F', '36'), '25')
assert.equal(pairedSectionFromLease('MARION WEST 36-25 F', '25'), '36')
assert.equal(pairedSectionFromLease('SMITH 12H', '36'), null)

assert.equal(sameBlockTownship('37 T3S', '37-T3S'), true)
assert.equal(sameBlockTownship('37 T3S', '38 T3S'), false)
assert.equal(sameBlockTownship('37 T3S', '37 T1S'), false)
assert.ok(blockVariants('37 T3S').includes('37'))

console.log('section-pair tests passed')
