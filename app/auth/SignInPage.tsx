'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import './signin.css'

// (OilFieldSVG removed 2026-07-17 — the schematic pumpjacks / arrows
//  distracted from the Permian photo background. Design intent is now
//  "photo + typography", no illustration overlay.)

// ── Error / Info Messages ─────────────────────────────────────────────────────

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="si-form-error">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {message}
    </div>
  )
}

function InfoMessage({ message }: { message: string }) {
  return (
    <div className="si-form-info">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      {message}
    </div>
  )
}

// ── Sign In Form ──────────────────────────────────────────────────────────────

function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup' | 'set-password'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [inviteOwnerId, setInviteOwnerId] = useState<string | null>(null)
  const [nextPath, setNextPath] = useState('/')

  const acceptInvite = async (ownerId?: string | null) => {
    const res = await fetch('/api/team/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ownerId ? { ownerId } : {}),
    })
    if (!res.ok) {
      if (!ownerId && res.status === 404) return
      const acceptData = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(acceptData.error ?? 'Failed to accept invite')
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const inviteOwnerParam = params.get('invite')
    const inviteEmail = params.get('email')
    const welcome = params.get('welcome')
    const nextParam = params.get('next')
    if (nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')) {
      setNextPath(nextParam)
    } else if (welcome === 'admin') {
      setNextPath('/account')
    } else if (welcome === 'ops') {
      setNextPath('/admin')
    }
    if (inviteOwnerParam && inviteEmail) {
      setEmail(decodeURIComponent(inviteEmail))
      setInviteOwnerId(inviteOwnerParam)
      setMode('signup')
      setMessage(
        'You were invited to a team. Choose a password if this is your first time, or sign in to join.',
      )
    } else if (welcome === 'admin') {
      if (inviteEmail) setEmail(decodeURIComponent(inviteEmail))
      setMessage('You were invited as the team admin. Choose a password to open your workspace.')
    } else if (welcome === 'ops') {
      if (inviteEmail) setEmail(decodeURIComponent(inviteEmail))
      setMessage('You were invited as an operator. Choose a password to continue.')
    } else if (nextParam?.startsWith('/legal/agreement')) {
      setMessage('Sign in to review and accept the Platform Services Agreement.')
    }

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const hashType = hashParams.get('type')
    if (hashType === 'invite' || hashType === 'recovery') {
      setMode('set-password')
      setMessage('Choose a password to finish joining Mineral Map.')
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') &&
        (hashType === 'invite' || hashType === 'recovery' || welcome)
      ) {
        setMode('set-password')
        if (session?.user?.email) setEmail(session.user.email)
      }
    })

    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      if (hashType === 'invite' || hashType === 'recovery' || welcome) {
        setMode('set-password')
        if (data.session.user.email) setEmail(data.session.user.email)
      }
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (mode === 'set-password') {
      if (!password || password.length < 8) {
        setError('Password must be at least 8 characters.')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
      setLoading(true)
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }
      try {
        await acceptInvite(inviteOwnerId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to accept invite')
        setLoading(false)
        return
      }
      window.location.href = nextPath || '/'
      return
    }

    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }

    setLoading(true)

    const authResponse =
      mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })

    const { data, error: authError } = authResponse

    if (authError) {
      console.error('Auth error:', authError.message, authError.status)
      setError(authError.message)
      setLoading(false)
      return
    }

    if (data.session) {
      try {
        await acceptInvite(inviteOwnerId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to accept invite')
        setLoading(false)
        return
      }
    }

    if (mode === 'signup' && !data.session) {
      setMessage('Check your email to confirm your account, then sign in to continue.')
      setLoading(false)
      return
    }

    window.location.href = nextPath || '/'
  }

  const isLogin = mode === 'login'
  const isSetPassword = mode === 'set-password'

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="si-form-title fade-up fade-up-1">
        {isSetPassword ? 'Choose a password' : isLogin ? 'Sign in' : 'Create account'}
      </div>
      <div className="si-form-subtitle fade-up fade-up-2">
        {isSetPassword
          ? 'This finishes your invite. You will land in your workspace after saving.'
          : isLogin
            ? 'Access your Mineral Map workspace.'
            : 'Join with the email you were invited on.'}
      </div>

      {error && <ErrorMessage message={error} />}
      {message && <InfoMessage message={message} />}

      {!isSetPassword && (
        <div className="si-form-group fade-up fade-up-2">
          <label className="si-form-label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="si-form-input"
            placeholder="you@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
            readOnly={Boolean(inviteOwnerId)}
          />
        </div>
      )}

      <div className="si-form-group fade-up fade-up-3">
        <label className="si-form-label" htmlFor="password">
          {isSetPassword ? 'New password' : 'Password'}
        </label>
        <input
          id="password"
          type="password"
          className="si-form-input"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete={isLogin ? 'current-password' : 'new-password'}
        />
      </div>

      {isSetPassword && (
        <div className="si-form-group fade-up fade-up-3">
          <label className="si-form-label" htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            className="si-form-input"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
      )}

      {!isSetPassword && (
        <div className="si-form-row fade-up fade-up-3">
          <button
            type="button"
            className="si-form-mode-toggle"
            onClick={() => {
              setMode(isLogin ? 'signup' : 'login')
              setError(null)
              setMessage(null)
            }}
          >
            {isLogin ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
        </div>
      )}

      <button
        type="submit"
        className="si-btn-submit fade-up fade-up-4"
        disabled={loading}
      >
        {loading ? (
          <>
            <span className="si-spinner" />{' '}
            {isSetPassword ? 'Saving…' : isLogin ? 'Signing in…' : 'Creating account…'}
          </>
        ) : isSetPassword ? (
          'Save password and join →'
        ) : isLogin ? (
          'Sign in →'
        ) : (
          'Join workspace →'
        )}
      </button>

      {!isSetPassword && (
        <>
          <div className="si-form-divider fade-up fade-up-5" />
          <div className="si-form-request fade-up fade-up-5">
            {isLogin ? (
              <>
                Invited to a team? Check your email for the join link, or{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    setMode('signup')
                    setError(null)
                    setMessage(null)
                  }}
                >
                  join here →
                </a>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    setMode('login')
                    setError(null)
                    setMessage(null)
                  }}
                >
                  Sign in →
                </a>
              </>
            )}
          </div>
        </>
      )}
    </form>
  )
}

// ── Sign In Page ──────────────────────────────────────────────────────────────

export default function SignInPage() {
  // Clean, light, card-based layout that matches the in-app chrome
  // (white panels on a slate surface, amber accent, Geist type) instead
  // of the old dark marketing split-screen, which looked out of place.
  return (
    <div className="si-root">
      <div className="si-shell">
        <div className="si-card">
          <div className="si-brand">
            <a href="/landing">
              <img src="/mineral-map-logo.svg" alt="Mineral Map" />
            </a>
          </div>
          <SignInForm />
        </div>
        <div className="si-shell-footer">
          <a href="/landing">← Back to landing</a>
        </div>
      </div>
    </div>
  )
}
