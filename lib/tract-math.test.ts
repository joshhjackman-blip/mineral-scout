import assert from 'node:assert/strict'
import {
  DEFAULT_LEASE_ROYALTY,
  estimateGrossAcres,
  formatAcres,
  looksLikeRegularSection,
  mineralOwnerNriPct,
  netMineralAcres,
  parseAliquotFraction,
  SECTION_ACRES,
} from './tract-math'

assert.equal(parseAliquotFraction('N/2SW/4, SEC: 47, BLK: 39-T4S'), 0.125)
assert.equal(parseAliquotFraction('NE/4'), 0.25)
assert.equal(parseAliquotFraction('E/2'), 0.5)
assert.equal(parseAliquotFraction('SE/4 of SE/4'), 0.0625)
assert.equal(parseAliquotFraction('N/2 NE/4 and S/2 SE/4'), 0.25)
assert.equal(parseAliquotFraction('T2N BLK 35 SEC 1 A-65'), null)

assert.equal(
  looksLikeRegularSection({ legal: 'T2N BLK 35 SEC 1 A-65' }),
  true,
)
assert.equal(
  looksLikeRegularSection({ legal: 'COOK, W H A-160' }),
  false,
)
assert.equal(
  looksLikeRegularSection({ legal: 'LGE 4 CSL' }),
  false,
)

assert.deepEqual(
  estimateGrossAcres({ legal: 'T2N BLK 5 SEC 21 A-121' }),
  { acres: 640, source: 'section', estimated: true },
)
assert.deepEqual(
  estimateGrossAcres({ legal: 'N/2SW/4, SEC: 47, BLK: 39-T4S' }),
  { acres: 80, source: 'aliquot', estimated: true },
)
assert.deepEqual(
  estimateGrossAcres({ cadAcres: 442, legal: 'T2N BLK 35 SEC 1 A-65' }),
  { acres: 442, source: 'cad', estimated: false },
)
assert.deepEqual(
  estimateGrossAcres({ shapeAcres: 638.4, legal: 'T3N BLK 35 SEC 42 A-760' }),
  { acres: 640, source: 'section', estimated: true },
)
assert.equal(
  estimateGrossAcres({ legal: 'HAYS SURVEY A-12' }).acres,
  null,
)

assert.equal(netMineralAcres(640, 1.6666), 10.66624)
assert.equal(mineralOwnerNriPct(100), 12.5)
assert.equal(mineralOwnerNriPct(1.6666), 1.6666 * DEFAULT_LEASE_ROYALTY)
assert.equal(SECTION_ACRES, 640)
assert.equal(formatAcres(640), '640')
assert.equal(formatAcres(10.67), '10.7')

console.log('tract-math tests passed')
