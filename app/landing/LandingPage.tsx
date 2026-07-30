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
 * Conventional pumpjack silhouette (side elevation).
 * Beam nods about the Samson saddle (370, 146);
 * crank + counterweight spin about the hub (520, 390).
 */
function PumpjackSilhouette() {
  const ink = '#0A0A0A'
  return (
    <svg
      viewBox="0 0 720 560"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-pumpjack"
    >
      <g fill={ink}>
        {/* Skid */}
        <rect x="48" y="470" width="624" height="26" rx="2" />
        <rect x="64" y="496" width="592" height="14" rx="1" />

        {/* Wellhead */}
        <rect x="108" y="400" width="58" height="70" rx="2" />
        <rect x="98" y="382" width="78" height="22" rx="2" />
        <rect x="118" y="360" width="38" height="24" rx="2" />
        <circle cx="112" cy="412" r="10" />
        <circle cx="162" cy="412" r="10" />
        <circle cx="137" cy="448" r="8" />

        {/* Samson A-frame + ladder */}
        <path d="M292 470 352 148h18L322 470Z" />
        <path d="M468 470 408 148h-18L438 470Z" />
        <rect x="310" y="180" width="5" height="280" />
        <rect x="310" y="200" width="18" height="4" />
        <rect x="310" y="230" width="18" height="4" />
        <rect x="310" y="260" width="18" height="4" />
        <rect x="310" y="290" width="18" height="4" />
        <rect x="310" y="320" width="18" height="4" />
        <rect x="310" y="350" width="18" height="4" />
        <rect x="310" y="380" width="18" height="4" />
        <rect x="310" y="410" width="18" height="4" />
        <rect x="310" y="440" width="18" height="4" />
        <rect x="330" y="240" width="60" height="7" />
        <rect x="322" y="320" width="76" height="7" />
        <rect x="314" y="400" width="92" height="7" />
        <rect x="348" y="132" width="44" height="28" rx="2" />

        {/* Gearbox + finned motor */}
        <rect x="500" y="400" width="130" height="70" rx="3" />
        <rect x="518" y="368" width="94" height="34" rx="2" />
        <rect x="620" y="390" width="48" height="80" rx="2" />
        <rect x="628" y="398" width="32" height="4" />
        <rect x="628" y="408" width="32" height="4" />
        <rect x="628" y="418" width="32" height="4" />
        <rect x="628" y="428" width="32" height="4" />
        <rect x="628" y="438" width="32" height="4" />
        <rect x="628" y="448" width="32" height="4" />
        <rect x="628" y="458" width="32" height="4" />
      </g>

      {/* Crank + counterweight — spin about (520, 390) */}
      <g transform="translate(520 390)">
        <g className="cs-pump-crank">
          <g transform="translate(-520 -390)" fill={ink}>
            <circle cx="520" cy="390" r="20" />
            <rect x="510" y="268" width="20" height="130" rx="3" />
            {/* Counterweight */}
            <path d="M478 262c0-24 18-42 42-42s42 18 42 42v48c0 14-10 24-24 24h-36c-14 0-24-10-24-24z" />
            <circle cx="520" cy="275" r="11" />
            {/* Pitman */}
            <rect x="513" y="168" width="14" height="110" rx="2" />
            <rect x="502" y="158" width="36" height="16" rx="2" />
          </g>
        </g>
      </g>

      {/* Walking beam + horsehead — nod about (370, 146) */}
      <g transform="translate(370 146)">
        <g className="cs-pump-beam">
          <g transform="translate(-370 -146)" fill={ink}>
            <rect x="200" y="126" width="320" height="40" rx="3" />
            <path d="M500 130h70l20 16-20 16H500Z" />
            <rect x="552" y="118" width="28" height="56" rx="2" />
            {/* Classic curved horsehead */}
            <path d="M210 118C175 118 145 135 128 165C112 192 110 225 128 250L155 275C168 285 188 280 198 262L220 228V138H210Z" />
            <rect x="140" y="248" width="10" height="120" rx="1" />
            <rect x="128" y="244" width="34" height="12" rx="2" />
            <circle cx="370" cy="146" r="14" />
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
