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
 * Cartoon oil pumpjack — bold black poster silhouette of a classic
 * "nodding donkey": long walking beam, curved horse head, tall A-frame,
 * curved crank counterweights. Moving parts use translate → animate →
 * untranslate so CSS rotate origins stay reliable.
 */
function PumpjackSilhouette() {
  // Pivot: walking beam / samson pin
  const beamX = 360
  const beamY = 250
  // Crank hub center
  const crankX = 560
  const crankY = 520

  return (
    <svg
      viewBox="40 40 720 680"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-pumpjack"
    >
      {/* Ground shadow / pad */}
      <ellipse cx="400" cy="690" rx="320" ry="22" fill="#0A0A0A" opacity="0.22" />
      <path
        fill="#0A0A0A"
        d="M80 655h640l-28 32H108l-28-32Z"
      />

      {/* Skid base */}
      <path fill="#0A0A0A" d="M140 600h520v36H140z" />
      <path fill="#0A0A0A" d="M180 572h440v28H180z" />

      {/* Wellhead / stuffing box (left) */}
      <g fill="#0A0A0A">
        <rect x="96" y="500" width="72" height="100" rx="6" />
        <rect x="84" y="468" width="96" height="36" rx="4" />
        <rect x="110" y="420" width="20" height="52" rx="2" />
        <rect x="98" y="402" width="44" height="22" rx="3" />
        {/* Flowline stub */}
        <rect x="40" y="530" width="56" height="18" rx="3" />
      </g>

      {/* Samson post — tall classic A-frame */}
      <g fill="#0A0A0A">
        <path d="M300 572 348 230h24l48 342H300Z" />
        <path d="M248 572 330 220h22L286 572H248Z" />
        <path d="M420 572 368 220h22l64 352H420Z" />
        {/* Cap / saddle */}
        <rect x="330" y="214" width="60" height="36" rx="3" />
        {/* Cross members */}
        <rect x="292" y="300" width="96" height="14" />
        <rect x="280" y="380" width="120" height="14" />
        <rect x="268" y="460" width="144" height="14" />
        <rect x="256" y="530" width="168" height="14" />
      </g>

      {/* Gearbox + motor house */}
      <g fill="#0A0A0A">
        <path d="M470 500h180v72H470z" />
        <path d="M500 450h130v50H500z" />
        <rect x="520" y="410" width="36" height="40" rx="2" />
        <rect x="572" y="422" width="28" height="28" rx="2" />
        {/* Exhaust / vent */}
        <rect x="610" y="390" width="14" height="36" rx="2" />
      </g>

      {/* Crank + twin curved counterweights — spins around hub */}
      <g transform={`translate(${crankX} ${crankY})`}>
        <g className="cs-pump-crank">
          <g transform={`translate(${-crankX} ${-crankY})`}>
            {/* Crank arm */}
            <rect
              x={crankX - 14}
              y={crankY - 168}
              width="28"
              height="168"
              rx="6"
              fill="#0A0A0A"
            />
            {/* Curved counterweight (classic C-shape mass) */}
            <path
              fill="#0A0A0A"
              d={`
                M ${crankX - 78} ${crankY - 190}
                a 78 78 0 0 1 156 0
                v 48
                a 40 40 0 0 1 -40 40
                h -76
                a 40 40 0 0 1 -40 -40
                z
              `}
            />
            {/* Wrist-pin boss */}
            <circle cx={crankX} cy={crankY - 168} r="18" fill="#0A0A0A" />
            {/* Hub */}
            <circle cx={crankX} cy={crankY} r="30" fill="#0A0A0A" />
            <circle cx={crankX} cy={crankY} r="12" fill="#0B2A5C" />
          </g>
        </g>
      </g>

      {/* Walking beam + horse head — nods around samson pin */}
      <g transform={`translate(${beamX} ${beamY})`}>
        <g className="cs-pump-beam">
          <g transform={`translate(${-beamX} ${-beamY})`}>
            {/* Long tapered walking beam */}
            <path
              fill="#0A0A0A"
              d={`
                M 70 228
                H 520
                l 36 22
                l -36 22
                H 70
                a 18 18 0 0 1 0 -44
                z
              `}
            />
            {/* Equalizer / rear bearing block */}
            <rect x="500" y="208" width="48" height="84" rx="6" fill="#0A0A0A" />
            {/* Pitman stub hanging from equalizer */}
            <rect x="514" y="288" width="20" height="70" rx="4" fill="#0A0A0A" />

            {/* Horse head — big curved cartoon profile */}
            <path
              fill="#0A0A0A"
              d={`
                M 70 210
                C 40 210, 10 230, -10 270
                C -28 308, -20 350, 8 368
                C 28 380, 52 372, 64 352
                L 96 300
                V 210
                Z
              `}
            />
            {/* Bridle cables + carrier bar */}
            <rect x="-2" y="360" width="14" height="90" fill="#0A0A0A" />
            <rect x="18" y="360" width="14" height="90" fill="#0A0A0A" />
            <rect x="-14" y="444" width="62" height="20" rx="4" fill="#0A0A0A" />

            {/* Pivot pin */}
            <circle cx={beamX} cy={beamY} r="22" fill="#0A0A0A" />
            <circle cx={beamX} cy={beamY} r="9" fill="#0B2A5C" />
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
            Mineral
            <span className="cs-map">Map</span>
          </h1>
          <p className="cs-subhead">Coming Soon</p>
        </div>

        <div className="cs-rig" aria-hidden="true">
          <PumpjackSilhouette />
        </div>
      </main>
    </div>
  )
}
