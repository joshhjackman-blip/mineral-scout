'use client'

import { useState } from 'react'
import Link from 'next/link'
import AppLogo from '@/app/components/AppLogo'
import {
  SEAT_PRICE_USD,
  SKIP_TRACE_PRICE_USD,
  formatSeatPrice,
  formatSkipTracePrice,
} from '@/lib/billing'

export default function PricingPage() {
  const [seats, setSeats] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const monthlySeats = seats * SEAT_PRICE_USD

  const startCheckout = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seats }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setError(data.error || 'Could not start checkout')
        setLoading(false)
        return
      }
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #0F172A 0%, #1E293B 45%, #0F172A 100%)',
        color: '#F8FAFC',
        fontFamily: 'Geist, Inter, system-ui, sans-serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 28px',
          borderBottom: '1px solid rgba(148,163,184,0.2)',
        }}
      >
        <Link href="/landing" style={{ textDecoration: 'none' }}>
          <AppLogo />
        </Link>
        <Link
          href="/auth"
          style={{ color: '#CBD5E1', fontSize: 13, textDecoration: 'none' }}
        >
          Sign in
        </Link>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '56px 24px 80px' }}>
        <p
          style={{
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#94A3B8',
            marginBottom: 12,
          }}
        >
          Pricing
        </p>
        <h1
          style={{
            fontFamily: 'Georgia, "Iowan Old Style", serif',
            fontSize: 'clamp(32px, 5vw, 44px)',
            fontWeight: 500,
            lineHeight: 1.15,
            margin: '0 0 12px',
          }}
        >
          Low seat cost. Pay for skip-trace only when you use it.
        </h1>
        <p style={{ color: '#94A3B8', fontSize: 16, lineHeight: 1.55, marginBottom: 36 }}>
          {formatSeatPrice()}. {formatSkipTracePrice()} — shared cache hits across
          teams are free, so you never pay twice for the same owner.
        </p>

        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(148,163,184,0.25)',
            borderRadius: 16,
            padding: 28,
          }}
        >
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 28 }}>
            <div style={{ flex: '1 1 200px' }}>
              <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 6 }}>Seat</div>
              <div style={{ fontSize: 28, fontWeight: 600 }}>${SEAT_PRICE_USD}<span style={{ fontSize: 14, color: '#94A3B8' }}>/mo</span></div>
              <div style={{ fontSize: 13, color: '#CBD5E1', marginTop: 6 }}>
                Map, CRM, permits, owner intel
              </div>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 6 }}>Skip-trace</div>
              <div style={{ fontSize: 28, fontWeight: 600 }}>${SKIP_TRACE_PRICE_USD.toFixed(2)}<span style={{ fontSize: 14, color: '#94A3B8' }}>/call</span></div>
              <div style={{ fontSize: 13, color: '#CBD5E1', marginTop: 6 }}>
                Only billed on live lookups — cache hits $0
              </div>
            </div>
          </div>

          <label style={{ display: 'block', fontSize: 12, color: '#94A3B8', marginBottom: 8 }}>
            Seats
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <input
              type="number"
              min={1}
              max={100}
              value={seats}
              onChange={(e) => setSeats(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
              style={{
                width: 88,
                height: 40,
                borderRadius: 8,
                border: '1px solid rgba(148,163,184,0.35)',
                background: '#0F172A',
                color: '#F8FAFC',
                padding: '0 12px',
                fontSize: 16,
              }}
            />
            <span style={{ color: '#CBD5E1', fontSize: 14 }}>
              = <strong style={{ color: '#F8FAFC' }}>${monthlySeats}/mo</strong> platform
              {seats > 1 ? ` for ${seats} seats` : ''}
            </span>
          </div>

          {error && (
            <div
              style={{
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.35)',
                color: '#FECACA',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => void startCheckout()}
            disabled={loading}
            style={{
              width: '100%',
              height: 48,
              border: 'none',
              borderRadius: 10,
              background: loading ? '#64748B' : '#EF9F27',
              color: '#0F172A',
              fontWeight: 700,
              fontSize: 15,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? 'Redirecting to Stripe…' : 'Start subscription'}
          </button>
          <p style={{ fontSize: 12, color: '#64748B', marginTop: 14, lineHeight: 1.5 }}>
            You must be signed in. Skip-trace usage is metered at period end.
            Manage seats and billing anytime from Account.
          </p>
        </div>
      </main>

      <footer
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '0 24px 48px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          fontSize: 12,
        }}
      >
        <Link href="/legal/privacy" style={{ color: '#94A3B8', textDecoration: 'none' }}>
          Privacy
        </Link>
        <Link href="/legal/terms" style={{ color: '#94A3B8', textDecoration: 'none' }}>
          Terms
        </Link>
        <Link href="/legal/agreement" style={{ color: '#94A3B8', textDecoration: 'none' }}>
          Agreement
        </Link>
      </footer>
    </div>
  )
}
