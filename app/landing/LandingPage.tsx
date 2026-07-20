'use client'

import { useEffect, useRef, useState } from 'react'
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

// Exported for reuse if we add hero stats later. Keeps unused-vars quiet.
export { Counter }

// (OilFieldSVG removed 2026-07-17 alongside the same-named component
//  in app/auth/SignInPage.tsx. Design intent is now "photo + type",
//  no schematic overlay.)

// ── Nav ───────────────────────────────────────────────────────────────────────

function Nav() {
  const scrolled = useNavScroll()
  return (
    <nav className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
      <a href="/landing" className="lp-nav-logo">
        <img src="/mineral-map-logo-light.svg" alt="Mineral Map" />
      </a>
      <div className="lp-nav-links">
        {/* Platform / Pricing / Valuations were archived 2026-07-20
            (user ask). The corresponding sections on the landing page
            were removed at the same time, so leaving these nav links
            behind would create dead anchors. If a future ask brings
            those sections back, just re-add the nav links and the
            component tags in LandingPage() below. */}
        <a href="#how">How it works</a>
        <a href="/legal/agreement">Agreement</a>
        <a href="https://getmineralmap.com/auth" className="lp-nav-cta">Get started free →</a>
      </div>
    </nav>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="lp-hero">
      {/* Removed 2026-07-17: the OilFieldSVG grid + two glow blobs that
          used to sit on top of the Permian photo. Photo is the whole
          visual now — no illustration overlay. */}
      <div className="lp-hero-eyebrow reveal">For Texas mineral brokers &amp; acquisition shops</div>
      <h1 className="reveal reveal-delay-1">
        Mineral Map fronts you everything you need to broker or acquire mineral rights.<br />
        <em>Free until you close.</em>
      </h1>
      <p className="lp-hero-sub reveal reveal-delay-2">
        County ownership rolls, well activity, a CRM, click-to-call, and
        one-click PSAs — in one place. No monthly fee, no per-seat charge.
        We&apos;re paid a percentage on the deals we help you close.
      </p>
      <div className="lp-hero-actions reveal reveal-delay-3">
        <a href="https://getmineralmap.com/auth" className="lp-btn-primary">
          Get started free →
        </a>
        <a href="#how" className="lp-btn-secondary">See how it works</a>
      </div>
      <ul className="lp-hero-checks reveal reveal-delay-4">
        <li><span aria-hidden>✓</span> No monthly fee</li>
        <li><span aria-hidden>✓</span> No per-seat charge</li>
        <li><span aria-hidden>✓</span> No data subscription</li>
      </ul>
    </section>
  )
}

// ── Business Model Band ───────────────────────────────────────────────────────

function ModelBand() {
  return (
    <section className="lp-model-band">
      <div className="lp-model-inner">
        <div className="reveal">
          <span className="lp-section-label">How we&apos;re different</span>
          <h2 className="lp-model-heading">
            Stop paying <em>thousands a month</em> just to run acquisitions.
          </h2>
          <p className="lp-model-sub">
            The tooling a mid-market brokerage stitches together costs almost as
            much as a junior analyst — before a single deal closes.
          </p>
        </div>
        <div className="lp-model-cols">
          <div className="lp-model-col lp-model-col-bad reveal reveal-delay-1">
            <div className="lp-model-col-tag">The old way</div>
            <ul>
              <li><s>$10,000/yr</s> for tax rolls</li>
              <li><s>$500/mo</s> for CRM</li>
              <li><s>$3,000/mo</s> for skip tracing</li>
              <li><s>Outsourced legal drafting</s> for PSAs</li>
            </ul>
          </div>
          <div className="lp-model-col lp-model-col-good reveal reveal-delay-2">
            <div className="lp-model-col-tag">Mineral Map</div>
            <ul>
              <li><strong>$0</strong> to sign up and start working leads</li>
              <li><strong>$0</strong> for seat charges on your team</li>
              <li><strong>$0</strong> for every tool, every county</li>
              <li><strong>Percentage fee</strong> on the deals we help close</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Platform / Features ───────────────────────────────────────────────────────

const FEATURES = [
  {
    title: 'Ownership + well data',
    desc: 'Every abstract mapped to its current mineral owner. See PDP / PUD activity, new permits, and lease context in one view, without a separate GIS subscription.',
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </>
    ),
  },
  {
    title: 'Built-in CRM',
    desc: 'Pipelines, notes, owner history, and next‑action reminders. Designed for how brokerages and acquisition teams actually run deals. Nothing to import, nothing to sync.',
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
    title: 'Click‑to‑call & SMS',
    desc: 'A Mineral Map phone number, a dialer inside the app, and every call auto‑logged to the owner\u2019s record. Stop paying a separate voice provider.',
    icon: (
      <>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </>
    ),
  },
  {
    title: 'One-click PSAs',
    desc: 'Generate a Purchase & Sale Agreement pre‑filled with owner name, tract description, and terms straight from a deal. Send for e‑signature in seconds.',
    icon: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="15" y2="17" />
      </>
    ),
  },
  {
    title: 'Skip tracing included',
    desc: 'Find mailing addresses, phone numbers, and email addresses for any mineral owner. No per‑lookup fees, no external vendor to reconcile.',
    icon: (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
  },
  {
    title: 'Valuations on request',
    desc: 'Need a comp‑backed valuation before you make an offer? Our team puts one together for you, usually same day.',
    icon: (
      <>
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </>
    ),
  },
]

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- archived 2026-07-20; kept for easy revival
function Features() {
  return (
    <section id="platform" className="lp-section">
      <span className="lp-section-label reveal">The platform</span>
      <h2 className="lp-section-heading reveal reveal-delay-1">
        Everything a broker or acquisition shop needs, under one login.
      </h2>
      <p className="lp-section-sub reveal reveal-delay-2">
        Data, CRM, dialer, PSAs, skip tracing, and valuations. Built for the
        workflow brokerages and in-house acquisition desks already run, minus
        the six separate invoices.
      </p>
      <div className="lp-features-grid lp-features-grid-3">
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
    title: 'Sign up free',
    desc: 'No credit card. No sales call. Log in and get access to every county we cover today.',
  },
  {
    num: '02',
    title: 'Find opportunities',
    desc: 'Filter parcels by activity: PDP, PUD, new permits. Skip trace the owner, add to your pipeline in one click.',
  },
  {
    num: '03',
    title: 'Work the deal in one place',
    desc: 'Call from the app, log notes, send a PSA. Every touchpoint stays attached to the owner\u2019s record.',
  },
  {
    num: '04',
    title: 'Close, we take a fee',
    desc: 'A percentage of each deal you close through the platform. No monthly fees, no per‑seat charges. If you don\u2019t close, you don\u2019t pay.',
  },
]

function HowItWorks() {
  return (
    <section id="how" className="lp-section lp-how-section">
      <span className="lp-section-label reveal">How it works</span>
      <h2 className="lp-section-heading reveal reveal-delay-1">
        Sign up today. Start prospecting in five minutes.
      </h2>
      <div className="lp-steps-container lp-steps-container-4">
        {STEPS.map((s, i) => (
          <div key={i} className={`lp-step-card reveal reveal-delay-${(i % 3) + 1}`}>
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

// ── Pricing / Model ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- archived 2026-07-20; kept for easy revival
function PricingBand() {
  return (
    <section id="pricing" className="lp-section lp-pricing-band">
      <span className="lp-section-label reveal">Pricing</span>
      <h2 className="lp-section-heading reveal reveal-delay-1">
        <em>$0</em> to start. A % fee on closed deals.
      </h2>
      <p className="lp-section-sub reveal reveal-delay-2">
        You get every feature, every county, unlimited seats. We take a
        percentage of each deal you close, and nothing else.
      </p>
      <div className="lp-pricing-card reveal reveal-delay-3">
        <div className="lp-pricing-card-header">
          <span className="lp-pricing-card-tag">Broker plan</span>
          <div className="lp-pricing-card-price">
            <span className="lp-pricing-card-price-value">$0</span>
            <span className="lp-pricing-card-price-period">forever</span>
          </div>
          <p className="lp-pricing-card-sub">
            Plus a percentage of each deal we help you close. Transparent, itemized,
            paid at closing.
          </p>
        </div>
        <div className="lp-pricing-card-divider" />
        <ul className="lp-pricing-card-list">
          <li>Every county we cover across the 12‑county Permian footprint</li>
          <li>Unlimited seats for your whole team</li>
          <li>Skip tracing included, no per‑lookup fees</li>
          <li>Dedicated Mineral Map phone number &amp; SMS</li>
          <li>Auto‑drafted PSAs with e‑signature</li>
          <li>Valuation team on‑call for offers you&apos;re about to make</li>
        </ul>
        <a href="https://getmineralmap.com/auth" className="lp-btn-primary lp-btn-large lp-pricing-card-cta">
          Create your account →
        </a>
        <p className="lp-pricing-card-fineprint">
          By creating an account you&apos;ll be asked to sign our{' '}
          <a href="/legal/agreement">Platform Services Agreement</a>: 10% success
          fee on Platform Leads you close, 24-month attribution, no monthly fees.
        </p>
      </div>
    </section>
  )
}

// ── Valuations Callout ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- archived 2026-07-20; kept for easy revival
function ValuationsBand() {
  return (
    <section id="valuations" className="lp-valuations-band">
      <div className="lp-valuations-inner">
        <div className="lp-valuations-copy reveal">
          <span className="lp-section-label">Valuations, on us</span>
          <h2 className="lp-valuations-heading">
            About to make an offer?<br />
            <em>Get a comp‑backed valuation first.</em>
          </h2>
          <p>
            Send us the tract and we&apos;ll put together a valuation: comparable
            deals, current well activity, decline curves, and a suggested offer range.
            No charge. Same day when we can.
          </p>
          <div className="lp-valuations-actions">
            <a
              href="mailto:josh@brentwoodenterprisesllc.com?subject=Valuation%20request&body=Tract%2Fabstract%3A%20%0AApprox%20acreage%3A%20%0AOwner%20name%3A%20%0ANotes%3A%20"
              className="lp-btn-primary"
            >
              Request a valuation →
            </a>
            <span className="lp-valuations-hint">
              Or hit <strong>Request valuation</strong> on any tract inside the app.
            </span>
          </div>
        </div>
        <div className="lp-valuations-panel reveal reveal-delay-1">
          <div className="lp-valuations-panel-header">
            <span>Sample valuation</span>
            <span className="lp-valuations-panel-badge">Draft · 24h turnaround</span>
          </div>
          <dl className="lp-valuations-panel-dl">
            <div><dt>Tract</dt><dd>A‑543 · Howard County</dd></div>
            <div><dt>Gross acres</dt><dd>160.0</dd></div>
            <div><dt>Owner NMA</dt><dd>16.25</dd></div>
            <div><dt>Active wells</dt><dd>3 PDP · 1 PUD</dd></div>
            <div><dt>Recent comps</dt><dd>$12,400 – $16,800 / NRA</dd></div>
            <div className="lp-valuations-panel-highlight">
              <dt>Suggested offer</dt><dd>$14,200 / NRA</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}

// ── CTA Band ──────────────────────────────────────────────────────────────────

function CTABand() {
  return (
    <section className="lp-cta-band">
      <h2 className="reveal">
        Run your brokerage or acquisition desk from<br />
        <em>one login. Free.</em>
      </h2>
      <p className="reveal reveal-delay-1">
        No credit card. No monthly fee. Start prospecting in the next five minutes.
      </p>
      <div className="lp-cta-actions reveal reveal-delay-2">
        <a href="https://getmineralmap.com/auth" className="lp-btn-primary lp-btn-large">
          Get started free →
        </a>
        <a href="/legal/agreement" className="lp-btn-secondary">
          Read the agreement
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
        <div className="lp-footer-copy">© 2026 Mineral Map · Built for mineral brokers &amp; acquisition shops</div>
      </div>
      <div className="lp-footer-links">
        {/* Pricing / Valuations links dropped 2026-07-20 with the
            archive of those landing-page sections. */}
        <a href="#how">How it works</a>
        <a href="/legal/agreement">Agreement</a>
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
      <ModelBand />
      {/* Archived 2026-07-20 at user's request: <Features />,
          <PricingBand />, and <ValuationsBand />. Their function
          definitions are preserved above so re-enabling any of the
          three is a one-line JSX addition here. Nav + Hero anchors
          that pointed at these sections were rewritten to target
          #how (HowItWorks) instead so no dead anchors get shipped. */}
      <HowItWorks />
      <CTABand />
      <Footer />
    </div>
  )
}
