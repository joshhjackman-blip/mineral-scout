'use client'

import Link from 'next/link'
import { Barlow_Condensed } from 'next/font/google'
import AppLogo from '@/app/components/AppLogo'
import './coming-soon.css'

const display = Barlow_Condensed({
  weight: ['700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-barlow-condensed',
})

/**
 * Full CAD wireframe sketch (single asset).
 * Nods as one unit about the Samson foot so the horse head arcs
 * up/down — no cropped fragments spinning on their own.
 */
function PumpjackSilhouette() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/landing/pumpjack-wireframe.png"
      alt=""
      aria-hidden="true"
      className="cs-pumpjack cs-pump-nod"
      draggable={false}
    />
  )
}

const CONTACT_EMAIL = 'management@mineralmapllc.com'

export default function LandingPage() {
  return (
    <div className={`cs-root ${display.variable}`}>
      <nav className="cs-nav" aria-label="Primary">
        <Link href="/landing" className="cs-logo" aria-label="Mineral Map">
          <AppLogo width={168} />
        </Link>
        <div className="cs-nav-actions">
          <Link href="/book-demo" className="cs-nav-demo">
            Book a demo
          </Link>
          <Link href="/auth" className="cs-login">
            Log in
          </Link>
        </div>
      </nav>

      <main className="cs-stage">
        <div className="cs-copy">
          <h1 className="cs-headline">
            Mineral <span className="cs-map">Map</span>
          </h1>
          <p className="cs-subhead">
            <span className="cs-subhead-line">
              Everything you need to find, track,
            </span>
            <span className="cs-subhead-line">
              and close Permian mineral deals.
            </span>
          </p>
          <div className="cs-hero-actions">
            <Link href="/book-demo" className="cs-btn-primary">
              Book a demo
            </Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="cs-btn-email">
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>

        <div className="cs-rig" aria-hidden="true">
          <PumpjackSilhouette />
        </div>
      </main>
    </div>
  )
}
