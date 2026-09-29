import assert from 'node:assert/strict'
import {
  cleanSignupText,
  escapeHtml,
  hashSignupToken,
  isValidSignupEmail,
  signupOwnerNoticeHtml,
} from './signup-requests'

assert.equal(isValidSignupEmail('jane@firm.com'), true)
assert.equal(isValidSignupEmail('bad'), false)
assert.equal(cleanSignupText('  Jane   Broker  ', 120), 'Jane Broker')
assert.equal(escapeHtml('<x>"'), '&lt;x&gt;&quot;')

const a = hashSignupToken('abc')
const b = hashSignupToken('ABC')
assert.equal(a, b)
assert.notEqual(hashSignupToken('abc'), hashSignupToken('abd'))

const html = signupOwnerNoticeHtml({
  name: 'Jane <Broker>',
  email: 'jane@firm.com',
  company: 'Acme',
  acceptUrl: 'https://getmineralmap.com/api/signup-requests/decide?token=tok&action=accept',
  declineUrl: 'https://getmineralmap.com/api/signup-requests/decide?token=tok&action=decline',
})
assert.equal(html.includes('Jane &lt;Broker&gt;'), true)
assert.equal(html.includes('action=accept'), true)
assert.equal(html.includes('action=decline'), true)

console.log('signup-requests.test.ts ok')
