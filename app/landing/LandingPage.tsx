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
 * CAD wireframe pumpjack from a detailed sketch asset, split into
 * base / beam / crank layers so we keep the same motion:
 * walking beam nods about the samson saddle; crank spins about its hub.
 */
function PumpjackSilhouette() {
  // Pivot points in the 1000×723 asset space
  const beamPivot = { x: 512, y: 178 }
  const crankPivot = { x: 690, y: 385 }

  return (
    <svg
      viewBox="0 0 1000 723"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-pumpjack"
    >
      <image
        href="/landing/pumpjack-base.png"
        width="1000"
        height="723"
        preserveAspectRatio="xMidYMid meet"
      />

      {/* Crank + counterweight */}
      <g transform={`translate(${crankPivot.x} ${crankPivot.y})`}>
        <g className="cs-pump-crank">
          <image
            href="/landing/pumpjack-crank.png"
            x={-crankPivot.x}
            y={-crankPivot.y}
            width="1000"
            height="723"
            preserveAspectRatio="xMidYMid meet"
          />
        </g>
      </g>

      {/* Walking beam + horse head */}
      <g transform={`translate(${beamPivot.x} ${beamPivot.y})`}>
        <g className="cs-pump-beam">
          <image
            href="/landing/pumpjack-beam.png"
            x={-beamPivot.x}
            y={-beamPivot.y}
            width="1000"
            height="723"
            preserveAspectRatio="xMidYMid meet"
          />
        </g>
      </g>
    </svg>
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
