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

/** Lattice oil derrick silhouette — poster-scale graphic for the coming-soon homepage. */
function OilRigSilhouette() {
  return (
    <svg
      viewBox="0 0 520 780"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-rig-sway"
    >
      {/* Base / substructure */}
      <path
        fill="#0A0A0A"
        d="M78 742h364l-18 28H96l-18-28Zm42-36h280l12 36H108l12-36Z"
      />
      {/* Drill floor / deck */}
      <path fill="#0A0A0A" d="M128 686h264v22H128z" />
      <path fill="#0A0A0A" d="M148 662h224v24H148z" />

      {/* Derrick legs */}
      <path
        fill="#0A0A0A"
        d="M178 662 228 86h16l50 576H178Zm148 0L276 86h16l50 576H326Z"
      />

      {/* Cross bracing */}
      <g stroke="#0A0A0A" strokeWidth="10" strokeLinecap="square">
        <path d="M190 620 340 560M190 560 340 500M190 500 340 440M190 440 340 380M190 380 340 320M190 320 340 260M190 260 340 200M190 200 340 140" />
        <path d="M340 620 190 560M340 560 190 500M340 500 190 440M340 440 190 380M340 380 190 320M340 320 190 260M340 260 190 200M340 200 190 140" />
      </g>

      {/* Horizontal girts */}
      <g fill="#0A0A0A">
        <rect x="186" y="140" width="148" height="12" />
        <rect x="182" y="200" width="156" height="12" />
        <rect x="178" y="260" width="164" height="12" />
        <rect x="174" y="320" width="172" height="12" />
        <rect x="170" y="380" width="180" height="12" />
        <rect x="166" y="440" width="188" height="12" />
        <rect x="162" y="500" width="196" height="12" />
        <rect x="158" y="560" width="204" height="12" />
        <rect x="154" y="620" width="212" height="12" />
      </g>

      {/* Crown block */}
      <path fill="#0A0A0A" d="M214 48h92l22 38H192l22-38Z" />
      <rect x="236" y="22" width="48" height="32" fill="#0A0A0A" />
      <rect x="248" y="8" width="24" height="18" fill="#0A0A0A" />

      {/* Travelling block / drill line */}
      <rect x="254" y="86" width="12" height="420" fill="#0A0A0A" />
      <rect x="238" y="300" width="44" height="54" fill="#0A0A0A" />
      <rect x="246" y="370" width="28" height="36" fill="#0A0A0A" />

      {/* Drawworks / doghouse mass */}
      <path fill="#0A0A0A" d="M360 590h92v72H360z" />
      <path fill="#0A0A0A" d="M68 602h86v60H68z" />
      <path fill="#0A0A0A" d="M92 560h48v42H92z" />

      {/* Pipe rack hint */}
      <g fill="#0A0A0A">
        <rect x="390" y="668" width="86" height="10" rx="1" />
        <rect x="398" y="652" width="70" height="10" rx="1" />
        <rect x="406" y="636" width="54" height="10" rx="1" />
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
          <OilRigSilhouette />
        </div>
      </main>
    </div>
  )
}
