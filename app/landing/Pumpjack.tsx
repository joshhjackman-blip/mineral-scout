/**
 * Exact approved silhouette, layered for real pumpjack motion:
 * - counterweight spins on the hub
 * - walking beam + horsehead nod on the Samson saddle (underside contact)
 * - polished rod translates straight up/down (does not swing with the beam)
 */
export default function Pumpjack() {
  // Underside of the beam where it sits on the Samson crown — not mid-beam,
  // so the beam doesn't look like it's being pulled off the post.
  const beamPivot = { x: 385, y: 216 }
  const crankPivot = { x: 628, y: 488 }

  return (
    <svg
      viewBox="0 0 900 666"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-pumpjack"
    >
      <image
        href="/landing/pumpjack-base.png"
        width="900"
        height="666"
        preserveAspectRatio="xMidYMid meet"
      />

      {/* Counterweight — spin about hub */}
      <g transform={`translate(${crankPivot.x} ${crankPivot.y})`}>
        <g className="cs-pump-crank">
          <image
            href="/landing/pumpjack-crank.png"
            x={-crankPivot.x}
            y={-crankPivot.y}
            width="900"
            height="666"
            preserveAspectRatio="xMidYMid meet"
          />
        </g>
      </g>

      {/* Polished rod — vertical stroke only */}
      <g className="cs-pump-rod">
        <image
          href="/landing/pumpjack-rod.png"
          width="900"
          height="666"
          preserveAspectRatio="xMidYMid meet"
        />
      </g>

      {/* Beam + horsehead + pitman — nod about saddle pin */}
      <g transform={`translate(${beamPivot.x} ${beamPivot.y})`}>
        <g className="cs-pump-beam">
          <image
            href="/landing/pumpjack-beam.png"
            x={-beamPivot.x}
            y={-beamPivot.y}
            width="900"
            height="666"
            preserveAspectRatio="xMidYMid meet"
          />
        </g>
      </g>
    </svg>
  )
}
