'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft,
  Phone,
  DollarSign,
  Mail,
  Users,
  Activity,
} from 'lucide-react'
import AppLogo from '@/app/components/AppLogo'
import { resolveTeamRole } from '@/lib/team'

export const dynamic = 'force-dynamic'

type MemberRow = {
  user_id: string | null
  email: string
  role: 'admin' | 'member'
  status: string
  skip_traces: number
  call_clicks: number
  emails_sent: number
  closed_deal_count: number
  closed_deal_volume: number
}

type TeamUsage = {
  month: string
  team: {
    owner_id: string
    owner_email: string
    seat_count: number
    seats_used: number
  }
  totals: {
    call_clicks: number
    skip_traces: number
    emails_sent: number
    closed_deal_count: number
    closed_deal_volume: number
    estimated_success_fee: number
    success_fee_rate: number
  }
  members: MemberRow[]
  warnings?: string[]
}

export default function TeamAdminDashboard() {
  const supabase = useMemo(
    () =>
      createClient(),
    [],
  )
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [usage, setUsage] = useState<TeamUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const currentMonth = useMemo(
    () => new Date().toLocaleString('default', { month: 'short', year: 'numeric' }),
    [],
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/team/usage', { cache: 'no-store' })
      const data = (await res.json()) as TeamUsage & { error?: string }
      if (!res.ok) {
        setError(data.error || 'Failed to load team dashboard')
        setUsage(null)
        if (res.status === 403 || res.status === 401) {
          window.location.href = '/account'
        }
        return
      }
      setUsage(data)
      setLastUpdated(new Date())
    } catch {
      setError('Failed to load team dashboard')
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
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('status, seat_count, team_owner_id')
        .eq('user_id', session.user.id)
        .maybeSingle()
      const role = resolveTeamRole({
        metadata: session.user.user_metadata as Record<string, unknown>,
        email: session.user.email,
        subscription: sub,
      })
      if (role !== 'team_admin') {
        window.location.href = role === 'platform_owner' || role === 'platform_admin'
          ? '/admin'
          : '/account'
        return
      }
      await refresh()
    }
    void gate()
  }, [refresh, supabase])

  const totals = usage?.totals
  const team = usage?.team

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <AppLogo variant="light" width={120} />
          <span className="text-gray-600">·</span>
          <span className="text-sm text-gray-400">Team admin</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/account"
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
          >
            Account
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
          >
            <ArrowLeft size={13} />
            Back to map
          </Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="font-serif text-2xl font-bold text-gray-900">
              Your team dashboard
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Monitor activity and estimated spend for your workspace only.
              {team ? ` · ${team.seats_used}/${team.seat_count} seats` : ''}
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
              className={`text-xs font-medium px-3.5 py-1.5 rounded-md border-0 ${
                refreshing
                  ? 'bg-gray-100 text-gray-400'
                  : 'bg-gray-900 text-white'
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard
            label="Call volume"
            icon={<Phone size={18} className="text-amber-500" />}
            value={loading ? '—' : (totals?.call_clicks ?? 0).toLocaleString()}
            hint={`${currentMonth} · phone clicks`}
            sub={`Skip traces: ${loading ? '—' : (totals?.skip_traces ?? 0).toLocaleString()}`}
          />
          <StatCard
            label="Est. team $"
            icon={<DollarSign size={18} className="text-emerald-500" />}
            value={
              loading
                ? '—'
                : `$${(totals?.estimated_success_fee ?? 0).toLocaleString()}`
            }
            hint={`Est. 10% success fee (${currentMonth})`}
            sub={`Closed volume: $${loading ? '—' : (totals?.closed_deal_volume ?? 0).toLocaleString()}`}
          />
          <StatCard
            label="Email"
            icon={<Mail size={18} className="text-blue-500" />}
            value={loading ? '—' : (totals?.emails_sent ?? 0).toLocaleString()}
            hint={`${currentMonth} · platform sends`}
            sub={`Seats: ${team ? `${team.seats_used}/${team.seat_count}` : '—'}`}
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-gray-400" />
              <h2 className="font-serif text-lg font-bold text-gray-900">
                Team activity — {currentMonth}
              </h2>
            </div>
            <Link
              href="/account"
              className="text-xs font-semibold text-amber-700 hover:text-amber-800"
            >
              Manage seats →
            </Link>
          </div>
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
          ) : (usage?.members ?? []).length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No members yet.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Person', 'Role', 'Calls', 'Skip traces', 'Emails', 'Closed $', 'Est. fee'].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(usage?.members ?? []).map((m) => (
                    <tr key={`${m.email}-${m.role}`} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-sm font-medium text-gray-900">
                        {m.email}
                        {m.status !== 'active' && m.status !== 'accepted' && (
                          <span className="ml-2 text-xs text-gray-400 capitalize">
                            ({m.status})
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600 capitalize">
                        {m.role}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {m.call_clicks.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {m.skip_traces.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {m.emails_sent.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        ${m.closed_deal_volume.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-emerald-700">
                        $
                        {Math.round(m.closed_deal_volume * 0.1).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {usage?.warnings && usage.warnings.length > 0 && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start gap-2">
            <Activity size={14} className="mt-0.5 shrink-0" />
            <span>{usage.warnings.join(' · ')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
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
