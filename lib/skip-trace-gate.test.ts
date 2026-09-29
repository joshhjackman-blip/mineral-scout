import assert from 'node:assert/strict'
import {
  SKIP_TRACE_CARD_REQUIRED_MESSAGE,
  SKIP_TRACE_PAYMENT_FAILED_MESSAGE,
  skipTracePaymentGate,
} from './skip-trace-gate'

assert.equal(skipTracePaymentGate({ waived: true, liveLookup: true }).ok, true)
assert.equal(
  skipTracePaymentGate({
    stripeConfigured: false,
    gateReady: true,
    hasCard: false,
    liveLookup: true,
  }).ok,
  true,
)
assert.equal(
  skipTracePaymentGate({
    stripeConfigured: true,
    gateReady: false,
    hasCard: false,
    liveLookup: true,
  }).ok,
  true,
)

const cache = skipTracePaymentGate({
  stripeConfigured: true,
  gateReady: true,
  hasCard: false,
  liveLookup: false,
})
assert.equal(cache.ok, true)

const noCard = skipTracePaymentGate({
  stripeConfigured: true,
  gateReady: true,
  hasCard: false,
  liveLookup: true,
})
assert.equal(noCard.ok, false)
if (!noCard.ok) {
  assert.equal(noCard.error, 'card_required')
  assert.equal(noCard.status, 402)
  assert.equal(noCard.redirect, '/account')
  assert.equal(noCard.message, SKIP_TRACE_CARD_REQUIRED_MESSAGE)
}

const pastDueCache = skipTracePaymentGate({
  stripeConfigured: true,
  gateReady: true,
  hasCard: true,
  pastDue: true,
  liveLookup: false,
})
assert.equal(pastDueCache.ok, false)
if (!pastDueCache.ok) {
  assert.equal(pastDueCache.error, 'payment_failed')
  assert.equal(pastDueCache.message, SKIP_TRACE_PAYMENT_FAILED_MESSAGE)
}

const ready = skipTracePaymentGate({
  stripeConfigured: true,
  gateReady: true,
  hasCard: true,
  pastDue: false,
  liveLookup: true,
})
assert.equal(ready.ok, true)

console.log('skip-trace-gate.test.ts ok')
