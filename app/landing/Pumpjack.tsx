/**
 * Exact approved silhouette (public/landing/pumpjack-*.png), split into
 * base / beam / crank layers so it can nod and spin without redrawing.
 *
 * Pivots in the 900×666 asset space:
 *   beam  — Samson saddle ~(380, 325)
 *   crank — hub ~(640, 520)
 */
export default function Pumpjack() {
  const beamPivot = { x: 380, y: 325 }
  const crankPivot = { x: 640, y: 520 }

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
