'use client'

import Link from 'next/link'
import AppLogo from '@/app/components/AppLogo'

export default function Landing() {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <div style={{ background: '#0b0f1c', minHeight: '100dvh', fontFamily: "'DM Sans', sans-serif" }}>
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'clamp(14px, 4vw, 22px) clamp(14px, 6vw, 52px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <Link href="/landing" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
            <AppLogo width={165} />
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Link
              href="/pricing"
              style={{
                fontSize: 13,
                color: 'rgba(255,255,255,0.6)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 7,
                padding: '7px 16px',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Pricing
            </Link>
            <Link
              href="/auth"
              style={{
                fontSize: 13,
                color: '#3a1e00',
                background: '#EF9F27',
                border: '1px solid #EF9F27',
                borderRadius: 7,
                padding: '7px 16px',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Sign in
            </Link>
          </div>
        </nav>

        <div style={{ textAlign: 'center', padding: 'clamp(56px, 12vh, 130px) clamp(16px, 6vw, 52px) clamp(32px, 8vh, 60px)' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              border: '1px solid rgba(239,159,39,0.22)',
              borderRadius: 30,
              padding: '5px 14px',
              marginBottom: 24,
            }}
          >
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#EF9F27' }} />
            <span style={{ fontSize: 'clamp(11px, 2.8vw, 14px)', color: 'rgba(239,159,39,0.85)', fontWeight: 500, letterSpacing: '0.04em' }}>
              Gonzales County intelligence platform
            </span>
          </div>

          <div
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 'clamp(40px, 11vw, 84px)',
              color: '#fff',
              lineHeight: 1.04,
              letterSpacing: '-0.02em',
              marginBottom: 20,
            }}
          >
            Find the right mineral owners
            <br />
            before anyone else.
          </div>

          <p style={{ fontSize: 'clamp(16px, 4.6vw, 22px)', color: 'rgba(255,255,255,0.36)', maxWidth: 900, margin: '0 auto', lineHeight: 1.7 }}>
            Mineral Map combines county ownership data, well context, and motivation scoring to prioritize acquisition
            outreach for Eagle Ford minerals.
          </p>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 44, flexWrap: 'wrap' }}>
            <Link
              href="/auth"
              style={{
                display: 'inline-block',
                padding: 'clamp(12px, 3.8vw, 16px) clamp(18px, 6vw, 30px)',
                background: '#EF9F27',
                borderRadius: 9,
                fontSize: 'clamp(14px, 4.2vw, 18px)',
                fontWeight: 600,
                color: '#3a1e00',
                textDecoration: 'none',
              }}
            >
              Access platform →
            </Link>
            <Link
              href="/pricing"
              style={{
                display: 'inline-block',
                padding: 'clamp(12px, 3.8vw, 16px) clamp(18px, 6vw, 30px)',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 9,
                fontSize: 'clamp(14px, 4.2vw, 18px)',
                fontWeight: 500,
                color: 'rgba(255,255,255,0.72)',
                textDecoration: 'none',
              }}
            >
              View pricing
            </Link>
          </div>
        </div>

        <div style={{ textAlign: 'center', padding: '44px 0 56px', fontSize: 12, color: 'rgba(255,255,255,0.15)' }}>
          mineralmap.io · Eagle Ford Basin
        </div>
      </div>
    </>
  )
}
