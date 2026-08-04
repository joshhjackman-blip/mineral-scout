/**
 * Static solid pumpjack silhouette — the approved asset.
 * Layered CSS animation of a flat PNG cannot keep the joints
 * connected, so we do not fake mechanical motion here.
 */
export default function Pumpjack() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/landing/pumpjack.png"
      alt=""
      aria-hidden="true"
      className="cs-pumpjack"
      draggable={false}
    />
  )
}
