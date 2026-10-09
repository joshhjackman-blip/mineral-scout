/**
 * Accurate Append official Appending API (Services/V2).
 * License key goes in the URL path. Auth itself does not need a person
 * record — a nameless Ads call returns 400 when the key is valid, 401
 * when it is missing/expired. Phone/email appends are billed only on
 * successful calls.
 */

import { personCandidatesFromTaxRoll, type TraceNameArgs } from './skip-trace-name'

export const ACCURATE_APPEND_BASE = 'https://api.accurateappend.com/Services/V2'

export type AccurateAppendPerson = {
  firstName: string
  lastName: string
  label: string
}

export type AccurateAppendLicenseProbe = {
  keySet: boolean
  keyChars: number
  ok: boolean
  status: number | null
  error: string | null
  billedSearch: false
}

export function accurateAppendLicenseKey(
  env: NodeJS.Dict<string> = process.env,
): string {
  return (
    env.ACCURATE_APPEND_API_KEY?.trim() ||
    env.ACCURATE_APPEND_LICENSE_KEY?.trim() ||
    ''
  )
}

export function redactAccurateAppendKey(value: string, key: string): string {
  if (!key) return value
  return value.split(key).join('[KEY]')
}

export function classifyAccurateAppendProbe(
  status: number | null,
  error: string | null,
): { ok: boolean; error: string | null } {
  const message = (error || '').trim()
  if (status === 401 || status === 403) {
    return {
      ok: false,
      error: message || 'license key rejected (expired, trial, or invalid)',
    }
  }
  if (status === 400) {
    // Valid key, missing required person fields. Does not bill.
    return { ok: true, error: null }
  }
  if (status === 200) {
    return { ok: true, error: null }
  }
  if (status == null) {
    return { ok: false, error: message || 'Accurate Append did not respond' }
  }
  return { ok: false, error: message || `HTTP ${status}` }
}

export function accurateAppendPeople(a: TraceNameArgs): AccurateAppendPerson[] {
  const roll = personCandidatesFromTaxRoll(a.ownerName)
  if (a.expandNameCandidates && roll.length > 0) {
    return roll.slice(0, 3)
  }
  const firstName = (a.firstName || '').trim()
  const lastName = (a.lastName || '').trim() || (a.ownerName || '').trim()
  if (!firstName && !lastName) return []
  return [{ firstName, lastName, label: 'incoming' }]
}

const BAD_STREET_RE = /%|c\/o|care of|po box|p\.o\. box/i

export function accurateAppendStreet(address: string | null | undefined): string {
  const street = String(address ?? '').trim()
  if (!street || BAD_STREET_RE.test(street)) return ''
  return street
}
