'use client'

/**
 * Platform Owner portfolio dashboard — management@mineralmapllc.com only.
 * Cross-team activity + estimated spend. Ops tools stay under /admin.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft,
  Phone,
  DollarSign,
  Mail,
  Users,
  Shield,
  Activity,
} from 'lucide-react'
import AppLogo from '@/app/components/AppLogo'
import { isPlatformOwner } from '@/lib/team'

export const dynamic = 'force-dynamic'

type TeamSpendRow = {
  owner_id: string
  owner_email: string
  seat_count: number
  member_count: number
  skip_traces: number
  call_clicks: number
  emails_sent: number
  closed_deal_count: number
  closed_deal_volume: number
  estimated_success_fee: number
}

type UsagePayload = {
  month: string
  callVolume: { callClicks: number; skipTraces: number }
  monthlyDollars: {
    closedDealCount: number
    closedDealVolume: number
    estimatedSuccessFee: number
  }
  email: { sent: number }
  teams?: TeamSpendRow[]
  warnings?: string[]
}

type UserRow = {
  id: string
  email: string
  subscription_status: string
  is_admin: boolean
  skip_traces?: number
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
  const [users, setUsers] = useState<UserRow[]>([])
  const [email, setEmail] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState(new Date())

  const currentMonth = useMemo(
    () => new Date().toLocaleString('default', { month: 'short', year: 'numeric' }),
    [],
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const [usageRes, usersRes] = await Promise.all([
        fetch('/api/admin/usage', { cache: 'no-store' }),
        fetch('/api/admin/users', { cache: 'no-store' }),
      ])
      if (usageRes.status === 401 || usersRes.status === 401) {
        setError('Not authorized as platform owner. Sign in as management@mineralmapllc.com.')
        return
      }
      if (usageRes.ok) {
        setUsage((await usageRes.json()) as UsagePayload)
      } else {
        setError('Failed to load platform usage.')
      }
      if (usersRes.ok) {
        const data = (await usersRes.json()) as { users?: UserRow[] }
        setUsers(data.users ?? [])
      }
      setLastUpdated(new Date())
    } catch {
      setError('Failed to load owner dashboard.')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const gate = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        window.location.href = '/auth'
        return
      }
      const userEmail = session.user.email ?? ''
      setEmail(userEmail)
      if (!isPlatformOwner(userEmail)) {
        // Staff admins go to /admin; everyone else home.
        window.location.href = session.user.user_metadata?.is_admin ? '/admin' : '/'
        return
      }
      await refresh()
    }
    void gate()
  }, [refresh, supabase])

  const teamRows = (usage?.teams ?? []).filter((t) => !isPlatformOwner(t.owner_email))
  const fee = usage?.monthlyDollars.estimatedSuccessFee ?? 0
  const volume = usage?.monthlyDollars.closedDealVolume ?? 0
  const calls = usage?.callVolume.callClicks ?? 0
  const skips = usage?.callVolume.skipTraces ?? 0
  const emails = usage?.email.sent ?? 0
  const customerUsers = users.filter((u) => !u.is_admin && !isPlatformOwner(u.email))

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <AppLogo variant="light" width={120} />
          <span className="text-gray-600">·</span>
          <span className="text-sm font-semibold text-amber-400">Owner portfolio</span>
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
              This view monitors every customer team&apos;s activity and estimated
              success-fee spend across Mineral Map.
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

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card
            label="Teams"
            icon={<Users size={18} className="text-gray-400" />}
            value={loading ? '—' : String(teamRows.length)}
            hint="Provisioned customer workspaces"
            sub={`${customerUsers.length} non-admin accounts`}
          />
          <Card
            label="Platform $"
            icon={<DollarSign size={18} className="text-emerald-500" />}
            value={loading ? '—' : `$${fee.toLocaleString()}`}
            hint={`Est. 10% success fee · ${currentMonth}`}
            sub={`Closed volume $${volume.toLocaleString()}`}
          />
          <Card
            label="Calls"
            icon={<Phone size={18} className="text-amber-500" />}
            value={loading ? '—' : calls.toLocaleString()}
            hint={`${currentMonth} · all teams`}
            sub={`Skip traces: ${skips.toLocaleString()}`}
          />
          <Card
            label="Email"
            icon={<Mail size={18} className="text-blue-500" />}
            value={loading ? '—' : emails.toLocaleString()}
            hint={`${currentMonth} · Resend sends`}
            sub="Across every workspace"
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-serif text-lg font-bold text-gray-900">
                Every team — {currentMonth}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Activity and estimated spend by team admin workspace
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
                      'Seats',
                      'Calls',
                      'Skip traces',
                      'Emails',
                      'Closed deals',
                      'Est. fee',
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
                        {1 + team.member_count}/{team.seat_count}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {team.call_clicks.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {team.skip_traces.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {team.emails_sent.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {team.closed_deal_count}{' '}
                        <span className="text-gray-400">
                          (${team.closed_deal_volume.toLocaleString()})
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-emerald-700">
                        ${team.estimated_success_fee.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-serif text-lg font-bold text-gray-900">
                All accounts
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Every signed-up user (admins excluded from this list)
              </p>
            </div>
            <span className="text-xs text-gray-400">{customerUsers.length} accounts</span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
          ) : customerUsers.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No customer accounts yet.
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Email', 'Status', `Skip traces (${currentMonth})`].map((h) => (
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
                  {customerUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-sm font-medium text-gray-900">
                        {u.email}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {u.subscription_status || 'none'}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {u.skip_traces ?? 0}
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
