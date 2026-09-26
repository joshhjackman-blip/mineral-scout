'use client'

import { useEffect, useRef } from 'react'
import {
  CALL_OUTCOMES,
  formatLastCalled,
  outcomeLabel,
  phoneKey,
  type CallOutcome,
  type PhoneActivityMap,
} from '@/lib/phone-activity'

type PhoneItem = { display: string; href: string; raw: string }

export default function LeadPhones({
  phones,
  activity,
  connectedPhone,
  callNow = false,
  loggingPhone = null,
  onCall,
  onLogOutcome,
  onDismissCallNow,
}: {
  phones: PhoneItem[]
  activity: PhoneActivityMap
  connectedPhone?: string | null
  callNow?: boolean
  loggingPhone?: string | null
  onCall: (phone: PhoneItem) => void
  onLogOutcome: (phone: PhoneItem, outcome: CallOutcome) => void
  onDismissCallNow?: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!callNow) return
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [callNow])

  if (phones.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-3 text-sm text-gray-400">
        No phone on file
      </div>
    )
  }

  const pickedKey = phoneKey(connectedPhone)
  const picked = phones.find((p) => phoneKey(p.raw) === pickedKey || phoneKey(p.href) === pickedKey)

  return (
    <div ref={rootRef} className="space-y-3">
      {callNow && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-amber-800">
                Call now
              </div>
              <p className="mt-1 text-sm text-amber-900">
                Skip trace just landed. Dial a number, then mark what happened so the team sees it.
              </p>
            </div>
            {onDismissCallNow && (
              <button
                type="button"
                onClick={onDismissCallNow}
                className="shrink-0 text-xs font-medium text-amber-800 underline"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {picked && !callNow && (
        <div className="text-xs text-emerald-700">
          Picked up: <span className="font-semibold">{picked.display}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {phones.map((phone) => {
          const key = phoneKey(phone.raw) || phoneKey(phone.href)
          const entry = activity[key]
          const isPicked = Boolean(entry?.connected) || key === pickedKey
          const busy = loggingPhone === key
          return (
            <div
              key={phone.href}
              className={`rounded-lg border bg-white px-3 py-2.5 ${
                callNow && phones[0]?.href === phone.href
                  ? 'border-amber-400 ring-1 ring-amber-300'
                  : isPicked
                    ? 'border-emerald-300'
                    : entry?.lastOutcome === 'wrong_number'
                      ? 'border-red-300'
                      : 'border-gray-200'
              }`}
            >
              <a
                href={phone.href}
                onClick={() => onCall(phone)}
                className="block text-sm font-semibold text-gray-900 hover:text-amber-800"
              >
                {phone.display}
              </a>
              <div className="mt-0.5 text-[11px] text-gray-500">
                {entry
                  ? `${formatLastCalled(entry.lastCalledAt)} · ${outcomeLabel(entry.lastOutcome)}${
                      entry.lastCalledByName ? ` · ${entry.lastCalledByName}` : ''
                    }`
                  : 'Not called yet'}
                {isPicked ? ' · Picked up' : ''}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {CALL_OUTCOMES.map((outcome) => {
                  const active = entry?.lastOutcome === outcome.key
                  return (
                    <button
                      key={outcome.key}
                      type="button"
                      disabled={busy}
                      onClick={() => onLogOutcome(phone, outcome.key)}
                      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-50 ${
                        active
                          ? outcome.key === 'connected'
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : outcome.key === 'wrong_number'
                              ? 'border-red-600 bg-red-600 text-white'
                              : 'border-gray-800 bg-gray-800 text-white'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-amber-300 hover:text-amber-800'
                      }`}
                    >
                      {outcome.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
