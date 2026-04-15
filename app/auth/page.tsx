'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AppLogo from '@/app/components/AppLogo'

export const dynamic = 'force-dynamic'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [inviteOwnerId, setInviteOwnerId] = useState<string | null>(null)
  const [isInvite, setIsInvite] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const inviteOwnerParam = params.get('invite')
    const inviteEmail = params.get('email')
    if (inviteOwnerParam && inviteEmail) {
      setEmail(decodeURIComponent(inviteEmail))
      setInviteOwnerId(inviteOwnerParam)
      setIsInvite(true)
      setMode('signup')
      setMessage(
        'You were invited to join a team account. Sign in or create your account to accept.'
      )
    }
  }, [])

  const handleSubmit = async () => {
    console.log('handleSubmit called', { email, password, mode })
    setLoading(true)
    setError(null)
    setMessage(null)

    const authResponse =
      mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })
    const { data, error } = authResponse
    console.log('Supabase response:', { data, error })

    if (error) {
      console.error('Auth error:', error.message, error.status)
      setError(error.message)
    } else {
      if (inviteOwnerId && data.session) {
        const acceptRes = await fetch('/api/team/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId: inviteOwnerId }),
        })
        if (!acceptRes.ok) {
          const acceptData = (await acceptRes.json().catch(() => ({}))) as {
            error?: string
          }
          setError(acceptData.error ?? 'Failed to accept invite')
          setLoading(false)
          return
        }
      }

      if (mode === 'signup' && !data.session) {
        setMessage('Check your email to confirm your account, then sign in to continue.')
        setLoading(false)
        return
      }

      console.log('Login success, redirecting...')
      window.location.href = '/'
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-4">
          <Link
            href="/landing"
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded-md px-3 py-1.5 transition-colors"
          >
            ← Back to landing
          </Link>
        </div>
        <div className="flex items-center justify-center mb-8">
          <AppLogo width={220} variant="light" />
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <h2 className="font-serif text-xl font-bold text-gray-900 mb-1">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {mode === 'login' ? 'Access your Mineral Map workspace.' : 'Request access to Mineral Map.'}
          </p>
          {isInvite && (
            <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              Team invite detected for {email}. Complete login/signup to accept.
            </div>
          )}

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              {message}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="you@company.com"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition-all"
              />
            </div>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              {loading ? 'Loading...' : mode === 'login' ? 'Sign in →' : 'Create account →'}
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <button
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login')
                setError(null)
              }}
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              {mode === 'login' ? 'New to Mineral Map? Request access →' : 'Already have an account? Sign in →'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-500 mt-6">
          Gonzales County, TX · Eagle Ford Basin
        </p>
      </div>
    </div>
  )
}
