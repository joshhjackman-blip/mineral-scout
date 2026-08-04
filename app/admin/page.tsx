'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import {
  Users,
  CreditCard,
  TrendingUp,
  Phone,
  ArrowLeft,
  Mail,
  DollarSign,
  Activity,
} from 'lucide-react'
import AppLogo from '@/app/components/AppLogo'

export const dynamic = 'force-dynamic'

type UserRow = {
  id: string
  email: string
  created_at: string
  subscription_status: string
  is_admin: boolean
  subscription?: {
    status: string
    stripe_customer_id: string
    created_at: string
  } | null
  skip_traces?: number
}

type StatsRow = {
  totalUsers: number
  activeSubscribers: number
  trialUsers: number
  totalSkipTraces: number
}

type UsagePayload = {
  month: string
  callVolume: {
    callClicks: number
    skipTraces: number
    primary: number
  }
  monthlyDollars: {
    closedDealCount: number
    closedDealVolume: number
    estimatedSuccessFee: number
    successFeeRate: number
    agreementsSigned: number
  }
  email: {
    sent: number
    byKind: Record<string, number>
  }
  warnings?: string[]
}

type AdminTab = 'users' | 'usage'

export default function AdminDashboard() {
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  )
  const [tab, setTab] = useState<AdminTab>('usage')
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [refreshing, setRefreshing] = useState(false)
  const [stats, setStats] = useState<StatsRow>({
    totalUsers: 0,
    activeSubscribers: 0,
    trialUsers: 0,
    totalSkipTraces: 0,
  })
  const [usage, setUsage] = useState<UsagePayload | null>(null)
  const currentMonth = useMemo(
    () => new Date().toLocaleString('default', { month: 'short', year: 'numeric' }),
    []
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [usersRes, usageRes] = await Promise.all([
        fetch('/api/admin/users', { cache: 'no-store' }),
        fetch('/api/admin/usage', { cache: 'no-store' }),
      ])
      if (!usersRes.ok) {
        window.location.href = '/'
        return
      }

      const data = (await usersRes.json()) as {
        users?: UserRow[]
        stats?: StatsRow
      }
      setUsers(data.users ?? [])
      setStats(
        data.stats ?? {
          totalUsers: 0,
          activeSubscribers: 0,
          trialUsers: 0,
          totalSkipTraces: 0,
        }
      )

      if (usageRes.ok) {
        setUsage((await usageRes.json()) as UsagePayload)
      } else {
        setUsage(null)
      }
      setLastUpdated(new Date())
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user?.user_metadata?.is_admin) {
        window.location.href = '/'
        return
      }
      await refresh()
    }

    void load()
  }, [refresh, supabase])

  useEffect(() => {
    const interval = setInterval(() => {
      void refresh()
    }, 60000)
    return () => clearInterval(interval)
  }, [refresh])

  const statusColor = (status: string) => {
    if (status === 'active') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    if (status === 'trialing') return 'bg-blue-50 text-blue-700 border-blue-200'
    if (status === 'canceling') return 'bg-amber-50 text-amber-700 border-amber-200'
    return 'bg-gray-50 text-gray-500 border-gray-200'
  }

  const fee = usage?.monthlyDollars.estimatedSuccessFee ?? 0
  const volume = usage?.monthlyDollars.closedDealVolume ?? 0
  const callClicks = usage?.callVolume.callClicks ?? 0
  const skipTraces = usage?.callVolume.skipTraces ?? stats.totalSkipTraces
  const emailsSent = usage?.email.sent ?? 0

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <AppLogo variant="light" width={120} />
          <span className="text-gray-600">·</span>
          <span className="text-sm text-gray-400">Admin</span>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
        >
          <ArrowLeft size={13} />
          Back to map
        </Link>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
            {(
              [
                { key: 'usage' as const, label: 'Usage' },
                { key: 'users' as const, label: 'Users' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                  tab === t.key
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/review"
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-md border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
            >
              Review flagged deeds
            </Link>
            <span className="text-xs text-gray-500">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
            <button
              onClick={() => {
                void refresh()
              }}
              disabled={refreshing}
              className={`text-xs font-medium px-3.5 py-1.5 rounded-md border-0 ${
                refreshing
                  ? 'bg-gray-100 text-gray-400 cursor-default'
                  : 'bg-gray-900 text-white cursor-pointer'
              }`}
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {tab === 'usage' ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <UsageCard
                label="Call volume"
                icon={<Phone size={18} className="text-amber-500" />}
                value={loading ? '—' : callClicks.toLocaleString()}
                hint={`${currentMonth} · phone clicks from OwnerDrawer`}
                sub={`Skip traces: ${loading ? '—' : skipTraces.toLocaleString()}`}
              />
              <UsageCard
                label="Monthly $"
                icon={<DollarSign size={18} className="text-emerald-500" />}
                value={loading ? '—' : `$${fee.toLocaleString()}`}
                hint={`Est. 10% success fee on closed CRM deals (${currentMonth})`}
                sub={`Closed volume: $${loading ? '—' : volume.toLocaleString()} · ${usage?.monthlyDollars.closedDealCount ?? 0} deals`}
              />
              <UsageCard
                label="Email"
                icon={<Mail size={18} className="text-blue-500" />}
                value={loading ? '—' : emailsSent.toLocaleString()}
                hint={`${currentMonth} · Resend platform sends logged`}
                sub={
                  usage?.email.byKind
                    ? Object.entries(usage.email.byKind)
                        .map(([k, v]) => `${k.replace('_', ' ')}: ${v}`)
                        .join(' · ') || 'No sends yet'
                    : 'No sends yet'
                }
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Activity size={16} className="text-gray-400" />
                <h2 className="font-serif text-lg font-bold text-gray-900">
                  Usage details — {currentMonth}
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                    Outreach
                  </div>
                  <ul className="space-y-1.5">
                    <li>Phone clicks: <strong className="text-gray-900">{callClicks}</strong></li>
                    <li>Skip traces: <strong className="text-gray-900">{skipTraces}</strong></li>
                    <li>
                      Agreements signed:{' '}
                      <strong className="text-gray-900">
                        {usage?.monthlyDollars.agreementsSigned ?? 0}
                      </strong>
                    </li>
                  </ul>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                    Revenue estimate
                  </div>
                  <ul className="space-y-1.5">
                    <li>
                      Closed deal volume:{' '}
                      <strong className="text-gray-900">${volume.toLocaleString()}</strong>
                    </li>
                    <li>
                      Est. success fee (10%):{' '}
                      <strong className="text-gray-900">${fee.toLocaleString()}</strong>
                    </li>
                    <li className="text-xs text-gray-400 pt-1">
                      Estimated from CRM deals tagged <code>closed</code> with an offer amount —
                      not invoiced revenue.
                    </li>
                  </ul>
                </div>
              </div>
              {usage?.warnings && usage.warnings.length > 0 && (
                <div className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Some metrics may be incomplete until migrations are applied:{' '}
                  {usage.warnings.join(' · ')}
                </div>
              )}
            </div>

            <div className="bg-gray-900 rounded-xl p-5 flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
                  Legacy Stripe MRR (footnote)
                </div>
                <div className="font-serif text-2xl font-bold text-white">
                  ${loading ? '—' : (stats.activeSubscribers * 300).toLocaleString()}
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  {stats.activeSubscribers} active × $300/mo — archived paywall rows only
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
                  Primary monthly $
                </div>
                <div className="font-serif text-2xl font-bold text-amber-400">
                  ${loading ? '—' : fee.toLocaleString()}
                </div>
                <div className="text-sm text-gray-400 mt-1">Est. success fee this month</div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Total users', val: stats.totalUsers, icon: <Users size={18} className="text-gray-400" /> },
                {
                  label: 'Active subscribers',
                  val: stats.activeSubscribers,
                  icon: <CreditCard size={18} className="text-emerald-500" />,
                },
                { label: 'Trial users', val: stats.trialUsers, icon: <TrendingUp size={18} className="text-blue-500" /> },
                {
                  label: 'Skip traces this month',
                  val: stats.totalSkipTraces,
                  icon: <Phone size={18} className="text-amber-500" />,
                },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{s.label}</div>
                    {s.icon}
                  </div>
                  <div className="font-serif text-3xl font-bold text-gray-900">{loading ? '—' : s.val}</div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-serif text-lg font-bold text-gray-900">All Users</h2>
                <span className="text-xs text-gray-400">{users.length} total</span>
              </div>
              {loading ? (
                <div className="p-8 text-center text-sm text-gray-400">Loading...</div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        {['Email', 'Signed up', 'Subscription', `Skip traces (${currentMonth})`, 'Admin'].map((h) => (
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
                      {users.map((user) => (
                        <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 text-sm font-medium text-gray-900">{user.email}</td>
                          <td className="px-5 py-3 text-sm text-gray-500">
                            {new Date(user.created_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="px-5 py-3">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColor(user.subscription_status)}`}
                            >
                              {user.subscription_status || 'none'}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-500">{user.skip_traces ?? 0}</td>
                          <td className="px-5 py-3 text-sm text-gray-500">{user.is_admin ? '✓' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function UsageCard({
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
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{label}</div>
        {icon}
      </div>
      <div className="font-serif text-3xl font-bold text-gray-900">{value}</div>
      <div className="mt-2 text-xs text-gray-500">{hint}</div>
      <div className="mt-1 text-xs text-gray-400">{sub}</div>
    </div>
  )
}
