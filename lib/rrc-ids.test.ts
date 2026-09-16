import assert from 'node:assert/strict'
import { apiLookupVariants, leaseLookupVariants, normalizeApi } from './rrc-ids'

assert.equal(normalizeApi('42-329-48143'), '4232948143')
assert.ok(apiLookupVariants('32948143').includes('4232948143'))
assert.ok(apiLookupVariants('42-329-48143').includes('32948143'))
assert.deepEqual(leaseLookupVariants('008912900'), ['008912900', '8912900'])

console.log('rrc-ids tests passed')
