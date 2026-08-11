'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
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
import { isPlatformAdmin, isPlatformOwner } from '@/lib/team'

export const dynamic = 'force-dynamic'

type UserRow = {
  id: string
  email: string
  created_at: string
  subscription_status: string
  billing_exempt?: boolean
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
  billingExempt?: number
  totalSkipTraces: number
}

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
  teams?: TeamSpendRow[]
  warnings?: string[]
}

type TeamRow = {
  owner_id: string
  owner_email: string
  status: string
  seat_count: number
  seats_used: number
  members: Array<{ email: string; status: string }>
  is_platform_admin?: boolean
}

type AdminAccountRow = {
  id: string
  email: string
  role: 'platform_owner' | 'platform_admin' | 'team_admin'
  role_label: string
  created_at: string | null
  last_sign_in_at: string | null
  seat_count: number
  seats_used: number | null
  is_owner: boolean
  can_revoke: boolean
}

type AdminTab = 'overview' | 'usage' | 'admins' | 'teams' | 'users'

export default function AdminDashboard() {
  const supabase = useMemo(
    () =>
      createClient(),
    []
  )
  const [tab, setTab] = useState<AdminTab>('overview')
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
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [admins, setAdmins] = useState<AdminAccountRow[]>([])
  const [viewerIsOwner, setViewerIsOwner] = useState(false)
  const [provisionEmail, setProvisionEmail] = useState('')
  const [provisionSeats, setProvisionSeats] = useState(4)
  const [provisionMsg, setProvisionMsg] = useState<string | null>(null)
  const [provisioning, setProvisioning] = useState(false)
  const [grandfatherMsg, setGrandfatherMsg] = useState<string | null>(null)
  const [grandfathering, setGrandfathering] = useState(false)
  const [grandfatherStats, setGrandfatherStats] = useState<{
    total_users: number
    billing_exempt: number
    need_grandfather: number
  } | null>(null)
  const [grantAdminEmail, setGrantAdminEmail] = useState('')
  const [grantAdminMsg, setGrantAdminMsg] = useState<string | null>(null)
  const [grantingAdmin, setGrantingAdmin] = useState(false)
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const currentMonth = useMemo(
    () => new Date().toLocaleString('default', { month: 'short', year: 'numeric' }),
    []
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [usersRes, usageRes, teamsRes, adminsRes, grandfatherRes] =
        await Promise.all([
          fetch('/api/admin/users', { cache: 'no-store' }),
          fetch('/api/admin/usage', { cache: 'no-store' }),
          fetch('/api/admin/teams', { cache: 'no-store' }),
          fetch('/api/admin/admins', { cache: 'no-store' }),
          fetch('/api/admin/grandfather', { cache: 'no-store' }),
        ])
      if (usersRes.status === 401) {
        window.location.href = '/'
        return
      }
      if (!usersRes.ok) {
        // Don't bounce the whole console on a soft API failure.
        console.error('Admin users API failed', usersRes.status)
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
          billingExempt: 0,
          totalSkipTraces: 0,
        }
      )

      if (usageRes.ok) {
        setUsage((await usageRes.json()) as UsagePayload)
      } else {
        setUsage(null)
      }

      if (teamsRes.ok) {
        const teamData = (await teamsRes.json()) as { teams?: TeamRow[] }
        setTeams(teamData.teams ?? [])
      } else {
        setTeams([])
      }

      if (adminsRes.ok) {
        const adminData = (await adminsRes.json()) as {
          admins?: AdminAccountRow[]
          viewer_is_owner?: boolean
        }
        setAdmins(adminData.admins ?? [])
        setViewerIsOwner(Boolean(adminData.viewer_is_owner))
      } else {
        setAdmins([])
      }

      if (grandfatherRes.ok) {
        setGrandfatherStats(
          (await grandfatherRes.json()) as {
            total_users: number
            billing_exempt: number
            need_grandfather: number
          },
        )
      } else {
        setGrandfatherStats(null)
      }
      setLastUpdated(new Date())
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [])

  const handleGrandfatherExisting = async () => {
    if (
      !confirm(
        'Mark all existing users as complimentary (no seat fee)? Safe to re-run. New signups after this still need to subscribe.',
      )
    ) {
      return
    }
    setGrandfathering(true)
    setGrandfatherMsg(null)
    try {
      const res = await fetch('/api/admin/grandfather', { method: 'POST' })
      const data = (await res.json()) as {
        success?: boolean
        newly_exempt?: number
        already_exempt?: number
        total_users?: number
        error?: string
        errors?: Array<{ email: string; error: string }>
      }
      if (!res.ok) {
        setGrandfatherMsg(data.error || 'Grandfather failed')
        return
      }
      const errCount = data.errors?.length ?? 0
      setGrandfatherMsg(
        `Done: ${data.newly_exempt ?? 0} newly exempt, ${data.already_exempt ?? 0} already exempt (${data.total_users ?? 0} total)${
          errCount ? ` · ${errCount} error(s)` : ''
        }.`,
      )
      await refresh()
    } catch {
      setGrandfatherMsg('Grandfather failed')
    } finally {
      setGrandfathering(false)
    }
  }

  const handleProvisionTeam = async () => {
    if (!provisionEmail.trim()) return
    setProvisioning(true)
    setProvisionMsg(null)
    try {
      const res = await fetch('/api/admin/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: provisionEmail.trim(),
          seatCount: provisionSeats,
        }),
      })
      const data = (await res.json()) as {
        success?: boolean
        invited?: boolean
        error?: string
        team?: { owner_email: string; seat_count: number }
      }
      if (!res.ok || !data.success) {
        setProvisionMsg(data.error || 'Failed to provision team')
        return
      }
      setProvisionMsg(
        data.invited
          ? `Invite sent to ${data.team?.owner_email} as team admin (${data.team?.seat_count} seats).`
          : `Provisioned ${data.team?.owner_email} as team admin (${data.team?.seat_count} seats).`,
      )
      setProvisionEmail('')
      await refresh()
    } catch {
      setProvisionMsg('Failed to provision team')
    } finally {
      setProvisioning(false)
    }
  }

  const handleUpdateSeats = async (ownerId: string, seatCount: number) => {
    const res = await fetch('/api/admin/teams', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, seatCount }),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) {
      alert(data.error || 'Failed to update seats')
      return
    }
    await refresh()
  }

  const handleGrantAdmin = async () => {
    if (!grantAdminEmail.trim()) return
    setGrantingAdmin(true)
    setGrantAdminMsg(null)
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: grantAdminEmail.trim() }),
      })
      const data = (await res.json()) as {
        success?: boolean
        invited?: boolean
        error?: string
        admin?: { email: string }
      }
      if (!res.ok || !data.success) {
        setGrantAdminMsg(data.error || 'Failed to grant admin')
        return
      }
      setGrantAdminMsg(
        data.invited
          ? `Invite sent to ${data.admin?.email} as platform admin.`
          : `Granted platform admin to ${data.admin?.email}.`,
      )
      setGrantAdminEmail('')
      await refresh()
    } catch {
      setGrantAdminMsg('Failed to grant admin')
    } finally {
      setGrantingAdmin(false)
    }
  }

  const handleRevokeAdmin = async (userId: string, email: string) => {
    if (!confirm(`Revoke platform admin from ${email}?`)) return
    const res = await fetch('/api/admin/admins', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'revoke' }),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) {
      alert(data.error || 'Failed to revoke admin')
      return
    }
    await refresh()
  }

  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (
        !isPlatformAdmin(
          session?.user?.user_metadata as Record<string, unknown> | undefined,
          session?.user?.email,
        )
      ) {
        window.location.href = '/'
        return
      }
      const email = session?.user?.email ?? null
      setSessionEmail(email)
      const owner = isPlatformOwner(email)
      setViewerIsOwner(owner)
      const params = new URLSearchParams(window.location.search)
      const tabParam = params.get('tab') as AdminTab | null
      const allowed: AdminTab[] = owner
        ? ['overview', 'admins', 'teams', 'users']
        : ['usage', 'admins', 'teams', 'users']
      if (tabParam && allowed.includes(tabParam)) {
        setTab(tabParam)
      } else {
        setTab(owner ? 'overview' : 'usage')
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
  const isOwnerView = viewerIsOwner || isPlatformOwner(sessionEmail)
  const teamRows = (usage?.teams ?? []).filter(
    (t) => !isPlatformOwner(t.owner_email),
  )
  const activeTeams = teamRows.length

  const ownerTabs = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'admins' as const, label: 'Admins' },
    { key: 'teams' as const, label: 'Provision' },
    { key: 'users' as const, label: 'Users' },
  ]
  const staffTabs = [
    { key: 'usage' as const, label: 'Usage' },
    { key: 'admins' as const, label: 'Admins' },
    { key: 'teams' as const, label: 'Teams' },
    { key: 'users' as const, label: 'Users' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <AppLogo variant="light" width={120} />
          <span className="text-gray-600">·</span>
          <span className="text-sm text-gray-400">
            {isOwnerView ? 'Ops console' : 'Admin'}
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {isOwnerView && (
            <Link
              href="/owner"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-gray-800 rounded-md transition-colors"
            >
              Owner portfolio
            </Link>
          )}
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
          >
            <ArrowLeft size={13} />
            Back to map
          </Link>
        </nav>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {isOwnerView && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="font-serif text-2xl font-bold text-gray-900">
                Ops console
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Provision teams, manage staff admins, and review flagged deeds.
                Cross-team spend lives on the Owner portfolio.
              </p>
            </div>
            <Link
              href="/owner"
              className="shrink-0 inline-flex px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600"
            >
              Open owner portfolio →
            </Link>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
            {(isOwnerView ? ownerTabs : staffTabs).map((t) => (
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

        {tab === 'overview' ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <UsageCard
                label="Teams"
                icon={<Users size={18} className="text-gray-400" />}
                value={loading ? '—' : activeTeams.toLocaleString()}
                hint="Provisioned customer workspaces"
                sub={`${stats.totalUsers} total users on platform`}
              />
              <UsageCard
                label="Platform $"
                icon={<DollarSign size={18} className="text-emerald-500" />}
                value={loading ? '—' : `$${fee.toLocaleString()}`}
                hint={`Est. 10% success fee · ${currentMonth}`}
                sub={`Closed volume $${loading ? '—' : volume.toLocaleString()}`}
              />
              <UsageCard
                label="Calls"
                icon={<Phone size={18} className="text-amber-500" />}
                value={loading ? '—' : callClicks.toLocaleString()}
                hint={`${currentMonth} · all teams`}
                sub={`Skip traces: ${loading ? '—' : skipTraces.toLocaleString()}`}
              />
              <UsageCard
                label="Email"
                icon={<Mail size={18} className="text-blue-500" />}
                value={loading ? '—' : emailsSent.toLocaleString()}
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
                    Spending and activity rolled up by team admin workspace
                  </p>
                </div>
                <span className="text-xs text-gray-400">{teamRows.length} teams</span>
              </div>
              {loading ? (
                <div className="p-8 text-center text-sm text-gray-400">Loading...</div>
              ) : teamRows.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">
                  No teams yet. Provision a team admin under Provision.
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
                          'Est. fee (10%)',
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
                            <div className="text-xs text-gray-400 font-normal">
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

            {usage?.warnings && usage.warnings.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Some metrics may be incomplete: {usage.warnings.join(' · ')}
              </div>
            )}
          </>
        ) : tab === 'usage' ? (
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

            <div className="bg-gray-900 rounded-xl p-5 flex items-center justify-between flex-wrap gap-4 mb-6">
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

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-serif text-lg font-bold text-gray-900">
                  Spending by team — {currentMonth}
                </h2>
                <span className="text-xs text-gray-400">
                  {(usage?.teams ?? []).length} teams
                </span>
              </div>
              {loading ? (
                <div className="p-8 text-center text-sm text-gray-400">Loading...</div>
              ) : (usage?.teams ?? []).length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">
                  No team activity this month yet. Provision teams under the Teams tab.
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
                          'Est. fee (10%)',
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
                      {(usage?.teams ?? []).map((team) => (
                        <tr key={team.owner_id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 text-sm font-medium text-gray-900">
                            {team.owner_email}
                            <div className="text-xs text-gray-400 font-normal">
                              {team.member_count} member{team.member_count === 1 ? '' : 's'}
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
          </>
        ) : tab === 'admins' ? (
          <>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
              <h2 className="font-serif text-lg font-bold text-gray-900 mb-1">
                Owner console — track every admin
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                <strong className="text-gray-700">Owner</strong>{' '}
                (management@mineralmapllc.com) sits above every other admin.
                Platform admins can open this console. Team admins run customer
                workspaces and cannot see Owner/Admin pages.
              </p>
              {viewerIsOwner ? (
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="flex flex-col gap-1 min-w-[220px] flex-1">
                    <span className="text-xs text-gray-500">Grant platform admin</span>
                    <input
                      type="email"
                      value={grantAdminEmail}
                      onChange={(e) => setGrantAdminEmail(e.target.value)}
                      placeholder="staff@mineralmapllc.com"
                      className="text-sm border border-gray-200 rounded-lg px-3 py-2"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={grantingAdmin || !grantAdminEmail.trim()}
                    onClick={() => {
                      void handleGrantAdmin()
                    }}
                    className="px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
                  >
                    {grantingAdmin ? 'Granting…' : 'Add admin'}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Only the owner account can grant or revoke platform admins.
                </p>
              )}
              {grantAdminMsg && (
                <p className="mt-3 text-sm text-gray-600">{grantAdminMsg}</p>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-serif text-lg font-bold text-gray-900">All admins</h2>
                <span className="text-xs text-gray-400">{admins.length} accounts</span>
              </div>
              {loading ? (
                <div className="p-8 text-center text-sm text-gray-400">Loading...</div>
              ) : admins.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">
                  No admin accounts found yet.
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        {['Email', 'Role', 'Seats', 'Last sign-in', ''].map((h) => (
                          <th
                            key={h || 'actions'}
                            className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {admins.map((admin) => (
                        <tr key={admin.id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 text-sm font-medium text-gray-900">
                            {admin.email}
                          </td>
                          <td className="px-5 py-3">
                            <span
                              className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded-full border ${
                                admin.role === 'platform_owner'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : admin.role === 'platform_admin'
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                              }`}
                            >
                              {admin.role_label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-600">
                            {admin.seats_used != null
                              ? `${admin.seats_used}/${admin.seat_count || '—'}`
                              : '—'}
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-500">
                            {admin.last_sign_in_at
                              ? new Date(admin.last_sign_in_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })
                              : '—'}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {admin.can_revoke && (
                              <button
                                type="button"
                                onClick={() => {
                                  void handleRevokeAdmin(admin.id, admin.email)
                                }}
                                className="text-xs font-semibold text-red-600 hover:text-red-700"
                              >
                                Revoke
                              </button>
                            )}
                            {admin.is_owner && (
                              <span className="text-xs text-gray-400">Protected</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : tab === 'teams' ? (
          <>
            <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-5 mb-6">
              <h2 className="font-serif text-lg font-bold text-gray-900 mb-1">
                Grandfather existing users
              </h2>
              <p className="text-sm text-gray-500 mb-3">
                Current accounts stay free when the paywall turns on — no $100
                seat fee and no $0.50 skip-trace charges. New signups after this
                still pay both. After running, users may need to sign out/in (or
                wait for token refresh) before complimentary status appears.
              </p>
              {grandfatherStats && (
                <p className="text-sm text-gray-600 mb-4">
                  {grandfatherStats.billing_exempt}/{grandfatherStats.total_users}{' '}
                  already complimentary
                  {grandfatherStats.need_grandfather > 0
                    ? ` · ${grandfatherStats.need_grandfather} still need it`
                    : ' · all set'}
                </p>
              )}
              <button
                type="button"
                disabled={grandfathering}
                onClick={() => {
                  void handleGrandfatherExisting()
                }}
                className="px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {grandfathering ? 'Grandfathering…' : 'Grandfather existing users'}
              </button>
              {grandfatherMsg && (
                <p className="mt-3 text-sm text-gray-600">{grandfatherMsg}</p>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
              <h2 className="font-serif text-lg font-bold text-gray-900 mb-1">
                Provision team admin
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Assign a customer team admin and seat count when onboarding.
                That admin invites members from Account. Members cannot open this console.
              </p>
              <div className="flex flex-wrap gap-2 items-end">
                <label className="flex flex-col gap-1 min-w-[220px] flex-1">
                  <span className="text-xs text-gray-500">Team admin email</span>
                  <input
                    type="email"
                    value={provisionEmail}
                    onChange={(e) => setProvisionEmail(e.target.value)}
                    placeholder="admin@brokerage.com"
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1 w-28">
                  <span className="text-xs text-gray-500">Seats</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={provisionSeats}
                    onChange={(e) => setProvisionSeats(Number(e.target.value) || 1)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2"
                  />
                </label>
                <button
                  type="button"
                  disabled={provisioning || !provisionEmail.trim()}
                  onClick={() => {
                    void handleProvisionTeam()
                  }}
                  className="px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
                >
                  {provisioning ? 'Provisioning…' : 'Assign admin'}
                </button>
              </div>
              {provisionMsg && (
                <p className="mt-3 text-sm text-gray-600">{provisionMsg}</p>
              )}
              <p className="mt-3 text-xs text-gray-400">
                Seats include the admin (e.g. 4 seats = 1 admin + 3 members).
              </p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-serif text-lg font-bold text-gray-900">Provisioned teams</h2>
                <span className="text-xs text-gray-400">{teams.length} teams</span>
              </div>
              {loading ? (
                <div className="p-8 text-center text-sm text-gray-400">Loading...</div>
              ) : teams.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">
                  No teams provisioned yet. Assign an admin above.
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        {['Team admin', 'Seats used', 'Seat limit', 'Members', ''].map((h) => (
                          <th
                            key={h || 'actions'}
                            className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {teams.map((team) => (
                        <tr key={team.owner_id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 text-sm font-medium text-gray-900">
                            {team.owner_email}
                            {team.is_platform_admin && (
                              <span className="ml-2 text-[10px] font-semibold uppercase text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                staff
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-600">
                            {team.seats_used}
                          </td>
                          <td className="px-5 py-3">
                            <input
                              type="number"
                              min={team.seats_used}
                              max={100}
                              defaultValue={team.seat_count}
                              key={`${team.owner_id}-${team.seat_count}`}
                              onBlur={(e) => {
                                const next = Number(e.target.value) || team.seat_count
                                if (next !== team.seat_count) {
                                  void handleUpdateSeats(team.owner_id, next)
                                }
                              }}
                              className="w-20 text-sm border border-gray-200 rounded-md px-2 py-1"
                            />
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-500">
                            {team.members.length === 0
                              ? '—'
                              : team.members
                                  .map((m) => `${m.email} (${m.status})`)
                                  .join(', ')}
                          </td>
                          <td className="px-5 py-3 text-xs text-gray-400 capitalize">
                            {team.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Total users', val: stats.totalUsers, icon: <Users size={18} className="text-gray-400" /> },
                {
                  label: 'Complimentary',
                  val: stats.billingExempt ?? 0,
                  icon: <CreditCard size={18} className="text-emerald-500" />,
                },
                {
                  label: 'Active subscribers',
                  val: stats.activeSubscribers,
                  icon: <TrendingUp size={18} className="text-blue-500" />,
                },
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
                            {user.billing_exempt ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">
                                complimentary
                              </span>
                            ) : (
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColor(user.subscription_status)}`}
                              >
                                {user.subscription_status || 'none'}
                              </span>
                            )}
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
