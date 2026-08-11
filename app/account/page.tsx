'use client'

// Account page — restructured 2026-07-20, team seats 2026-08-04.
//
// Free-until-you-close model (10% success fee). Team seats are
// provisioned by Mineral Map platform admins: we assign a team admin
// + seat count, then that admin invites members from this page.
// Members cannot manage seats and cannot access /admin.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { User, LogOut, MapPin, BarChart2, FileText, Shield, LifeBuoy } from 'lucide-react'
import AppLogo from '@/app/components/AppLogo'
import {
  inviteSeatCapacity,
  resolveTeamRole,
  type TeamRole,
} from '@/lib/team'

export const dynamic = 'force-dynamic'

type TeamMemberRow = {
  id: string
  invite_email: string
  status: 'pending' | 'accepted' | 'revoked' | string
}

type SubRow = {
  status?: string | null
  seat_count?: number | null
  team_owner_id?: string | null
}

export default function Account() {
  const supabase = useMemo(
    () =>
      createClient(),
    []
  )
  const [user, setUser] = useState<{
    id?: string
    email?: string
    created_at?: string
    user_metadata?: Record<string, unknown>
  } | null>(null)
  const [subscription, setSubscription] = useState<SubRow | null>(null)
  const [skipTraceCount, setSkipTraceCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordForm, setPasswordForm] = useState({ new: '', confirm: '' })
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState('')
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null)

  const teamRole: TeamRole = useMemo(
    () =>
      resolveTeamRole({
        metadata: user?.user_metadata,
        email: user?.email,
        subscription,
      }),
    [user?.user_metadata, user?.email, subscription],
  )

  const seatCount = Number(subscription?.seat_count ?? 0)
  const inviteCapacity = inviteSeatCapacity(seatCount)
  const seatsUsed =
    teamRole === 'team_admin' ||
    teamRole === 'platform_admin' ||
    teamRole === 'platform_owner'
      ? 1 + teamMembers.length
      : 0

  const fetchTeamMembers = useCallback(
    async (ownerId: string) => {
      const { data } = await supabase
        .from('team_members')
        .select('id, invite_email, status')
        .eq('owner_id', ownerId)
        .neq('status', 'revoked')
        .order('created_at', { ascending: false })
      setTeamMembers((data as TeamMemberRow[] | null) ?? [])
    },
    [supabase]
  )

  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setSkipTraceCount(0)
        setTeamMembers([])
        setLoading(false)
        return
      }
      setUser(session.user)

      const currentMonth = new Date().toISOString().slice(0, 7)
      const { data: usage } = await supabase
        .from('skip_trace_usage')
        .select('count')
        .eq('user_id', session.user.id)
        .eq('month', currentMonth)
        .maybeSingle()
      setSkipTraceCount((usage as { count?: number } | null)?.count ?? 0)

      const { data: sub } = await supabase
        .from('subscriptions')
        .select('status, seat_count, team_owner_id')
        .eq('user_id', session.user.id)
        .maybeSingle()
      setSubscription((sub as SubRow | null) ?? null)

      const metaOwner = String(session.user.user_metadata?.team_owner_id ?? '').trim()
      const subOwner = String((sub as SubRow | null)?.team_owner_id ?? '').trim()
      const teamOwnerId = metaOwner || subOwner

      if (teamOwnerId) {
        // Member view — do not load invite management.
        setTeamMembers([])
        // Best-effort owner email for display (may be blocked by RLS).
        const { data: ownerRows } = await supabase
          .from('team_members')
          .select('owner_id, invite_email')
          .eq('owner_id', teamOwnerId)
          .eq('invite_email', (session.user.email ?? '').toLowerCase())
          .maybeSingle()
        void ownerRows
        setOwnerEmail(null)
      } else {
        await fetchTeamMembers(session.user.id)
      }

      setLoading(false)
    }
    void load()
  }, [fetchTeamMembers, supabase])

  const handlePasswordChange = async () => {
    if (passwordForm.new !== passwordForm.confirm) {
      setPasswordMsg('Passwords do not match')
      return
    }
    if (passwordForm.new.length < 8) {
      setPasswordMsg('Password must be at least 8 characters')
      return
    }
    const { error } = await supabase.auth.updateUser({ password: passwordForm.new })
    if (error) {
      setPasswordMsg(error.message)
    } else {
      setPasswordMsg('Password updated successfully')
      setPasswordForm({ new: '', confirm: '' })
    }
  }

  const handleSignOut = async () => {
    const { clearWorkspaceCache } = await import('@/lib/workspace')
    clearWorkspaceCache()
    await supabase.auth.signOut()
    window.location.href = '/landing'
  }

  const handleInvite = async () => {
    if (!inviteEmail || !user?.id) return
    setInviting(true)
    setInviteMessage('')
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail }),
      })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (data.success) {
        setInviteMessage(`Invite sent to ${inviteEmail}`)
        setInviteEmail('')
        await fetchTeamMembers(user.id)
      } else {
        setInviteMessage(data.error ?? 'Failed to send invite')
      }
    } catch {
      setInviteMessage('Failed to send invite')
    } finally {
      setInviting(false)
    }
  }

  const handleRevoke = async (email: string) => {
    if (!user?.id) return
    await supabase
      .from('team_members')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('owner_id', user.id)
      .eq('invite_email', email)
    await fetchTeamMembers(user.id)
  }

  const canManageTeam =
    teamRole === 'team_admin' ||
    teamRole === 'platform_admin' ||
    teamRole === 'platform_owner'
  const isMember = teamRole === 'team_member'
  const isStaffAdmin = teamRole === 'platform_admin' || teamRole === 'platform_owner'
  const isOwner = teamRole === 'platform_owner'
  const isTeamAdminOnly = teamRole === 'team_admin'

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-3">
          <AppLogo width={130} variant="light" />
          <span className="text-gray-600 text-sm">·</span>
          <span className="text-sm font-medium text-gray-400">Account</span>
        </div>
        <nav className="flex items-center gap-1">
          <Link href="/" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">
            <MapPin size={13} />Map
          </Link>
          <Link href="/crm" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">
            <BarChart2 size={13} />CRM
          </Link>
          <Link href="/help" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">
            <LifeBuoy size={13} />Help
          </Link>
          {isTeamAdminOnly && (
            <Link href="/team" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-gray-800 rounded-md transition-colors">
              <BarChart2 size={13} />Team
            </Link>
          )}
          {isOwner && (
            <>
              <Link href="/owner" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-gray-800 rounded-md transition-colors">
                <Shield size={13} />Owner
              </Link>
              <Link href="/admin" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">
                Ops
              </Link>
            </>
          )}
          {isStaffAdmin && !isOwner && (
            <Link href="/admin" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-gray-800 rounded-md transition-colors">
              <Shield size={13} />Admin
            </Link>
          )}
          <button onClick={handleSignOut} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors">
            <LogOut size={13} />Sign out
          </button>
        </nav>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* ── Identity ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
              <User size={20} className="text-amber-600" />
            </div>
            <div>
              <div className="font-serif text-lg font-bold text-gray-900">{user?.email ?? '—'}</div>
              <div className="text-sm text-gray-400">
                Member since{' '}
                {user?.created_at
                  ? new Date(user.created_at).toLocaleDateString('en-US', {
                    month: 'long',
                    year: 'numeric',
                  })
                  : '—'}
              </div>
              <div className="mt-1">
                <span
                  className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded-full border ${
                    isOwner
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {isOwner
                    ? 'Owner'
                    : teamRole === 'platform_admin'
                      ? 'Platform admin'
                      : canManageTeam
                        ? 'Team admin'
                        : isMember
                          ? 'Team member'
                          : 'Individual'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {isOwner && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-5 shadow-sm">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs font-bold text-amber-800 uppercase tracking-widest mb-2">
                  Platform owner
                </div>
                <h2 className="font-serif text-xl font-bold text-gray-900">
                  Owner portfolio
                </h2>
                <p className="text-sm text-gray-600 mt-1 max-w-md">
                  Cross-team activity, estimated success-fee spend, and every
                  customer account — reserved for management@mineralmapllc.com.
                </p>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <Link
                  href="/owner"
                  className="inline-flex justify-center px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600"
                >
                  Open owner portfolio →
                </Link>
                <Link
                  href="/admin?tab=teams"
                  className="inline-flex justify-center px-4 py-2 text-sm font-semibold text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100"
                >
                  Provision teams
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* ── Billing (free plan + 10% success fee) ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">
            Billing
          </div>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="font-serif text-base font-bold text-gray-900 mb-1">
                Free plan — you pay on close
              </div>
              <div className="text-sm text-gray-500 leading-relaxed">
                No monthly fee, no per-seat charge, no data subscription.
                When a Platform Lead you sourced through Mineral Map closes,
                we invoice a 10% success fee. Attribution rules and terms
                are spelled out in the Platform Services Agreement.
              </div>
            </div>
            <span className="shrink-0 text-xs font-semibold px-3 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
              Active
            </span>
          </div>
          <Link
            href="/legal/agreement"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700"
          >
            <FileText size={13} />
            Read the Platform Services Agreement
          </Link>
        </div>

        {/* ── Usage (informational, no cap) ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">
            Usage
          </div>
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-sm text-gray-500">Skip traces this month</div>
              <div className="text-xs text-gray-400 mt-1">Unlimited — resets on the 1st of each month.</div>
            </div>
            <div className="font-serif text-2xl font-bold text-gray-900 tabular-nums">
              {loading ? '—' : (skipTraceCount ?? 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* ── Team seats ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 shadow-sm">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Team
            </div>
            {isTeamAdminOnly && (
              <Link
                href="/team"
                className="text-xs font-semibold text-amber-700 hover:text-amber-800"
              >
                Open team dashboard →
              </Link>
            )}
          </div>

          {isMember ? (
            <div>
              <p className="text-sm text-gray-600 mb-2">
                You&apos;re on a team workspace as a <strong>member</strong>.
              </p>
              <p className="text-sm text-gray-500">
                Your team admin manages seats and invites. Members can use the
                map and CRM, but cannot open the platform Admin console.
                {ownerEmail ? ` Admin: ${ownerEmail}.` : ''}
              </p>
            </div>
          ) : canManageTeam ? (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <p className="text-sm text-gray-500">
                  Invite teammates to your workspace. They get map + CRM access
                  but cannot see the Admin page.
                </p>
                <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                  {seatsUsed}/{seatCount || '—'} seats
                </span>
              </div>

              <div className="flex gap-2 mb-4">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                />
                <button
                  onClick={() => {
                    void handleInvite()
                  }}
                  disabled={inviting || !inviteEmail || teamMembers.length >= inviteCapacity}
                  className="px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
                >
                  {inviting ? 'Sending...' : 'Send invite'}
                </button>
              </div>

              {inviteCapacity < 1 && (
                <p className="text-sm text-amber-700 mb-4">
                  No member seats available. Ask Mineral Map to increase your seat count.
                </p>
              )}

              {inviteMessage && <p className="text-sm text-gray-500 mb-4">{inviteMessage}</p>}

              {teamMembers.length > 0 ? (
                <div className="space-y-2">
                  {teamMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-900">{member.invite_email}</div>
                        <div className="text-xs text-gray-400 capitalize">{member.status}</div>
                      </div>
                      <button
                        onClick={() => {
                          void handleRevoke(member.invite_email)
                        }}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No team members yet.</p>
              )}
            </>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-2">
                Team seats are assigned by Mineral Map when we onboard your group.
              </p>
              <p className="text-sm text-gray-500">
                Once you&apos;re set as a team admin, you can invite members from this page.
                Contact us if you need a multi-seat workspace.
              </p>
            </div>
          )}
        </div>

        {/* ── Password ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">
            Change Password
          </div>
          <div className="space-y-3 mb-4">
            {[
              { label: 'New password', field: 'new' },
              { label: 'Confirm new password', field: 'confirm' },
            ].map((f) => (
              <div key={f.field}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
                <input
                  type="password"
                  value={passwordForm[f.field as keyof typeof passwordForm]}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, [f.field]: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all"
                />
              </div>
            ))}
          </div>
          {passwordMsg && (
            <div className={`text-xs mb-3 ${passwordMsg.includes('successfully') ? 'text-emerald-600' : 'text-red-500'}`}>
              {passwordMsg}
            </div>
          )}
          <button
            onClick={handlePasswordChange}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Update password
          </button>
        </div>

        {/* ── Help ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">
            Help desk
          </div>
          <p className="text-sm text-gray-600 mb-4 leading-relaxed">
            Need a hand with the map, seats, or billing? Submit a ticket and it
            goes straight to management@mineralmapllc.com.
          </p>
          <Link
            href="/help"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors"
          >
            <LifeBuoy size={14} />
            Open help desk
          </Link>
        </div>

        {/* ── Session ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">
            Session
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
