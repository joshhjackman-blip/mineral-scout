'use client'

import { useMemo, useState } from 'react'
import {
  CALL_LOG_DESIGNATIONS,
  callLogDisplayLabel,
  formatCallLogDate,
  formatCallLogTime,
  isCallLogDesignation,
  joinCallLogDateTime,
  splitCallLogDateTime,
  type CallLogRow,
} from '@/lib/call-logs'

export type CallLogDraft = {
  calledAt: string
  designation: string
  notes: string
}

export default function CallLog({
  rows,
  currentDesignation,
  saving = false,
  error = null,
  onAdd,
}: {
  rows: CallLogRow[]
  currentDesignation?: string | null
  saving?: boolean
  error?: string | null
  onAdd: (draft: CallLogDraft) => Promise<{ success: boolean } | void> | void
}) {
  const initial = useMemo(() => splitCallLogDateTime(), [])
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [designation, setDesignation] = useState(
    isCallLogDesignation(currentDesignation) ? currentDesignation : '',
  )
  const [notes, setNotes] = useState('')

  const submit = async () => {
    const result = await onAdd({
      calledAt: joinCallLogDateTime(date, time),
      designation,
      notes: notes.trim(),
    })
    if (result && result.success === false) return
    const now = splitCallLogDateTime()
    setDate(now.date)
    setTime(now.time)
    setNotes('')
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 text-xs font-bold uppercase tracking-widest text-gray-400">
        Call log
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-gray-500">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-gray-500">Time</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </label>
      </div>

      <label className="mt-2 block">
        <span className="mb-1 block text-[11px] font-medium text-gray-500">Designation</span>
        <select
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
        >
          <option value="">No change</option>
          {CALL_LOG_DESIGNATIONS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-2 block">
        <span className="mb-1 block text-[11px] font-medium text-gray-500">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="What happened on the call"
          className="w-full resize-y rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </label>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={saving || !date}
          onClick={() => {
            void submit()
          }}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Log call'}
        </button>
        {error && <span className="text-xs text-rose-700">{error}</span>}
      </div>

      {rows.length === 0 ? (
        <div className="mt-3 text-sm text-gray-400">No calls logged yet.</div>
      ) : (
        <ol className="mt-3 space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-md border border-gray-200 bg-white px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-gray-900">
                  {formatCallLogDate(row.called_at)}
                  <span className="ml-2 font-medium text-gray-500">
                    {formatCallLogTime(row.called_at)}
                  </span>
                </div>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-700">
                  {callLogDisplayLabel(row)}
                </span>
              </div>
              {row.notes && (
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-700">{row.notes}</p>
              )}
              {(row.phone_display || row.called_by_name) && (
                <div className="mt-1 text-[11px] text-gray-400">
                  {[row.phone_display, row.called_by_name].filter(Boolean).join(' · ')}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
