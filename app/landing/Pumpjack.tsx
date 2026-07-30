/**
 * Solid pumpjack silhouette matching public/landing/pumpjack.png,
 * split so the walking beam can nod and the crank can spin.
 */
export default function Pumpjack() {
  const ink = '#0A0A0A'
  return (
    <svg
      viewBox="0 0 900 666"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="cs-pumpjack"
    >
      <g fill={ink}>
        {/* Skid */}
        <rect x="24" y="598" width="852" height="36" rx="3" />
        <rect x="40" y="634" width="820" height="14" rx="2" />

        {/* Wellhead */}
        <rect x="58" y="515" width="64" height="83" rx="3" />
        <rect x="48" y="495" width="84" height="22" rx="2" />
        <rect x="70" y="472" width="40" height="24" rx="2" />
        <rect x="36" y="540" width="30" height="11" rx="2" />
        <rect x="114" y="540" width="30" height="11" rx="2" />
        <rect x="36" y="565" width="30" height="11" rx="2" />
        <rect x="114" y="565" width="30" height="11" rx="2" />

        {/* Samson A-frame */}
        <path d="M278 598 360 318h28L340 598Z" />
        <path d="M512 598 400 318h-28L450 598Z" />
        <rect x="345" y="390" width="60" height="11" />
        <rect x="330" y="470" width="90" height="11" />
        <rect x="315" y="545" width="120" height="11" />
        <rect x="355" y="298" width="50" height="30" rx="2" />

        {/* Gearbox + motor (open so crank reads clearly) */}
        <path d="M700 598V520c0-36 22-58 55-58h55c28 0 48 24 48 55v81Z" />
        <rect x="800" y="505" width="68" height="93" rx="10" />
        <circle cx="834" cy="492" r="9" />
      </g>

      {/* Crank + counterweight — spin about (640, 515) */}
      <g transform="translate(640 515)">
        <g className="cs-pump-crank">
          <g transform="translate(-640 -515)" fill={ink}>
            <circle cx="640" cy="515" r="26" />
            <rect x="628" y="385" width="24" height="140" rx="4" />
            {/* Crescent counterweight */}
            <path d="M575 515A75 75 0 0 1 705 515L680 515A50 50 0 0 0 600 515Z" />
            <path d="M580 500C580 440 640 395 710 435C720 460 715 500 700 515H580C570 510 580 500 580 500Z" />
            <circle cx="640" cy="400" r="14" />
            {/* Pitman */}
            <rect x="631" y="275" width="18" height="130" rx="3" />
            <rect x="616" y="262" width="48" height="20" rx="3" />
          </g>
        </g>
      </g>

      {/* Walking beam + horsehead — nod about (380, 320) */}
      <g transform="translate(380 320)">
        <g className="cs-pump-beam">
          <g transform="translate(-380 -320)" fill={ink}>
            <rect x="175" y="296" width="490" height="46" rx="4" />
            <path d="M640 300h75l22 19-22 19H640Z" />
            <rect x="695" y="285" width="32" height="66" rx="3" />
            {/* Horsehead */}
            <path d="M185 280C130 275 80 310 60 370C45 420 55 475 100 510L140 535C165 550 195 535 210 505L235 450V305H185Z" />
            <rect x="105" y="515" width="12" height="90" rx="2" />
            <rect x="88" y="508" width="46" height="14" rx="2" />
            <circle cx="380" cy="320" r="16" />
          </g>
        </g>
      </g>
    </svg>
  )
}
