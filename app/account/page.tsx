'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { User, CreditCard, LogOut, MapPin, BarChart2 } from 'lucide-react'
import AppLogo from '@/app/components/AppLogo'

type SubscriptionRow = {
  status?: string | null
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
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' })
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setLoading(false)
        return
      }
      setUser(session.user)

      const { data: sub } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle()
      setSubscription((sub as SubscriptionRow | null) ?? null)
      setLoading(false)
    }
    void load()
  }, [supabase])

  const handleCancelSubscription = async () => {
    if (!confirm('Cancel your subscription? You will lose access at the end of your billing period.')) return
    setCancelLoading(true)
    const res = await fetch('/api/cancel', { method: 'POST' })
    const data = (await res.json()) as { success?: boolean; error?: string }
    if (data.success) {
      setSubscription((prev) => ({ ...(prev ?? {}), status: 'canceling' }))
    } else if (data.error) {
      alert(data.error)
    }
    setCancelLoading(false)
  }

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
      setPasswordForm({ current: '', new: '', confirm: '' })
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/landing'
  }

  const statusColor =
    subscription?.status === 'active'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : subscription?.status === 'canceling'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-red-50 text-red-600 border-red-200'

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-3">
          <AppLogo width={130} />
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
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 shadow-sm">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
              <User size={20} className="text-amber-600" />
            </div>
            <div>
              <div className="font-serif text-lg font-bold text-gray-900">{user?.email}</div>
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

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">
            Subscription
          </div>
          {loading ? (
            <div className="text-sm text-gray-400">Loading...</div>
          ) : subscription ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-serif text-base font-bold text-gray-900 mb-1">Mineral Map · $399/mo</div>
                  <div className="text-sm text-gray-400">Eagle Ford Basin · Gonzales County</div>
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${statusColor}`}>
                  {subscription.status === 'active'
                    ? 'Active'
                    : subscription.status === 'canceling'
                      ? 'Canceling'
                      : subscription.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Plan</div>
                  <div className="text-sm font-medium text-gray-900">Prospector</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Status</div>
                  <div className="text-sm font-medium text-gray-900 capitalize">{subscription.status}</div>
                </div>
              </div>
              {subscription.status === 'active' && (
                <button
                  onClick={handleCancelSubscription}
                  disabled={cancelLoading}
                  className="text-sm text-red-500 hover:text-red-700 hover:underline transition-colors"
                >
                  {cancelLoading ? 'Canceling...' : 'Cancel subscription'}
                </button>
              )}
              {subscription.status === 'canceling' && (
                <div className="text-sm text-amber-600">
                  Your subscription will remain active until the end of your billing period.
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="text-sm text-gray-500 mb-4">No active subscription.</div>
              <Link href="/pricing" className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors">
                <CreditCard size={14} />
                Subscribe — $399/mo
              </Link>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 pb-3 border-b border-gray-100">
            Change Password
          </div>
          <div className="space-y-3 mb-4">
            {[
              { label: 'New password', field: 'new', type: 'password' },
              { label: 'Confirm new password', field: 'confirm', type: 'password' },
            ].map((f) => (
              <div key={f.field}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
                <input
                  type={f.type}
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
