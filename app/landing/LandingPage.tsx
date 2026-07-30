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
 * Flat icon silhouette matching the screenshot, flipped so the horse
 * head is on the left and the X-crank / motor on the right.
 * Beam nods about the Samson pin; crank spins about its hub.
 */
function PumpjackSilhouette() {
  const ink = '#1A1A1A'
  return (
    <svg
      viewBox="0 0 800 420"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-pumpjack"
    >
      {/* Static structure */}
      <g fill={ink}>
        {/* Base */}
        <rect x="40" y="368" width="720" height="28" rx="3" />

        {/* Stepped wellhead (left) */}
        <rect x="118" y="330" width="70" height="38" rx="2" />
        <rect x="130" y="308" width="46" height="22" rx="2" />
        <rect x="142" y="292" width="22" height="16" rx="1" />

        {/* Samson A-frame — two legs + ladder rungs */}
        <path d="M305 368 L385 100 h22 L340 368 Z" />
        <path d="M495 368 L415 100 h-22 L460 368 Z" />
        <rect x="378" y="118" width="7" height="250" />
        <rect x="415" y="118" width="7" height="250" />
        {[140, 175, 210, 245, 280, 315, 350].map((y) => (
          <rect key={y} x="378" y={y} width="44" height="7" />
        ))}
        <rect x="372" y="92" width="56" height="24" rx="2" />

        {/* Guardrail */}
        <rect x="520" y="330" width="6" height="38" />
        <rect x="580" y="330" width="6" height="38" />
        <rect x="520" y="330" width="140" height="6" />

        {/* Motor (far right) */}
        <rect x="690" y="300" width="56" height="68" rx="2" />
      </g>

      {/* X-crank + counterweights — spin about (600, 300) */}
      <g transform="translate(600 300)">
        <g className="cs-pump-crank">
          <g transform="translate(-600 -300)" fill={ink}>
            {/* Thick X from two rounded bars */}
            <rect
              x="560"
              y="248"
              width="80"
              height="104"
              rx="22"
              transform="rotate(35 600 300)"
            />
            <rect
              x="560"
              y="248"
              width="80"
              height="104"
              rx="22"
              transform="rotate(-55 600 300)"
            />
            {/* Hub ring */}
            <path
              fillRule="evenodd"
              d="M572 300 a28 28 0 1 0 56 0 a28 28 0 1 0 -56 0
                 M585 300 a15 15 0 1 1 30 0 a15 15 0 1 1 -30 0"
            />
            {/* Twin pitman rods up toward beam equalizer */}
            <rect x="572" y="150" width="10" height="120" rx="2" />
            <rect x="618" y="150" width="10" height="120" rx="2" />
            <rect x="568" y="142" width="64" height="16" rx="3" />
          </g>
        </g>
      </g>

      {/* Walking beam + D horse head — nod about (400, 108) */}
      <g transform="translate(400 108)">
        <g className="cs-pump-beam">
          <g transform="translate(-400 -108)" fill={ink}>
            {/* Beam */}
            <rect x="200" y="88" width="360" height="40" rx="4" />
            {/* Equalizer block (drive end) */}
            <rect x="540" y="78" width="48" height="60" rx="3" />

            {/*
              Horse head — solid D / semi-circle facing left
              (flipped from the screenshot’s right-facing head)
            */}
            <path d="M230 72 L230 148 A38 38 0 0 1 230 72 Z" />
            {/* Brace into the beam */}
            <path d="M230 88 L270 88 L230 128 Z" />

            {/* Polished rod from top of the curve straight down */}
            <rect x="188" y="72" width="7" height="228" rx="1" />
            <rect x="176" y="68" width="30" height="10" rx="2" />

            {/* Samson pivot ring */}
            <path
              fillRule="evenodd"
              d="M382 108 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0
                 M391 108 a9 9 0 1 1 18 0 a9 9 0 1 1 -18 0"
            />
          </g>
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
