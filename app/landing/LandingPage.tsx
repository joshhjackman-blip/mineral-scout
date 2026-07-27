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
 * Cartoon oil pumpjack silhouette — same bold black poster style as the
 * old derrick, with a nodding walking beam + spinning crank counterweight.
 *
 * Moving parts are wrapped in translate → animate → untranslate groups so
 * CSS rotate origins stay reliable across browsers.
 */
function PumpjackSilhouette() {
  return (
    <svg
      viewBox="0 0 640 720"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-pumpjack"
    >
      {/* Ground pad */}
      <path
        fill="#0A0A0A"
        d="M36 678h568l-22 28H58l-22-28Zm48-34h472l14 34H70l14-34Z"
      />

      {/* Concrete skid / base */}
      <path fill="#0A0A0A" d="M120 620h400v28H120z" />
      <path fill="#0A0A0A" d="M160 596h320v24H160z" />

      {/* Wellhead + polished rod guide (left) */}
      <g fill="#0A0A0A">
        <rect x="118" y="520" width="56" height="76" rx="4" />
        <rect x="108" y="496" width="76" height="28" rx="3" />
        <rect x="132" y="360" width="14" height="140" />
        <rect x="124" y="348" width="30" height="18" rx="2" />
      </g>

      {/* Samson post (A-frame) */}
      <g fill="#0A0A0A">
        <path d="M292 596 340 250h20l48 346H292Zm-42 0 58-300h18l-28 300H250Zm142 0-28-300h18l58 300H392Z" />
        <rect x="318" y="240" width="44" height="28" rx="2" />
        <rect x="308" y="320" width="64" height="10" />
        <rect x="304" y="390" width="72" height="10" />
        <rect x="298" y="460" width="84" height="10" />
        <rect x="292" y="530" width="96" height="10" />
      </g>

      {/* Gearbox / prime mover house */}
      <g fill="#0A0A0A">
        <path d="M420 520h140v76H420z" />
        <path d="M440 480h100v40H440z" />
        <rect x="456" y="448" width="28" height="32" />
        <rect x="500" y="456" width="22" height="24" />
      </g>

      {/* Crank + counterweight — spins around hub (500, 560) */}
      <g transform="translate(500 560)">
        <g className="cs-pump-crank">
          <g transform="translate(-500 -560)">
            <circle cx="500" cy="560" r="22" fill="#0A0A0A" />
            <rect x="490" y="420" width="20" height="140" rx="4" fill="#0A0A0A" />
            <path
              fill="#0A0A0A"
              d="M456 400c0-28 20-48 44-48s44 20 44 48v36c0 16-12 28-28 28h-32c-16 0-28-12-28-28v-36Z"
            />
            <circle cx="500" cy="420" r="14" fill="#0A0A0A" />
          </g>
        </g>
      </g>

      {/* Walking beam + horse head — nods around samson pin (340, 254) */}
      <g transform="translate(340 254)">
        <g className="cs-pump-beam">
          <g transform="translate(-340 -254)">
            <path fill="#0A0A0A" d="M96 230h292v48H96z" />
            <path fill="#0A0A0A" d="M388 238h96l28 20-28 20H388z" />
            <rect x="460" y="220" width="36" height="68" rx="4" fill="#0A0A0A" />
            <path
              fill="#0A0A0A"
              d="M96 214c-8 0-18 6-24 16l-40 56c-6 10-4 22 6 28l18 8c12 6 26 2 34-8l28-40V214H96Z"
            />
            <rect x="54" y="286" width="12" height="70" fill="#0A0A0A" />
            <rect x="42" y="350" width="36" height="16" rx="3" fill="#0A0A0A" />
            <circle cx="340" cy="254" r="16" fill="#0A0A0A" />
            <circle cx="340" cy="254" r="7" fill="#0B2A5C" />
          </g>
        </g>
      </g>
    </svg>
  )
}

export default function LandingPage() {
  return (
    <div className={`cs-root ${display.variable}`}>
      <nav className="cs-nav" aria-label="Primary">
        <Link href="/landing" className="cs-logo" aria-label="Mineral Map">
          <AppLogo width={168} />
        </Link>
        <Link href="/auth" className="cs-login">
          Log in
        </Link>
      </nav>

      <main className="cs-stage">
        <div className="cs-copy">
          <h1 className="cs-headline">
            Mineral <span className="cs-map">Map</span>
          </h1>
          <p className="cs-subhead">
            Everything you need to find, track,
            <br />
            and close Permian mineral deals.
          </p>
        </div>

        <div className="cs-rig" aria-hidden="true">
          <PumpjackSilhouette />
        </div>
      </main>
    </div>
  )
}
