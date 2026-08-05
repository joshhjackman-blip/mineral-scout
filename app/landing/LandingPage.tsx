'use client'

import Link from 'next/link'
import { Barlow_Condensed } from 'next/font/google'
import AppLogo from '@/app/components/AppLogo'
import { COUNTIES } from '@/lib/counties'
import './coming-soon.css'

const display = Barlow_Condensed({
  weight: ['700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-barlow-condensed',
})

const CONTACT_EMAIL = 'management@mineralmapllc.com'

/**
 * Lon/lat → SVG helpers for a stylized Texas frame.
 * Bounds cover the full state with a little padding.
 */
const TX_BOUNDS = {
  west: -106.7,
  east: -93.4,
  north: 36.55,
  south: 25.75,
}

const VIEW_W = 640
const VIEW_H = 720
const PAD = 28

function project(lon: number, lat: number): { x: number; y: number } {
  const x =
    PAD +
    ((lon - TX_BOUNDS.west) / (TX_BOUNDS.east - TX_BOUNDS.west)) *
      (VIEW_W - PAD * 2)
  const y =
    PAD +
    ((TX_BOUNDS.north - lat) / (TX_BOUNDS.north - TX_BOUNDS.south)) *
      (VIEW_H - PAD * 2)
  return { x, y }
}

/** Simplified Texas outline (recognizable silhouette for the poster). */
const TEXAS_OUTLINE: Array<[number, number]> = [
  [-103.04, 36.5],
  [-100.0, 36.5],
  [-100.0, 34.56],
  [-99.72, 34.38],
  [-97.15, 33.98],
  [-95.2, 33.96],
  [-94.48, 33.64],
  [-94.04, 33.55],
  [-94.04, 31.99],
  [-93.51, 31.15],
  [-93.69, 30.1],
  [-93.84, 29.76],
  [-94.69, 29.72],
  [-95.1, 29.2],
  [-95.0, 28.7],
  [-96.4, 28.35],
  [-97.14, 27.75],
  [-97.4, 27.3],
  [-97.55, 26.4],
  [-97.38, 25.9],
  [-97.15, 25.96],
  [-98.2, 26.05],
  [-99.15, 26.4],
  [-99.5, 27.15],
  [-100.1, 28.1],
  [-100.65, 29.2],
  [-101.5, 29.75],
  [-102.85, 29.85],
  [-104.55, 29.75],
  [-106.2, 31.4],
  [-106.55, 31.78],
  [-106.4, 32.0],
  [-103.05, 32.0],
  [-103.04, 36.5],
]

function pointsToPath(points: Array<[number, number]>): string {
  return points
    .map(([lon, lat], i) => {
      const { x, y } = project(lon, lat)
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
    .concat(' Z')
}

const LIVE_COUNTIES = Object.values(COUNTIES).map((c) => ({
  id: c.id,
  name: c.name,
  lon: c.mapCenter[0],
  lat: c.mapCenter[1],
}))

function CountyPin({
  lon,
  lat,
  label,
  delayClass,
  labelSide = 'center',
}: {
  lon: number
  lat: number
  label: string
  delayClass: string
  labelSide?: 'left' | 'right' | 'center'
}) {
  const { x, y } = project(lon, lat)
  const labelX = labelSide === 'left' ? -18 : labelSide === 'right' ? 18 : 0
  const anchor =
    labelSide === 'left' ? 'end' : labelSide === 'right' ? 'start' : 'middle'
  return (
    <g className={`cs-pin ${delayClass}`} transform={`translate(${x} ${y})`}>
      <circle className="cs-pin-pulse" cx="0" cy="0" r="22" />
      <circle className="cs-pin-pulse cs-pin-pulse-delay" cx="0" cy="0" r="22" />
      {/* Classic teardrop pin */}
      <path
        className="cs-pin-body"
        d="M0 -28c-11 0-20 9-20 20 0 16 20 36 20 36s20-20 20-36c0-11-9-20-20-20z"
      />
      <circle className="cs-pin-core" cx="0" cy="-10" r="7" />
      <text
        className="cs-pin-label"
        x={labelX}
        y="28"
        textAnchor={anchor}
      >
        {label}
      </text>
    </g>
  )
}

/**
 * Texas map with pins on live Permian counties (Howard + Martin).
 */
function TexasPermianMap() {
  const outline = pointsToPath(TEXAS_OUTLINE)
  // Soft Permian basin highlight ellipse around Midland–Odessa / Howard–Martin
  const basin = project(-101.7, 32.2)

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-texas-map"
    >
      {/* Soft state drop shadow */}
      <path d={outline} className="cs-tx-shadow" transform="translate(8 10)" />

      {/* State fill */}
      <path d={outline} className="cs-tx-fill" />

      {/* Permian basin glow */}
      <ellipse
        className="cs-permian-glow"
        cx={basin.x}
        cy={basin.y}
        rx="78"
        ry="54"
      />

      {/* State stroke on top of glow */}
      <path d={outline} className="cs-tx-stroke" />

      {/* Subtle west-Texas region label */}
      <text
        className="cs-region-label"
        x={basin.x}
        y={basin.y - 58}
        textAnchor="middle"
      >
        Permian Basin
      </text>

      {LIVE_COUNTIES.map((c, i) => (
        <CountyPin
          key={c.id}
          lon={c.lon}
          lat={c.lat}
          label={c.name}
          delayClass={i === 0 ? 'cs-pin-delay-1' : 'cs-pin-delay-2'}
          // Martin is west of Howard — fan labels apart so they don’t collide.
          labelSide={c.id === 'martin' ? 'left' : c.id === 'howard' ? 'right' : 'center'}
        />
      ))}
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
          <TexasPermianMap />
        </div>
      </main>
    </div>
  )
}
