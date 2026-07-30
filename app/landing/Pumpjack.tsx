/**
 * Exact approved silhouette split into base / beam / crank layers.
 *
 * Pivots (900×666 asset space), measured from the PNG:
 *   beam  — Samson saddle where the walking beam sits
 *   crank — center of the counterweight hub
 *
 * Pitman rides with the beam (nods). Only the hub + counterweight spin.
 */
export default function Pumpjack() {
  // Measured from the PNG: beam sits ~y=200 at the Samson; hub hole ~y=488
  const beamPivot = { x: 385, y: 201 }
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

      {/* Counterweight spins about the hub */}
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

      {/* Beam + horsehead + pitman nod about the Samson pin */}
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
