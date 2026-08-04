'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { ArrowLeft, CheckCircle2, LifeBuoy } from 'lucide-react'
import AppLogo from '@/app/components/AppLogo'

export const dynamic = 'force-dynamic'

const CATEGORIES = [
  { value: 'billing', label: 'Billing / success fee' },
  { value: 'technical', label: 'Technical issue' },
  { value: 'account', label: 'Account / seats' },
  { value: 'data_map', label: 'Data / map' },
  { value: 'other', label: 'Other' },
] as const

export default function HelpDeskPage() {
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ),
    [],
  )

  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<string>('technical')
  const [message, setMessage] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ticketId, setTicketId] = useState<string | null>(null)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) setEmail(session.user.email)
    })
  }, [supabase])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/help-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          category,
          message,
          website: honeypot,
        }),
      })
      const data = (await res.json()) as {
        success?: boolean
        error?: string | null
        data?: { ticketId?: string } | null
      }
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to submit ticket')
        return
      }
      setTicketId(data.data?.ticketId ?? 'submitted')
      setSubject('')
      setMessage('')
    } catch {
      setError('Failed to submit ticket. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <AppLogo variant="light" width={120} />
          <span className="text-gray-600">·</span>
          <span className="text-sm text-gray-400">Help desk</span>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
        >
          <ArrowLeft size={13} />
          Back to map
        </Link>
      </header>

      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center">
            <LifeBuoy size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold text-gray-900">Help desk</h1>
            <p className="text-sm text-gray-500">
              Tickets go to management@mineralmapllc.com
            </p>
          </div>
        </div>

        {ticketId ? (
          <div className="bg-white rounded-xl border border-emerald-200 p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={22} className="text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <h2 className="font-serif text-lg font-bold text-gray-900 mb-1">
                  Ticket sent
                </h2>
                <p className="text-sm text-gray-600 leading-relaxed mb-3">
                  We emailed the owner inbox. Reference{' '}
                  <span className="font-semibold text-gray-900">{ticketId}</span>.
                  Reply may come back to {email || 'your account email'}.
                </p>
                <button
                  type="button"
                  onClick={() => setTicketId(null)}
                  className="text-sm font-semibold text-amber-700 hover:text-amber-800"
                >
                  Submit another ticket
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              void handleSubmit(e)
            }}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4"
          >
            <label className="block">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                Your email
              </span>
              <input
                type="email"
                value={email}
                readOnly
                className="mt-1.5 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-600"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                Category
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1.5 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                Subject
              </span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                maxLength={160}
                placeholder="Short summary of the issue"
                className="mt-1.5 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                Message
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                rows={7}
                maxLength={5000}
                placeholder="What happened, what you expected, and any county/owner details that help us reproduce it."
                className="mt-1.5 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-y min-h-[140px]"
              />
            </label>

            {/* Honeypot */}
            <input
              type="text"
              name="website"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              className="hidden"
              aria-hidden="true"
            />

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !subject.trim() || !message.trim()}
              className="w-full px-4 py-2.5 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send ticket'}
            </button>

            <p className="text-xs text-gray-400 text-center">
              Or email{' '}
              <a
                href="mailto:management@mineralmapllc.com"
                className="text-gray-600 underline underline-offset-2"
              >
                management@mineralmapllc.com
              </a>{' '}
              directly.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
