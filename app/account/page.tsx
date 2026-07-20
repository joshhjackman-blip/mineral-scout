'use client'

// Account page — restructured 2026-07-20.
//
// Everything about the old $300/mo Prospector plan / $499/mo Team
// upgrade / 200-skip-trace-cap was cut because the platform runs on
// the free-until-you-close model now (10% success fee on Platform
// Leads, no monthly fee, no seat charge, unlimited skip traces).
// See the Platform Services Agreement + the /landing hero.
//
// Sections in order:
//   1. Identity     — email + member since
//   2. Billing      — Free plan + 10% success fee + link to agreement
//   3. Usage        — skip traces this month, INFORMATIONAL (no cap)
//   4. Team         — open-ended teammate invites, no seat gate
//   5. Password     — change password
//   6. Session      — sign out
//
// The subscriptions Supabase table read was removed from this page.
// If a legacy paid Stripe subscription is still active on your row,
// billing side effects are unchanged; this page just doesn't
// display / offer to cancel it. That's an intentional trade — no
// stale $300/mo copy in the UI while the business model settles.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { User, LogOut, MapPin, BarChart2, FileText } from 'lucide-react'
import AppLogo from '@/app/components/AppLogo'

export const dynamic = 'force-dynamic'

type TeamMemberRow = {
  id: string
  invite_email: string
  status: 'pending' | 'accepted' | 'revoked' | string
}

export default function Account() {
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  )
  const [user, setUser] = useState<{ id?: string; email?: string; created_at?: string } | null>(null)
  const [skipTraceCount, setSkipTraceCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordForm, setPasswordForm] = useState({ new: '', confirm: '' })
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState('')

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

      // Skip trace count — informational only. The 200/mo cap was
      // removed 2026-07-16 (unlimited skip traces), so no gating
      // logic here; we just display the number so a broker knows
      // how much they've used the tool.
      const currentMonth = new Date().toISOString().slice(0, 7)
      const { data: usage } = await supabase
        .from('skip_trace_usage')
        .select('count')
        .eq('user_id', session.user.id)
        .eq('month', currentMonth)
        .maybeSingle()
      setSkipTraceCount((usage as { count?: number } | null)?.count ?? 0)
      await fetchTeamMembers(session.user.id)

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
            </div>
          </div>
        </div>

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

        {/* ── Team members (open-ended, no seat cap) ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">
            Team
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Invite teammates to your workspace. They&apos;ll get the same map,
            CRM, and skip trace access as you.
          </p>

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
              disabled={inviting || !inviteEmail}
              className="px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
            >
              {inviting ? 'Sending...' : 'Send invite'}
            </button>
          </div>

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
