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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)

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

    window.location.href = '/'
  }

  const isLogin = mode === 'login'

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="si-form-title fade-up fade-up-1">
        {isLogin ? 'Sign in' : 'Create account'}
      </div>
      <div className="si-form-subtitle fade-up fade-up-2">
        {isLogin
          ? 'Access your Mineral Map workspace.'
          : 'Request access to Mineral Map.'}
      </div>

      {isInvite && (
        <InfoMessage
          message={`Team invite detected for ${email}. Complete sign-in or sign-up to accept.`}
        />
      )}

      {error && <ErrorMessage message={error} />}
      {message && !isInvite && <InfoMessage message={message} />}

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
        />
      </div>

      <div className="si-form-group fade-up fade-up-3">
        <label className="si-form-label" htmlFor="password">Password</label>
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

      <button
        type="submit"
        className="si-btn-submit fade-up fade-up-4"
        disabled={loading}
      >
        {loading ? (
          <>
            <span className="si-spinner" /> {isLogin ? 'Signing in…' : 'Creating account…'}
          </>
        ) : (
          isLogin ? 'Sign in →' : 'Create account →'
        )}
      </button>

      <div className="si-form-divider fade-up fade-up-5" />

      <div className="si-form-request fade-up fade-up-5">
        {isLogin ? (
          <>
            New to Mineral Map?{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setMode('signup')
                setError(null)
                setMessage(null)
              }}
            >
              Request access →
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
    </form>
  )
}

// ── Sign In Page ──────────────────────────────────────────────────────────────

export default function SignInPage() {
  return (
    <div className="si-root">
      <div className="si-page">
        {/* Left branding panel — background is the Permian photo
            attached in signin.css. Prior SVG grid + glow blobs
            removed on request; the photo speaks for itself. */}
        <div className="si-left-panel">
          <div className="si-left-logo">
            <a href="/landing">
              <img src="/mineral-map-logo-light.svg" alt="Mineral Map" />
            </a>
          </div>
          <div className="si-left-content">
            <div className="si-left-eyebrow">Mineral Acquisition Intelligence</div>
            <h1 className="si-left-headline">
              Find the right owners<br />
              <em>before anyone else.</em>
            </h1>
            <p className="si-left-sub">
              County ownership data, well context, and motivation scoring —
              combined into one acquisition platform.
            </p>
          </div>
          <div className="si-left-footer">
            <a href="/landing">← Back to landing</a>
            <a href="https://getmineralmap.com/pricing">Pricing</a>
          </div>
        </div>

        {/* Right form panel */}
        <div className="si-right-panel">
          <div className="si-form-card">
            <SignInForm />
          </div>
        </div>
      </div>
    </div>
  )
}
