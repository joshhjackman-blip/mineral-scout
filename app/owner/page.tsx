'use client'

/**
 * Platform Owner portfolio dashboard — partners listed in
 * PLATFORM_OWNER_EMAILS (management@ + Jordan).
 * Cross-team activity + skip-trace running totals. Ops tools stay under /admin.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft,
  Phone,
  DollarSign,
  Shield,
  PhoneOff,
  Activity,
} from 'lucide-react'
import AppLogo from '@/app/components/AppLogo'
import { isPlatformInternalEmail, isPlatformOwner } from '@/lib/team'
import { SKIP_TRACE_PRICE_USD, estimateMonthlySkipTraceCost } from '@/lib/billing'
import SkipTraceReviewQueue from './SkipTraceReviewQueue'
import type { SkipTraceReview } from '@/lib/skip-trace-review'
import { PREVIEW_REVIEWS, shouldLoadPreviewReviews } from './preview-reviews'

export const dynamic = 'force-dynamic'

type TeamSpendRow = {
  owner_id: string
  owner_email: string
  seat_count: number
  member_count: number
  skip_traces: number
  billable_skip_traces?: number
  skip_trace_amount_usd?: number
  stripe_customer_id?: string | null
  billing_exempt?: boolean
  skip_trace_waived?: boolean
  invoice_status?: string | null
  hosted_invoice_url?: string | null
  call_clicks: number
  emails_sent: number
  closed_deal_count: number
  closed_deal_volume: number
  estimated_success_fee: number
  wrong_numbers?: number
}

type UsagePayload = {
  month: string
  callVolume: { callClicks: number; skipTraces: number; billableSkipTraces?: number }
  skipTraceBilling?: { billableCount: number; amountUsd: number; unitPriceUsd: number }
  wrongNumbers?: { open: number; thisMonth: number }
  monthlyDollars: {
    closedDealCount: number
    closedDealVolume: number
    estimatedSuccessFee: number
  }
  email: { sent: number }
  teams?: TeamSpendRow[]
  warnings?: string[]
}

export default function OwnerPortfolioPage() {
  const supabase = useMemo(
    () =>
      createClient(),
    [],
  )
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsagePayload | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [reviews, setReviews] = useState<SkipTraceReview[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [invoicingId, setInvoicingId] = useState<string | null>(null)
  const [invoiceMessage, setInvoiceMessage] = useState<string | null>(null)

  const currentMonth = useMemo(
    () => new Date().toLocaleString('default', { month: 'short', year: 'numeric' }),
    [],
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const [usageRes, reviewsRes] = await Promise.all([
        fetch('/api/admin/usage', { cache: 'no-store' }),
        fetch('/api/owner/skip-trace-reviews?status=open', { cache: 'no-store' }),
      ])
      if (usageRes.status === 401) {
        setError('Not authorized as platform owner.')
        return
      }
      if (usageRes.ok) {
        setUsage((await usageRes.json()) as UsagePayload)
      } else {
        setError('Failed to load platform usage.')
      }
      if (reviewsRes.ok) {
        const data = (await reviewsRes.json()) as { reviews?: SkipTraceReview[] }
        setReviews(data.reviews ?? [])
      }
      setReviewsLoading(false)
      setLastUpdated(new Date())
    } catch {
      setError('Failed to load owner dashboard.')
    } finally {
      setRefreshing(false)
      setLoading(false)
      setReviewsLoading(false)
    }
  }, [])

  const resolveReview = async (input: {
    id: string
    phones: string
    emails: string
    notes: string
  }) => {
    if (input.id.startsWith('preview-')) {
      setReviews((prev) => prev.filter((r) => r.id !== input.id))
      return { success: true }
    }
    const res = await fetch('/api/owner/skip-trace-reviews', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve', ...input }),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) return { success: false, error: data.error || 'Save failed' }
    setReviews((prev) => prev.filter((r) => r.id !== input.id))
    return { success: true }
  }

  const dismissReview = async (id: string, notes: string) => {
    if (id.startsWith('preview-')) {
      setReviews((prev) => prev.filter((r) => r.id !== id))
      return { success: true }
    }
    const res = await fetch('/api/owner/skip-trace-reviews', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss', id, notes }),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) return { success: false, error: data.error || 'Dismiss failed' }
    setReviews((prev) => prev.filter((r) => r.id !== id))
    return { success: true }
  }

  useEffect(() => {
    const gate = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        if (shouldLoadPreviewReviews()) {
          setReviews(PREVIEW_REVIEWS)
          setReviewsLoading(false)
          setLoading(false)
          return
        }
        window.location.href = '/auth'
        return
      }
      const userEmail = session.user.email ?? ''
      setEmail(userEmail)
      if (!isPlatformOwner(userEmail)) {
        if (shouldLoadPreviewReviews()) {
          setReviews(PREVIEW_REVIEWS)
          setReviewsLoading(false)
          setLoading(false)
          return
        }
        // Staff admins go to /admin; everyone else home.
        window.location.href = session.user.user_metadata?.is_admin ? '/admin' : '/'
        return
      }
      await refresh()
    }
    void gate()
  }, [refresh, supabase])

  const createInvoice = async (team: TeamSpendRow, send: boolean) => {
    setInvoicingId(team.owner_id)
    setInvoiceMessage(null)
    try {
      const res = await fetch('/api/owner/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_owner_id: team.owner_id,
          month: usage?.month,
          send,
        }),
      })
      const data = (await res.json()) as {
        error?: string
        data?: { hostedInvoiceUrl?: string | null; status?: string; amountUsd?: number }
      }
      if (!res.ok) {
        setInvoiceMessage(data.error || 'Could not create Stripe invoice')
        return
      }
      setInvoiceMessage(
        send
          ? `Sent ${team.owner_email} a Stripe invoice ($${data.data?.amountUsd ?? team.skip_trace_amount_usd}).`
          : `Stripe draft ready for ${team.owner_email} ($${data.data?.amountUsd ?? team.skip_trace_amount_usd}). Open it in Stripe to review before sending.`,
      )
      await refresh()
    } catch {
      setInvoiceMessage('Could not create Stripe invoice')
    } finally {
      setInvoicingId(null)
    }
  }

  const teamRows = (usage?.teams ?? []).filter((t) => !isPlatformInternalEmail(t.owner_email))
  const calls = usage?.callVolume.callClicks ?? 0
  const skips = usage?.callVolume.skipTraces ?? 0
  const billableSkips =
    usage?.skipTraceBilling?.billableCount ?? usage?.callVolume.billableSkipTraces ?? 0
  const skipTraceDue =
    usage?.skipTraceBilling?.amountUsd ?? estimateMonthlySkipTraceCost(billableSkips)
  const wrongOpen = usage?.wrongNumbers?.open ?? 0
  const wrongMonth = usage?.wrongNumbers?.thisMonth ?? 0

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <AppLogo variant="light" width={120} />
          <span className="text-gray-600">·</span>
          <span className="text-sm font-semibold text-amber-400">Owner portfolio</span>
          {reviews.filter((r) => r.status === 'open').length > 0 && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500 text-white">
              {reviews.filter((r) => r.status === 'open').length} to fix
            </span>
          )}
        </div>
        <nav className="flex items-center gap-1">
          <Link
            href="/admin"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md"
          >
            <Shield size={13} />
            Ops console
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md"
          >
            <ArrowLeft size={13} />
            Map
          </Link>
        </nav>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="font-serif text-3xl font-bold text-gray-900">
              Owner portfolio
            </h1>
            <p className="text-sm text-gray-500 mt-1 max-w-xl">
              You are signed in as{' '}
              <strong className="text-gray-800">{email ?? '…'}</strong>.
              This view tracks skip-traces and calls across every team.
              Skip-trace is ${SKIP_TRACE_PRICE_USD.toFixed(2)} per returned
              phone number, invoiced at month end.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
            <button
              type="button"
              onClick={() => {
                void refresh()
              }}
              disabled={refreshing}
              className={`text-xs font-medium px-3.5 py-1.5 rounded-md ${
                refreshing ? 'bg-gray-100 text-gray-400' : 'bg-gray-900 text-white'
              }`}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <SkipTraceReviewQueue
          reviews={reviews}
          loading={reviewsLoading}
          onResolve={resolveReview}
          onDismiss={dismissReview}
        />

        {invoiceMessage && (
          <div className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {invoiceMessage}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card
            label="Calls"
            icon={<Phone size={18} className="text-amber-500" />}
            value={loading ? '—' : calls.toLocaleString()}
            hint={`${currentMonth} · all teams`}
            sub="Phone clicks from map and CRM"
          />
          <Card
            label="Skip traces"
            icon={<Phone size={18} className="text-gray-500" />}
            value={loading ? '—' : skips.toLocaleString()}
            hint={`${currentMonth} · lookups`}
            sub={`${billableSkips.toLocaleString()} phone hits billed`}
          />
          <Card
            label="Skip-trace $"
            icon={<DollarSign size={18} className="text-emerald-500" />}
            value={loading ? '—' : `$${skipTraceDue.toLocaleString()}`}
            hint={`${currentMonth} · $${SKIP_TRACE_PRICE_USD.toFixed(2)} per phone hit`}
            sub="Customer teams · month-end invoice"
          />
          <Card
            label="Wrong numbers"
            icon={<PhoneOff size={18} className="text-red-500" />}
            value={loading ? '—' : wrongOpen.toLocaleString()}
            hint="Open in the queue above"
            sub={`${wrongMonth.toLocaleString()} marked this month`}
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-serif text-lg font-bold text-gray-900">
                Every team — {currentMonth}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Calls and skip-traces this month. Phone hits $ is billed at month
                end (${SKIP_TRACE_PRICE_USD.toFixed(2)} when a number comes back).
              </p>
            </div>
            <Link
              href="/admin?tab=teams"
              className="text-xs font-semibold text-amber-700 hover:text-amber-800"
            >
              Provision a team →
            </Link>
          </div>
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
          ) : teamRows.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-600 mb-2">
                No customer teams provisioned yet.
              </p>
              <p className="text-xs text-gray-400 mb-4">
                Assign a team admin + seat count under Ops console → Provision.
                Platform-wide totals above still include all users.
              </p>
              <Link
                href="/admin?tab=teams"
                className="inline-flex px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600"
              >
                Provision first team
              </Link>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {[
                      'Team admin',
                      'Calls',
                      'Skip traces',
                      'Phone hits $',
                      'Wrong #',
                      'Invoice',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {teamRows.map((team) => (
                    <tr key={team.owner_id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-sm font-medium text-gray-900">
                        {team.owner_email}
                        <div className="text-xs text-gray-400">
                          {team.member_count} member
                          {team.member_count === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {team.call_clicks.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {team.skip_traces.toLocaleString()}
                        <div className="text-xs text-gray-400">
                          {(team.billable_skip_traces ?? 0).toLocaleString()} billable
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-gray-900">
                        {team.skip_trace_waived
                          ? 'Waived'
                          : `$${(team.skip_trace_amount_usd ?? 0).toLocaleString()}`}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {(team.wrong_numbers ?? 0).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {team.skip_trace_waived ? (
                          <span className="text-xs text-gray-400">Owner team</span>
                        ) : team.hosted_invoice_url ? (
                          <a
                            href={team.hosted_invoice_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-amber-700 hover:text-amber-800"
                          >
                            {team.invoice_status || 'open'} →
                          </a>
                        ) : (team.billable_skip_traces ?? 0) > 0 ? (
                          <button
                            type="button"
                            disabled={invoicingId === team.owner_id}
                            onClick={() => {
                              void createInvoice(team, false)
                            }}
                            className="text-xs font-semibold text-amber-700 hover:text-amber-800 disabled:text-gray-400"
                          >
                            {invoicingId === team.owner_id ? 'Creating…' : 'Stripe draft'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {usage?.warnings && usage.warnings.length > 0 && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex gap-2">
            <Activity size={14} className="mt-0.5 shrink-0" />
            <span>{usage.warnings.join(' · ')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Card({
  label,
  icon,
  value,
  hint,
  sub,
}: {
  label: string
  icon: ReactNode
  value: string
  hint: string
  sub: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
          {label}
        </div>
        {icon}
      </div>
      <div className="font-serif text-3xl font-bold text-gray-900">{value}</div>
      <div className="mt-2 text-xs text-gray-500">{hint}</div>
      <div className="mt-1 text-xs text-gray-400">{sub}</div>
    </div>
  )
}
