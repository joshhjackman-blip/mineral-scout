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
 * Realistic conventional pumpjack silhouette — horse head left,
 * crank/gearbox right. Beam nods about the Samson pin (340, 254);
 * crank + counterweights spin about the hub (500, 560).
 */
function PumpjackSilhouette() {
  const ink = '#0A0A0A'
  return (
    <svg
      viewBox="0 0 640 720"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-pumpjack"
    >
      <g fill={ink}>
        {/* Pad / skid */}
        <path d="M40 670h560l-18 26H58l-18-26Z" />
        <rect x="70" y="642" width="500" height="28" rx="2" />
        <rect x="110" y="618" width="420" height="24" rx="2" />

        {/* Wellhead / stuffing box */}
        <rect x="116" y="540" width="52" height="78" rx="3" />
        <rect x="104" y="516" width="76" height="26" rx="3" />
        <rect x="124" y="496" width="36" height="22" rx="2" />
        <rect x="132" y="478" width="20" height="18" rx="1" />

        {/* Samson post — open A-frame + ladder */}
        <path d="M268 618 328 248h16l-36 370H268Z" />
        <path d="M412 618 352 248h-16l36 370H412Z" />
        <rect x="318" y="236" width="44" height="26" rx="2" />
        <rect x="328" y="270" width="6" height="330" />
        <rect x="346" y="270" width="6" height="330" />
        <rect x="328" y="300" width="24" height="6" />
        <rect x="328" y="340" width="24" height="6" />
        <rect x="328" y="380" width="24" height="6" />
        <rect x="328" y="420" width="24" height="6" />
        <rect x="328" y="460" width="24" height="6" />
        <rect x="328" y="500" width="24" height="6" />
        <rect x="328" y="540" width="24" height="6" />
        <rect x="328" y="580" width="24" height="6" />
        {/* Cross members */}
        <rect x="300" y="330" width="80" height="8" />
        <rect x="292" y="420" width="96" height="8" />
        <rect x="284" y="510" width="112" height="8" />

        {/* Gearbox + prime mover */}
        <rect x="430" y="540" width="150" height="78" rx="3" />
        <rect x="448" y="500" width="114" height="42" rx="2" />
        <rect x="462" y="468" width="32" height="34" rx="1" />
        <rect x="520" y="476" width="26" height="26" rx="1" />
        {/* Belt housing hint */}
        <rect x="558" y="556" width="40" height="48" rx="2" />
      </g>

      {/* Crank + counterweights — spin about (500, 560) */}
      <g transform="translate(500 560)">
        <g className="cs-pump-crank">
          <g transform="translate(-500 -560)" fill={ink}>
            {/* Crank arm */}
            <rect x="490" y="410" width="20" height="150" rx="4" />
            {/* Counterweight mass at end of crank */}
            <path d="M448 392c0-30 22-52 52-52s52 22 52 52v40c0 18-14 30-30 30h-44c-16 0-30-12-30-30v-40Z" />
            {/* Second counterweight lobe (opposite side of hub) */}
            <path
              d="M448 392c0-30 22-52 52-52s52 22 52 52v40c0 18-14 30-30 30h-44c-16 0-30-12-30-30v-40Z"
              transform="rotate(180 500 560)"
            />
            {/* Hub */}
            <circle cx="500" cy="560" r="26" />
            <circle cx="500" cy="560" r="10" fill="#0B2A5C" />
            {/* Wrist pin */}
            <circle cx="500" cy="418" r="14" />
            {/* Twin pitman arms toward equalizer */}
            <rect x="478" y="280" width="12" height="145" rx="2" />
            <rect x="510" y="280" width="12" height="145" rx="2" />
            <rect x="470" y="268" width="60" height="18" rx="3" />
          </g>
        </g>
      </g>

      {/* Walking beam + horse head — nod about (340, 254) */}
      <g transform="translate(340 254)">
        <g className="cs-pump-beam">
          <g transform="translate(-340 -254)" fill={ink}>
            {/* Walking beam */}
            <rect x="120" y="230" width="300" height="44" rx="3" />
            {/* Equalizer / tail */}
            <path d="M410 236h88l26 16-26 16H410Z" />
            <rect x="478" y="218" width="34" height="68" rx="3" />

            {/*
              Classic horsehead — curved face the bridle rides on,
              with a cheek cutout so it reads as a horsehead, not a blob.
            */}
            <path
              fillRule="evenodd"
              d="M132 216 C98 214 68 232 52 266 C38 294 40 328 60 352 L90 378 C106 390 128 382 138 364 L160 318 V228 H132 Z
                 M118 248 C98 258 88 282 92 308 C96 328 112 342 128 346 L140 300 V248 H118 Z"
            />

            {/* Bridle + polished rod */}
            <rect x="72" y="360" width="12" height="130" rx="1" />
            <rect x="58" y="356" width="40" height="14" rx="2" />
            <rect x="62" y="482" width="32" height="14" rx="2" />

            {/* Saddle bearing / pivot */}
            <circle cx="340" cy="254" r="16" />
            <circle cx="340" cy="254" r="6" fill="#0B2A5C" />
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
