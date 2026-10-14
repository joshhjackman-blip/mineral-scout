'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Phone } from 'lucide-react'
import {
  PREVIEW_FOUND_HITS,
  SKIP_TRACE_HIT_OPEN_EVENT,
  formatHitPhone,
  shouldLoadPreviewHits,
  type SkipTraceFoundHit,
} from '@/lib/skip-trace-hits'

const HIDDEN_PREFIXES = [
  '/landing',
  '/auth',
  '/pricing',
  '/demo',
  '/book-demo',
  '/get-started',
  '/onboard',
  '/legal',
  '/owner',
  '/admin',
]

const LOCAL_ACK_KEY = 'mm-skip-trace-hit-acks'

function readLocalAcks(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_ACK_KEY) || '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.map((id) => String(id)) : [])
  } catch {
    return new Set()
  }
}

function writeLocalAck(id: string) {
  const next = readLocalAcks()
  next.add(id)
  window.localStorage.setItem(LOCAL_ACK_KEY, JSON.stringify(Array.from(next)))
}

export default function SkipTraceHitInbox() {
  const pathname = usePathname() || '/'
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [signedIn, setSignedIn] = useState(false)
  const [hits, setHits] = useState<SkipTraceFoundHit[]>([])
  const [open, setOpen] = useState(true)
  const [acking, setAcking] = useState<string | null>(null)

  const hidden = HIDDEN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )

  const refresh = useCallback(async () => {
    if (shouldLoadPreviewHits()) {
      setHits(PREVIEW_FOUND_HITS)
      setSignedIn(true)
      return
    }
    try {
      const res = await fetch('/api/skip-trace-hits', { cache: 'no-store' })
      if (res.status === 401) {
        setHits([])
        return
      }
      if (!res.ok) return
      const payload = (await res.json()) as { data?: SkipTraceFoundHit[] }
      const acked = readLocalAcks()
      setHits(
        (Array.isArray(payload.data) ? payload.data : []).filter((hit) => !acked.has(hit.id)),
      )
    } catch {
      // Non-fatal — inbox is a convenience, not a blocker.
    }
  }, [])

  useEffect(() => {
    if (hidden) return
    if (shouldLoadPreviewHits()) {
      setSignedIn(true)
      return
    }
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(Boolean(session?.user))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user))
    })
    return () => {
      sub.subscription.unsubscribe()
    }
  }, [hidden, supabase])

  useEffect(() => {
    if (hidden || !signedIn) return
    void refresh()
    if (shouldLoadPreviewHits()) return
    const timer = window.setInterval(() => {
      void refresh()
    }, 45_000)
    return () => window.clearInterval(timer)
  }, [hidden, signedIn, refresh])

  const ackAndOpen = async (hit: SkipTraceFoundHit) => {
    setAcking(hit.id)
    setHits((prev) => prev.filter((row) => row.id !== hit.id))
    if (!hit.id.startsWith('preview-')) writeLocalAck(hit.id)
    try {
      await fetch('/api/skip-trace-hits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: hit.id }),
      })
    } catch {
      // localStorage already hid it; server ack is best-effort until the
      // skip_trace_hit_acks migration is applied.
    } finally {
      setAcking(null)
    }

    const onCrm = pathname === '/crm' || pathname.startsWith('/crm/')
    if (onCrm) {
      window.dispatchEvent(
        new CustomEvent(SKIP_TRACE_HIT_OPEN_EVENT, {
          detail: { leadId: hit.dealId, ownerName: hit.ownerName },
        }),
      )
      return
    }
    const params = new URLSearchParams()
    if (hit.dealId) params.set('lead', hit.dealId)
    else params.set('owner', hit.ownerName)
    params.set('call', '1')
    router.push(`/crm?${params.toString()}`)
  }

  if (hidden || !signedIn || hits.length === 0) return null

  return (
    <div className="fixed top-16 right-4 z-[90] w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="rounded-xl border border-emerald-200 bg-white shadow-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-emerald-50 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <Phone size={14} />
            {hits.length === 1
              ? 'Researcher found a missed number'
              : `Researcher found ${hits.length} missed numbers`}
          </span>
          <span className="text-[11px] font-semibold text-emerald-700">
            {open ? 'Hide' : 'Show'}
          </span>
        </button>
        {open && (
          <ul className="max-h-[min(420px,50vh)] overflow-auto divide-y divide-gray-100">
            {hits.map((hit) => (
              <li key={hit.id} className="px-4 py-3">
                <div className="text-sm font-semibold text-gray-900 leading-snug">
                  {hit.ownerName}
                </div>
                {hit.person ? (
                  <div className="text-[11px] text-gray-400 mt-0.5">Matched {hit.person}</div>
                ) : null}
                <div className="text-sm text-emerald-800 mt-1 tabular-nums">
                  {formatHitPhone(hit.phones[0])}
                  {hit.phones.length > 1 ? (
                    <span className="text-[11px] text-gray-400 ml-1">
                      +{hit.phones.length - 1} more
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={acking === hit.id}
                  onClick={() => {
                    void ackAndOpen(hit)
                  }}
                  className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300"
                >
                  {acking === hit.id ? 'Opening…' : 'Got it'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
