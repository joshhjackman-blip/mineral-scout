'use client'

import Link from 'next/link'

export default function Landing() {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <div style={{ background: '#0b0f1c', minHeight: '100vh', fontFamily: "'DM Sans', sans-serif" }}>
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '22px 52px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <Link href="/landing" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div
              style={{
                width: 28,
                height: 28,
                background: '#EF9F27',
                borderRadius: 5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'DM Serif Display', serif",
                fontSize: 14,
                color: '#fff',
                fontWeight: 700,
              }}
            >
              M
            </div>
            <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 17, color: '#fff', letterSpacing: '-0.01em' }}>
              Mineral Map
            </span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

        <div style={{ textAlign: 'center', padding: '130px 52px 60px' }}>
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
            <span style={{ fontSize: 14, color: 'rgba(239,159,39,0.85)', fontWeight: 500, letterSpacing: '0.04em' }}>
              Gonzales County intelligence platform
            </span>
          </div>

          <div
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 84,
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

          <p style={{ fontSize: 22, color: 'rgba(255,255,255,0.36)', maxWidth: 900, margin: '0 auto', lineHeight: 1.7 }}>
            Mineral Map combines county ownership data, well context, and motivation scoring to prioritize acquisition
            outreach for Eagle Ford minerals.
          </p>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 44 }}>
            <Link
              href="/auth"
              style={{
                display: 'inline-block',
                padding: '16px 30px',
                background: '#EF9F27',
                borderRadius: 9,
                fontSize: 18,
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
                padding: '16px 30px',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 9,
                fontSize: 18,
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
