'use client'

import { useCallback, useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'
import CollapsiblePanel from './CollapsiblePanel'

type SignupRow = {
  id: string
  full_name: string
  email: string
  company?: string | null
  status: string
  created_at: string
}

export default function SignupRequestsPanel() {
  const [rows, setRows] = useState<SignupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/owner/signup-requests?status=pending', {
        cache: 'no-store',
      })
      const json = (await res.json()) as { data?: { requests?: SignupRow[] } }
      setRows(json.data?.requests ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const decide = async (id: string, action: 'accept' | 'decline') => {
    setBusyId(id)
    setMessage(null)
    try {
      const res = await fetch('/api/owner/signup-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { emailed?: boolean; action_url?: string | null }
      }
      if (!res.ok) {
        setMessage(json.error || 'Could not update request')
        return
      }
      setMessage(
        action === 'accept'
          ? json.data?.emailed
            ? 'Approved and emailed a signup link.'
            : json.data?.action_url
              ? `Approved, but email failed. Link: ${json.data.action_url}`
              : 'Approved.'
          : 'Declined.',
      )
      await load()
    } catch {
      setMessage('Could not update request')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <CollapsiblePanel
      title="Signup requests"
      subtitle="Get started form. Accept emails them a link to finish password, paperwork, billing, and team admin."
      icon={<UserPlus size={16} className="text-amber-600" />}
      badge={
        rows.length > 0 ? (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500 text-white">
            {rows.length} pending
          </span>
        ) : undefined
      }
      defaultOpen
    >
      <div className="px-6 pb-5">
        {message ? <p className="text-sm text-amber-800 mb-3">{message}</p> : null}
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400">No pending requests.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {rows.map((row) => (
              <div
                key={row.id}
                className="py-3 flex items-start justify-between gap-3 flex-wrap"
              >
                <div>
                  <div className="text-sm font-semibold text-gray-900">{row.full_name}</div>
                  <div className="text-xs text-gray-500">
                    {row.email}
                    {row.company ? ` · ${row.company}` : ''}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {new Date(row.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => {
                      void decide(row.id, 'accept')
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 text-white disabled:opacity-50"
                  >
                    {busyId === row.id ? '…' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => {
                      void decide(row.id, 'decline')
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md border border-red-200 text-red-700 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CollapsiblePanel>
  )
}
