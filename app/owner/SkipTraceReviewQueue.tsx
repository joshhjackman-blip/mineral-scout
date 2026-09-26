'use client'

import { useEffect, useMemo, useState } from 'react'
import { PhoneOff } from 'lucide-react'
import type { SkipTraceReview } from '@/lib/skip-trace-review'
import { reviewReasonLabel } from '@/lib/skip-trace-review'

type SkipTraceReviewQueueProps = {
  reviews: SkipTraceReview[]
  loading?: boolean
  onResolve: (input: {
    id: string
    phones: string
    emails: string
    notes: string
  }) => Promise<{ success: boolean; error?: string }>
  onDismiss: (id: string, notes: string) => Promise<{ success: boolean; error?: string }>
}

export default function SkipTraceReviewQueue({
  reviews,
  loading,
  onResolve,
  onDismiss,
}: SkipTraceReviewQueueProps) {
  const openReviews = useMemo(
    () => reviews.filter((r) => r.status === 'open'),
    [reviews],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = openReviews.find((r) => r.id === selectedId) ?? openReviews[0] ?? null
  const [phones, setPhones] = useState('')
  const [emails, setEmails] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const formPhonesFor = (review: SkipTraceReview) =>
    review.reason === 'wrong_number' ? '' : (review.phones ?? []).join('\n')

  const select = (review: SkipTraceReview) => {
    setSelectedId(review.id)
    setPhones(formPhonesFor(review))
    setEmails((review.emails ?? []).join('\n'))
    setNotes(review.notes ?? '')
    setMessage(null)
  }

  useEffect(() => {
    if (!selected) return
    setPhones(formPhonesFor(selected))
    setEmails((selected.emails ?? []).join('\n'))
    setNotes(selected.notes ?? '')
    // Populate the form when the selected review changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const submit = async (action: 'resolve' | 'dismiss') => {
    if (!selected) return
    setBusy(true)
    setMessage(null)
    const result =
      action === 'resolve'
        ? await onResolve({ id: selected.id, phones, emails, notes })
        : await onDismiss(selected.id, notes)
    setBusy(false)
    if (!result.success) {
      setMessage(result.error || 'Save failed')
      return
    }
    setPhones('')
    setEmails('')
    setNotes('')
    setSelectedId(null)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-lg font-bold text-gray-900">
            Numbers to fix
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Skip traces with no phone, and numbers callers marked wrong.
            Enter the right number here — CRM and the shared cache update when you save.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
          <PhoneOff size={12} />
          {openReviews.length} open
        </span>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-400">Loading...</div>
      ) : openReviews.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400">
          No failed skip traces or wrong numbers waiting.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] min-h-[360px]">
          <div className="overflow-auto border-b lg:border-b-0 lg:border-r border-gray-100">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Owner', 'Issue', 'Address', 'County', 'Requested by', 'When'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {openReviews.map((review) => (
                  <tr
                    key={review.id}
                    onClick={() => select(review)}
                    className={`cursor-pointer ${
                      selected?.id === review.id ? 'bg-amber-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-2.5 text-sm font-medium text-gray-900">
                      {review.owner_name}
                      {review.tract_abstract ? (
                        <div className="text-xs text-gray-400">{review.tract_abstract}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          review.reason === 'wrong_number'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {reviewReasonLabel(review.reason)}
                      </span>
                      {review.reason === 'wrong_number' && review.phones?.length ? (
                        <div className="text-[11px] text-gray-400 mt-1">
                          {review.phones[0]}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">
                      {[review.mailing_address, review.mailing_city, review.mailing_state, review.mailing_zip]
                        .filter(Boolean)
                        .join(', ') || 'No address'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 capitalize">
                      {review.county || 'n/a'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">
                      {review.requested_by_email || 'Unknown user'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(review.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4">
            {selected ? (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{selected.owner_name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {[selected.mailing_address, selected.mailing_city, selected.mailing_state, selected.mailing_zip]
                      .filter(Boolean)
                      .join(', ') || 'No mailing address on file'}
                  </div>
                  {selected.reason === 'wrong_number' && selected.phones?.length ? (
                    <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
                      Marked wrong: {selected.phones.join(', ')}. Enter a replacement below.
                    </div>
                  ) : null}
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Phone numbers</span>
                  <textarea
                    value={phones}
                    onChange={(e) => setPhones(e.target.value)}
                    rows={3}
                    placeholder="One number per line"
                    className="mt-1 w-full text-sm border border-gray-200 rounded-md px-2.5 py-2 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Emails (optional)</span>
                  <textarea
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    rows={2}
                    placeholder="One email per line"
                    className="mt-1 w-full text-sm border border-gray-200 rounded-md px-2.5 py-2 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Notes</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="mt-1 w-full text-sm border border-gray-200 rounded-md px-2.5 py-2 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                  />
                </label>
                {message ? (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
                    {message}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submit('resolve')}
                    className="flex-1 px-3 py-2 text-xs font-semibold rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40"
                  >
                    {busy ? 'Saving...' : 'Save number'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submit('dismiss')}
                    className="px-3 py-2 text-xs font-medium rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-400 py-10 text-center">
                Select a lead to enter a phone number.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
