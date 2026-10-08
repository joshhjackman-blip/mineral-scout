import assert from 'node:assert/strict'
import {
  classifyIdicoreHost,
  clientIdLooksLikeTest,
  inspectIdicoreEnv,
} from './idicore-wiring'

assert.equal(classifyIdicoreHost(null), 'unset')
assert.equal(classifyIdicoreHost('login-api-test.idicore.com'), 'test')
assert.equal(classifyIdicoreHost('api-test.idicore.com'), 'test')
assert.equal(classifyIdicoreHost('login-api.idicore.com'), 'production')
assert.equal(classifyIdicoreHost('api.idicore.com'), 'production')
assert.equal(classifyIdicoreHost('example.com'), 'unknown')

assert.equal(clientIdLooksLikeTest('api-client@brentwoodellc_test'), true)
assert.equal(clientIdLooksLikeTest('api-client@brentwoodellc'), false)

const testEnv = inspectIdicoreEnv({
  IDICORE_AUTH_URL: 'https://login-api-test.idicore.com/apiclient',
  IDICORE_SEARCH_URL: 'https://api-test.idicore.com/search/MineralMap',
  IDICORE_CLIENT_ID: 'api-client@brentwoodellc_test',
  IDICORE_CLIENT_SECRET: 'secret',
  IDICORE_PROXY_URL: 'https://user:pass@us-east-shield-02.quotaguard.com:9294',
})
assert.equal(testEnv.environment, 'test')
assert.equal(testEnv.readyForPaidQuota, false)
assert.ok(testEnv.issues.some((issue) => issue.includes('12,500')))
assert.ok(testEnv.issues.some((issue) => issue.includes('_test')))

const prodEnv = inspectIdicoreEnv({
  IDICORE_AUTH_URL: 'https://login-api.idicore.com/apiclient',
  IDICORE_SEARCH_URL: 'https://api.idicore.com/search/MineralMap',
  IDICORE_CLIENT_ID: 'api-client@brentwoodellc',
  IDICORE_CLIENT_SECRET: 'secret',
  IDICORE_PROXY_URL: 'https://user:pass@us-east-shield-02.quotaguard.com:9294',
})
assert.equal(prodEnv.environment, 'production')
assert.equal(prodEnv.readyForPaidQuota, true)
assert.deepEqual(prodEnv.issues, [])
assert.equal(prodEnv.authHost, 'login-api.idicore.com')
assert.equal(prodEnv.searchHost, 'api.idicore.com')

const mixed = inspectIdicoreEnv({
  IDICORE_AUTH_URL: 'https://login-api.idicore.com/apiclient',
  IDICORE_SEARCH_URL: 'https://api-test.idicore.com/search/MineralMap',
  IDICORE_CLIENT_ID: 'api-client@brentwoodellc',
  IDICORE_CLIENT_SECRET: 'secret',
  IDICORE_PROXY_URL: 'https://proxy.example:9294',
})
assert.equal(mixed.environment, 'mixed')
assert.equal(mixed.readyForPaidQuota, false)

console.log('idicore-wiring tests passed')
