'use client'

import { useState } from 'react'
import Link from 'next/link'
import AppLogo from '@/app/components/AppLogo'

const features = [
  'Full county GIS parcel map',
  '73,000+ scored mineral owners',
  '12-signal propensity scoring',
  'CRM & acquisition pipeline',
  'Skip tracing',
  'Comp calculator',
  'CSV export for direct mail',
  'Horizontal well classification',
]

export default function Pricing() {
  const [loading, setLoading] = useState(false)

  const handleCheckout = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout', { method: 'POST' })
      const data = (await res.json()) as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      if (res.status === 401) {
        window.location.href = '/auth'
        return
      }
      setLoading(false)
      alert(data.error ?? 'Unable to start checkout')
    } catch {
      setLoading(false)
      alert('Unable to start checkout')
    }
  }

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ background: '#0b0f1c', minHeight: '100vh', fontFamily: "'DM Sans', sans-serif" }}>
        <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 52px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Link href="/landing" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
            <AppLogo width={165} variant="light" />
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href="/landing" style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '7px 16px', textDecoration: 'none', fontWeight: 500 }}>← Back to landing</Link>
            <Link href="/auth" style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '7px 16px', textDecoration: 'none', fontWeight: 500 }}>Sign in</Link>
          </div>
        </nav>

        <div style={{ textAlign: 'center', padding: '64px 52px 48px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid rgba(239,159,39,0.22)', borderRadius: 30, padding: '5px 14px', marginBottom: 24 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#EF9F27' }} />
            <span style={{ fontSize: 12, color: 'rgba(239,159,39,0.85)', fontWeight: 500, letterSpacing: '0.04em' }}>Simple pricing · No contracts</span>
          </div>
          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 44, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: 14 }}>One plan. Everything included.</div>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.35)', maxWidth: 340, margin: '0 auto', lineHeight: 1.65 }}>No tiers, no add-ons. Full access to everything Mineral Map offers.</p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 52px 64px' }}>
          <div style={{ background: 'rgba(239,159,39,0.06)', border: '1px solid rgba(239,159,39,0.25)', borderRadius: 16, padding: '40px 40px 36px', width: 380 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 14 }}>Mineral Map</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 22, color: 'rgba(255,255,255,0.6)', fontWeight: 400 }}>$</span>
              <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 60, color: '#fff', lineHeight: 1, letterSpacing: '-0.02em' }}>399</span>
              <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>/mo</span>
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', marginBottom: 32, marginTop: 6 }}>Billed monthly · Cancel anytime</div>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', marginBottom: 28 }} />
            <ul style={{ listStyle: 'none', marginBottom: 36, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {features.map((f) => (
                <li key={f} style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(239,159,39,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF9F27' }} />
                  </div>
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => {
                void handleCheckout()
              }}
              disabled={loading}
              style={{
                display: 'block',
                width: '100%',
                padding: 14,
                background: '#EF9F27',
                borderRadius: 9,
                fontSize: 14,
                fontWeight: 500,
                color: '#3a1e00',
                textAlign: 'center',
                textDecoration: 'none',
                letterSpacing: '0.01em',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Loading...' : 'Start 7-day free trial →'}
            </button>
            <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.18)', marginTop: 14 }}>7-day free trial · then $399/mo · cancel anytime</div>
          </div>
        </div>

        <div style={{ textAlign: 'center', paddingBottom: 48, fontSize: 12, color: 'rgba(255,255,255,0.15)' }}>mineralmap.io · Eagle Ford Basin</div>
      </div>
    </>
  )
}
