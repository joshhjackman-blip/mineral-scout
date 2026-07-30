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
 * Clean flat pumpjack silhouette (flipped: horse head left, crank right).
 * Walking beam nods about the Samson pin; crank/counterweights spin
 * about the hub. Cutouts use evenodd so the amber gradient shows through.
 */
function PumpjackSilhouette() {
  const ink = '#0A0A0A'
  return (
    <svg
      viewBox="0 0 640 520"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-pumpjack"
    >
      {/* ——— Static: skid, rail, wellhead, Samson, motor ——— */}
      <g fill={ink}>
        <rect x="40" y="455" width="560" height="22" rx="2" />
        <rect x="52" y="477" width="536" height="10" rx="1" />

        {/* Guardrail */}
        <rect x="400" y="418" width="8" height="38" />
        <rect x="470" y="418" width="8" height="38" />
        <rect x="540" y="430" width="8" height="26" />
        <rect x="400" y="418" width="148" height="7" />

        {/* Wellhead */}
        <rect x="118" y="400" width="44" height="56" rx="2" />
        <rect x="108" y="386" width="64" height="18" rx="2" />
        <rect x="128" y="372" width="24" height="16" rx="1" />

        {/* Samson A-frame — open lattice with ladder */}
        <path d="M250 455 318 168h20l-40 287H250Z" />
        <path d="M406 455 338 168h-20l40 287H406Z" />
        {/* Cross braces */}
        <rect x="286" y="230" width="68" height="10" />
        <rect x="278" y="290" width="84" height="10" />
        <rect x="270" y="350" width="100" height="10" />
        <rect x="262" y="410" width="116" height="10" />
        {/* Ladder */}
        <rect x="312" y="200" width="5" height="240" />
        <rect x="339" y="200" width="5" height="240" />
        <rect x="312" y="220" width="32" height="5" />
        <rect x="312" y="250" width="32" height="5" />
        <rect x="312" y="280" width="32" height="5" />
        <rect x="312" y="310" width="32" height="5" />
        <rect x="312" y="340" width="32" height="5" />
        <rect x="312" y="370" width="32" height="5" />
        <rect x="312" y="400" width="32" height="5" />
        <rect x="312" y="430" width="32" height="5" />
        <rect x="302" y="150" width="52" height="28" rx="2" />

        {/* Motor */}
        <rect x="548" y="400" width="52" height="56" rx="2" />
        <rect x="556" y="378" width="36" height="24" rx="1" />
      </g>

      {/* ——— Crank + counterweights (spin about 470, 400) ——— */}
      <g transform="translate(470 400)">
        <g className="cs-pump-crank">
          <g transform="translate(-470 -400)" fill={ink}>
            {/* Twin counterweight lobes */}
            <ellipse cx="470" cy="318" rx="34" ry="52" />
            <ellipse
              cx="470"
              cy="318"
              rx="34"
              ry="52"
              transform="rotate(110 470 400)"
            />
            {/* Hub ring on top of lobes */}
            <path
              fillRule="evenodd"
              d="M442 400a28 28 0 1 0 56 0a28 28 0 1 0-56 0zm19 0a9 9 0 1 1 18 0a9 9 0 1 1-18 0z"
            />
            <circle cx="470" cy="300" r="12" />
            {/* Pitman — rides with crank toward equalizer */}
            <rect x="462" y="210" width="16" height="96" rx="3" />
            <rect x="452" y="200" width="36" height="16" rx="2" />
          </g>
        </g>
      </g>

      {/* ——— Walking beam + horse head (nod about 328, 164) ——— */}
      <g transform="translate(328 164)">
        <g className="cs-pump-beam">
          <g transform="translate(-328 -164)" fill={ink}>
            <rect x="150" y="140" width="300" height="42" rx="3" />
            <path d="M440 146h70l22 15-22 15H440z" />
            <rect x="498" y="128" width="28" height="66" rx="2" />

            {/* Horse head — curved fan with spoke cutouts */}
            <path
              fillRule="evenodd"
              d="M158 134c-32 0-62 24-76 58-12 28-14 60-2 88l10 18c8 12 24 16 38 8l22-10 28-52V134z
                 M112 168c12-14 28-22 46-22v20c-12 0-22 6-30 14l-16-12z
                 M96 208c8-14 20-24 36-28l8 18c-10 4-18 10-24 20l-20-10z
                 M92 250c6-12 16-20 28-24l10 18c-8 4-14 10-18 18l-20-12z
                 M110 288l16-14c6 8 14 14 24 16l-6 18c-14-4-26-12-34-20z"
            />

            {/* Bridle + polished rod */}
            <rect x="72" y="320" width="10" height="60" rx="1" />
            <rect x="60" y="312" width="34" height="12" rx="2" />
            <rect x="64" y="372" width="26" height="12" rx="2" />

            <path
              fillRule="evenodd"
              d="M328 150a14 14 0 1 1 0 28a14 14 0 1 1 0-28zm0 9a5 5 0 1 0 0 10a5 5 0 1 0 0-10z"
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
