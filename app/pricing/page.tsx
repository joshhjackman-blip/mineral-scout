'use client'

import { useState } from 'react'
import Link from 'next/link'
import AppLogo from '@/app/components/AppLogo'

type Tier = {
  name: string
  price: string
  period: string
  description: string
  seats: string
  features: string[]
  cta: string
  priceId: string | null | undefined
  highlighted: boolean
}

const tiers: Tier[] = [
  {
    name: 'Solo',
    price: '$300',
    period: '/mo',
    description: 'For individual landmen and acquisition professionals',
    seats: '1 seat',
    features: [
      '207 survey abstracts — Gonzales County',
      '73,000+ scored mineral owners',
      'Propensity scoring — 12 signals',
      'Built-in CRM and pipeline',
      '200 skip traces per month',
      'CSV export',
      'Comp calculator',
    ],
    cta: 'Start free trial',
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID,
    highlighted: false,
  },
  {
    name: 'Team',
    price: '$500',
    period: '/mo',
    description: 'For acquisition teams and small funds',
    seats: 'Up to 3 seats',
    features: [
      'Everything in Solo',
      'Up to 3 user logins',
      'Shared CRM pipeline',
      'Shared skip trace pool — 600/mo',
      'Priority access to new counties',
    ],
    cta: 'Start free trial',
    priceId: process.env.NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID,
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For larger operations and multi-county coverage',
    seats: '5+ seats',
    features: [
      'Everything in Team',
      'Unlimited seats',
      'Multi-county access',
      'Dedicated onboarding',
      'Custom data requests',
      'Priority support',
    ],
    cta: 'Contact us',
    priceId: null,
    highlighted: false,
  },
]

export default function Pricing() {
  const [loadingTier, setLoadingTier] = useState<string | null>(null)

  const handleCheckout = async (priceId?: string | null, tierName?: string) => {
    if (!priceId) {
      alert('Missing Stripe price configuration for this tier.')
      return
    }
    setLoadingTier(tierName ?? 'checkout')
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      if (res.status === 401) {
        window.location.href = '/auth'
        return
      }
      setLoadingTier(null)
      alert(data.error ?? 'Unable to start checkout')
    } catch {
      setLoadingTier(null)
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
          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 44, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: 14 }}>Choose the plan that fits your team.</div>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.35)', maxWidth: 560, margin: '0 auto', lineHeight: 1.65 }}>Start with Solo, upgrade to Team when you need shared workflow, or talk to us for Enterprise coverage.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 20, maxWidth: 1120, margin: '0 auto', padding: '20px 52px 64px' }}>
          {tiers.map((tier) => {
            const isEnterprise = tier.name === 'Enterprise'
            const isLoading = loadingTier === tier.name
            return (
              <div
                key={tier.name}
                style={{
                  background: tier.highlighted ? 'rgba(239,159,39,0.08)' : 'rgba(255,255,255,0.02)',
                  border: tier.highlighted ? '1px solid rgba(239,159,39,0.55)' : '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 16,
                  padding: '30px 28px',
                  boxShadow: tier.highlighted ? '0 0 0 1px rgba(239,159,39,0.18) inset' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    {tier.name}
                  </div>
                  <div style={{ fontSize: 11, color: tier.highlighted ? 'rgba(239,159,39,0.95)' : 'rgba(255,255,255,0.45)' }}>
                    {tier.seats}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 44, color: '#fff', lineHeight: 1 }}>
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{tier.period}</span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 20, minHeight: 38 }}>
                  {tier.description}
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', marginBottom: 20 }} />
                <ul style={{ listStyle: 'none', marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {tier.features.map((feature) => (
                    <li key={`${tier.name}-${feature}`} style={{ fontSize: 13, color: 'rgba(255,255,255,0.66)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 15, height: 15, borderRadius: '50%', background: 'rgba(239,159,39,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF9F27' }} />
                      </div>
                      {feature}
                    </li>
                  ))}
                </ul>
                {isEnterprise ? (
                  <a
                    href="mailto:josh@brentwoodenterprisesllc.com"
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: 12,
                      background: 'transparent',
                      borderRadius: 9,
                      fontSize: 14,
                      fontWeight: 500,
                      color: '#EF9F27',
                      textAlign: 'center',
                      textDecoration: 'none',
                      letterSpacing: '0.01em',
                      border: '1px solid rgba(239,159,39,0.45)',
                    }}
                  >
                    {tier.cta}
                  </a>
                ) : (
                  <button
                    onClick={() => {
                      void handleCheckout(tier.priceId, tier.name)
                    }}
                    disabled={isLoading}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: 12,
                      background: '#EF9F27',
                      borderRadius: 9,
                      fontSize: 14,
                      fontWeight: 500,
                      color: '#3a1e00',
                      textAlign: 'center',
                      textDecoration: 'none',
                      letterSpacing: '0.01em',
                      border: 'none',
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      opacity: isLoading ? 0.7 : 1,
                    }}
                  >
                    {isLoading ? 'Loading...' : tier.cta}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ textAlign: 'center', paddingBottom: 48, fontSize: 12, color: 'rgba(255,255,255,0.15)' }}>mineralmap.io · Eagle Ford Basin</div>
      </div>
    </>
  )
}
