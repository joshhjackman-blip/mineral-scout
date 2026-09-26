import assert from 'node:assert/strict'
import { inviteEmailHtml } from './invite-email'

const html = inviteEmailHtml({
  kind: 'team_member',
  actionUrl: 'https://example.com/auth?invite=abc&email=pat%40co.com',
  inviterEmail: 'admin@co.com',
})
assert.equal(html.includes('https://example.com/auth?invite=abc'), true)
assert.equal(html.includes('admin@co.com'), true)
assert.equal(html.includes('Accept invitation'), true)

const adminHtml = inviteEmailHtml({
  kind: 'team_admin',
  actionUrl: 'https://example.com/auth?welcome=admin',
})
assert.equal(adminHtml.includes('team admin'), true)
assert.equal(adminHtml.includes('Set password and join'), true)

console.log('invite-email.test.ts ok')
