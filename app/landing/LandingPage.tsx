'use client'

import { useState, useEffect, useRef } from 'react'
import './landing.css'

// ── Hooks ────────────────────────────────────────────────────────────────────

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    const obs = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') }),
      { threshold: 0.1 }
    )
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])
}

function useNavScroll() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])
  return scrolled
}

// ── Counter ──────────────────────────────────────────────────────────────────

function Counter({ target, duration = 1800 }: { target: number; duration?: number }) {
  const [val, setVal] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const started = useRef(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true
        const start = performance.now()
        const tick = (now: number) => {
          const t = Math.min((now - start) / duration, 1)
          const ease = 1 - Math.pow(1 - t, 3)
          setVal(Math.round(ease * target))
          if (t < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }
    }, { threshold: 0.3 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [target, duration])
  return <span ref={ref}>{val.toLocaleString()}</span>
}

// `Counter` is exported so we can reuse it for hero stats animations later
// without tripping the unused-vars lint rule.
export { Counter }

// ── Oil Field SVG ─────────────────────────────────────────────────────────────

function OilFieldSVG() {
  const parcels: [number, number, number, number][] = [
    [80,60,220,180],[300,60,460,220],[500,80,680,240],
    [60,200,260,360],[280,220,500,400],[520,250,720,420],
    [80,380,300,540],[320,420,560,580],[580,440,760,600],
    [100,560,320,680],[340,580,600,700],
  ]
  const wells: [number, number][] = [
    [160,60],[320,140],[480,80],[640,160],
    [130,300],[400,280],[600,320],[200,480],[500,500],[700,440],
  ]
  const dots: [number, number, number, number][] = [
    [200,130,8,0.9],[420,200,6,0.75],[560,150,7,0.85],
    [150,320,5,0.6],[380,340,8,0.9],[650,380,6,0.7],
    [240,500,7,0.8],[520,520,5,0.55],[720,480,6,0.65],
    [340,620,8,0.9],[600,640,5,0.6],
  ]
  return (
    <svg viewBox="0 0 800 700" fill="none" xmlns="http://www.w3.org/2000/svg" color="#EF9F27">
      {[0,1,2,3,4,5].map(i => (
        <line key={`v${i}`} x1={i*160} y1="0" x2={i*160} y2="700"
          stroke="currentColor" strokeWidth="0.4" strokeDasharray="3 9" opacity="0.6" />
      ))}
      {[0,1,2,3,4].map(i => (
        <line key={`h${i}`} x1="0" y1={i*160+30} x2="800" y2={i*160+30}
          stroke="currentColor" strokeWidth="0.4" strokeDasharray="3 9" opacity="0.6" />
      ))}
      {parcels.map(([x1,y1,x2,y2],i) => (
        <rect key={`p${i}`} x={x1} y={y1} width={x2-x1} height={y2-y1}
          stroke="currentColor" strokeWidth="0.6" fill="none" opacity="0.25" />
      ))}
      {wells.map(([x,y],i) => (
        <g key={`w${i}`}>
          <line x1={x} y1={y} x2={x} y2={y+80} stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
          <polygon points={`${x},${y} ${x-6},${y+14} ${x+6},${y+14}`} fill="currentColor" opacity="0.6" />
          <line x1={x} y1={y+80} x2={x + (i%2===0?90:-90)} y2={y+80}
            stroke="currentColor" strokeWidth="0.8" strokeDasharray="4 4" opacity="0.35" />
        </g>
      ))}
      {dots.map(([x,y,r,op],i) => (
        <circle key={`d${i}`} cx={x} cy={y} r={r} fill="currentColor" opacity={op} />
      ))}
      <path d="M160,140 Q280,200 400,280 Q520,360 640,380"
        stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.2" strokeDasharray="8 4"/>
      <path d="M480,80 Q540,200 600,320 Q660,440 700,480"
        stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.2" strokeDasharray="8 4"/>
    </svg>
  )
}

// ── Nav ───────────────────────────────────────────────────────────────────────

function Nav() {
  const scrolled = useNavScroll()
  return (
    <nav className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
      <a href="/landing" className="lp-nav-logo">
        <img src="/mineral-map-logo-light.svg" alt="Mineral Map" />
      </a>
      <div className="lp-nav-links">
        <a href="#features">Features</a>
        <a href="#how">How it works</a>
        <a href="https://getmineralmap.com/auth" className="lp-nav-cta">Access platform →</a>
      </div>
    </nav>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="lp-hero">
      <div className="lp-hero-bg">
        <div className="lp-hero-glow" />
        <div className="lp-hero-glow2" />
        <OilFieldSVG />
      </div>
      <div className="lp-hero-eyebrow reveal">Mineral Acquisition Intelligence</div>
      <h1 className="reveal reveal-delay-1">
        Find the right <em>mineral owners</em><br />
        <em>before anyone else.</em>
      </h1>
      <p className="lp-hero-sub reveal reveal-delay-2">
        Mineral Map combines county ownership data, well context, and motivation
        scoring to prioritize acquisition outreach — so you spend time on the
        owners most likely to sell.
      </p>
      <div className="lp-hero-actions reveal reveal-delay-3">
        <a href="https://getmineralmap.com/auth" className="lp-btn-primary">
          Access platform →
        </a>
        <a href="#how" className="lp-btn-secondary">See how it works</a>
      </div>
    </section>
  )
}

// ── Features ──────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    title: 'Ownership mapping',
    desc: 'Every abstract in your target county mapped to its current mineral owner. Visualize contiguous acreage, interests, and chain of title.',
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </>
    ),
  },
  {
    title: 'Propensity scoring',
    desc: 'Proprietary signals — including out-of-state ownership, estate-held minerals, and well proximity — combined into a single acquisition score.',
    icon: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  },
  {
    title: 'Built-in CRM',
    desc: 'Track outreach, notes, and deal status without leaving the platform. Pipeline management designed for how mineral acquisition actually works.',
    icon: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
  {
    title: 'Skip tracing',
    desc: 'Locate current contact info for mineral owners directly from the platform. Skip traces included depending on your plan.',
    icon: (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
  },
]

function Features() {
  return (
    <section id="features" className="lp-section">
      <span className="lp-section-label reveal">Platform capabilities</span>
      <h2 className="lp-section-heading reveal reveal-delay-1">
        Everything you need to work smarter in mineral acquisition.
      </h2>
      <p className="lp-section-sub reveal reveal-delay-2">
        Built specifically for landmen and acquisition professionals — not a generic GIS viewer.
      </p>
      <div className="lp-features-grid">
        {FEATURES.map((f, i) => (
          <div key={i} className={`lp-feature-card reveal reveal-delay-${(i % 3) + 1}`}>
            <div className="lp-feature-icon">
              <svg viewBox="0 0 24 24">{f.icon}</svg>
            </div>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── How It Works ──────────────────────────────────────────────────────────────

const STEPS = [
  {
    num: '01',
    title: 'Browse the map',
    desc: 'Explore every survey abstract in your target county. Each parcel shows ownership, acreage, and active well context.',
  },
  {
    num: '02',
    title: 'Filter by score',
    desc: 'Sort owners by propensity score. Our multi-signal model surfaces the most motivated sellers so you prioritize the right conversations.',
  },
  {
    num: '03',
    title: 'Reach out & track',
    desc: 'Use built-in skip tracing to find contact info, then log every touchpoint in the integrated CRM without switching tools.',
  },
]

function HowItWorks() {
  return (
    <section id="how" className="lp-section lp-how-section">
      <span className="lp-section-label reveal">How it works</span>
      <h2 className="lp-section-heading reveal reveal-delay-1">
        From county data to priority outreach in minutes.
      </h2>
      <div className="lp-steps-container">
        {STEPS.map((s, i) => (
          <div key={i} className={`lp-step-card reveal reveal-delay-${i + 1}`}>
            <span className="lp-step-num">{s.num}</span>
            {i < STEPS.length - 1 && <div className="lp-step-connector" />}
            <h3>{s.title}</h3>
            <p>{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── CTA Band ──────────────────────────────────────────────────────────────────

function CTABand() {
  return (
    <section className="lp-cta-band">
      <h2 className="reveal">
        Get ahead of the<br />
        <em>next acquisition.</em>
      </h2>
      <p className="reveal reveal-delay-1">
        No contracts. Cancel anytime. Your first 7 days are free.
      </p>
      <div className="lp-cta-actions reveal reveal-delay-2">
        <a href="https://getmineralmap.com/auth" className="lp-btn-primary lp-btn-large">
          Start free trial →
        </a>
        <a href="https://getmineralmap.com/pricing" className="lp-btn-secondary">
          View pricing
        </a>
      </div>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="lp-footer">
      <div>
        <img src="/mineral-map-logo-light.svg" alt="Mineral Map" className="lp-footer-logo" />
        <div className="lp-footer-copy">© 2026 Mineral Map · Mineral Acquisition Intelligence</div>
      </div>
      <div className="lp-footer-links">
        <a href="https://getmineralmap.com/pricing">Pricing</a>
        <a href="https://getmineralmap.com/auth">Sign in</a>
        <a href="mailto:josh@brentwoodenterprisesllc.com">Contact</a>
      </div>
    </footer>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function LandingPage() {
  useReveal()
  return (
    <div className="lp-root">
      <Nav />
      <Hero />
      <Features />
      <HowItWorks />
      <CTABand />
      <Footer />
    </div>
  )
}
