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
 * Technical wireframe pumpjack — sketched CAD-style lines on the amber
 * poster. Same motion as before: walking beam nods about the samson pin
 * (340, 254); crank/counterweight spins about (500, 560).
 *
 * Moving parts use translate → animate → untranslate so CSS rotate
 * origins stay reliable across browsers.
 */
function PumpjackSilhouette() {
  const ink = '#0A0A0A'
  return (
    <svg
      viewBox="0 0 640 720"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-pumpjack"
    >
      <g
        stroke={ink}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      >
        {/* Ground pad / skid outline */}
        <path d="M70 650h500" />
        <path d="M90 650 110 678h420l20-28" />
        <rect x="130" y="618" width="380" height="32" />
        <rect x="170" y="596" width="300" height="22" />
        <path d="M170 607h300M210 596v22M250 596v22M370 596v22M410 596v22" strokeWidth="1.4" />

        {/* Wellhead + Christmas tree */}
        <rect x="118" y="560" width="52" height="58" />
        <rect x="108" y="540" width="72" height="22" />
        <rect x="126" y="520" width="36" height="20" />
        <circle cx="144" cy="530" r="5" />
        <path d="M132 560v-8M156 560v-8" strokeWidth="1.6" />
        <path d="M118 580h52M118 600h52" strokeWidth="1.4" />

        {/* Samson post — lattice A-frame with ladder rungs */}
        <path d="M250 618 330 248h20l80 370" />
        <path d="M270 618 340 268" />
        <path d="M410 618 350 268" />
        <path d="M292 320h56M286 370h68M278 430h84M270 490h100M262 550h116" strokeWidth="1.6" />
        {/* Ladder on near leg */}
        <path d="M262 300v290" strokeWidth="1.5" />
        <path
          d="M262 320h14M262 350h14M262 380h14M262 410h14M262 440h14M262 470h14M262 500h14M262 530h14M262 560h14"
          strokeWidth="1.3"
        />
        {/* Crown / equalizer bearing block */}
        <rect x="318" y="236" width="44" height="26" />
        <path d="M318 249h44M330 236v26M350 236v26" strokeWidth="1.4" />

        {/* Gearbox / prime-mover house */}
        <rect x="430" y="540" width="150" height="78" />
        <rect x="450" y="500" width="110" height="40" />
        <path d="M450 520h110M470 500v40M540 500v40" strokeWidth="1.4" />
        <rect x="462" y="468" width="30" height="32" />
        <rect x="510" y="476" width="24" height="24" />
        <circle cx="477" cy="484" r="4" />
        <circle cx="522" cy="488" r="3.5" />
      </g>

      {/* Crank + counterweight — spins around hub (500, 560) */}
      <g transform="translate(500 560)">
        <g className="cs-pump-crank">
          <g
            transform="translate(-500 -560)"
            stroke={ink}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
          >
            {/* Hub */}
            <circle cx="500" cy="560" r="18" />
            <circle cx="500" cy="560" r="6" />
            {/* Crank arm */}
            <path d="M500 560V418" strokeWidth="2.6" />
            <path d="M492 500h16M492 470h16" strokeWidth="1.4" />
            {/* Counterweight mass */}
            <path d="M458 404c0-26 18-44 42-44s42 18 42 44v34c0 14-12 24-26 24h-32c-14 0-26-10-26-24v-34Z" />
            <path d="M470 404h60M470 424h60M485 380v58M515 380v58" strokeWidth="1.35" />
            {/* Wrist pin */}
            <circle cx="500" cy="418" r="10" />
            <circle cx="500" cy="418" r="3.5" />
            {/* Pitman hint (links toward equalizer — drawn short so nod reads clean) */}
            <path d="M500 408 420 280" strokeWidth="1.8" strokeDasharray="0" opacity="0.85" />
          </g>
        </g>
      </g>

      {/* Walking beam + horse head — nods around samson pin (340, 254) */}
      <g transform="translate(340 254)">
        <g className="cs-pump-beam">
          <g
            transform="translate(-340 -254)"
            stroke={ink}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
          >
            {/* Walking beam box section */}
            <path d="M110 232h250v44H110z" />
            <path d="M110 246h250M110 262h250" strokeWidth="1.35" />
            <path d="M160 232v44M220 232v44M280 232v44M320 232v44" strokeWidth="1.35" />

            {/* Horse head — classic curved wedge with radial braces */}
            <path d="M110 232C86 228 62 240 48 262C36 280 30 302 34 322l8 18c4 10 14 16 26 14l18-4 24-42V232Z" />
            <path d="M110 276H58" strokeWidth="1.4" />
            <circle cx="74" cy="268" r="22" strokeWidth="1.5" />
            <circle cx="74" cy="268" r="12" strokeWidth="1.35" />
            <circle cx="74" cy="268" r="3.5" strokeWidth="1.3" />
            <line x1="58" y1="252" x2="90" y2="284" strokeWidth="1.3" />
            <line x1="90" y1="252" x2="58" y2="284" strokeWidth="1.3" />
            <line x1="74" y1="246" x2="74" y2="290" strokeWidth="1.3" />
            <line x1="52" y1="268" x2="96" y2="268" strokeWidth="1.3" />
            {/* Nose / cable guides */}
            <path d="M42 300Q36 318 40 336" strokeWidth="1.5" />
            <path d="M56 318Q52 336 54 352" strokeWidth="1.45" />

            {/* Bridle / polished rod hanger */}
            <path d="M48 336v72" strokeWidth="1.8" />
            <path d="M40 336h16M36 408h24" strokeWidth="1.6" />
            <rect x="38" y="404" width="20" height="14" />

            {/* Equalizer / rear of beam */}
            <path d="M360 236h88l22 18-22 18H360z" />
            <path d="M360 254h88M390 236v36M420 236v36" strokeWidth="1.35" />
            <rect x="448" y="222" width="28" height="64" />
            <path d="M448 238h28M448 254h28M448 270h28" strokeWidth="1.3" />

            {/* Samson pivot pin */}
            <circle cx="340" cy="254" r="14" />
            <circle cx="340" cy="254" r="5" />
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
