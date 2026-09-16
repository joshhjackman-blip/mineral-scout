// Injection / disposal / SWD wells. They sit next to PDP laterals in
// teal-vs-green and are not prospecting targets, so the map and tract
// lists drop them.

export function isInjectionWell(input: {
  kind?: string | null
  status?: string | null
  well_status?: string | null
  lease_name?: string | null
}): boolean {
  if (String(input.kind ?? '').toLowerCase() === 'injection') return true
  const status = String(input.status ?? input.well_status ?? '').toUpperCase()
  if (status.includes('INJECT') || status.includes('DISPOS') || /\bSWD\b/.test(status)) {
    return true
  }
  const lease = String(input.lease_name ?? '').toUpperCase()
  return (
    /(^|\s)SWD(\s|$)/.test(lease) ||
    lease.includes('DISPOSAL') ||
    lease.includes('INJECTION') ||
    lease.includes('WATER GATHERING')
  )
}

export function omitInjectionWellFeatures(
  fc: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.filter((feature) => {
      const props = (feature.properties ?? {}) as Record<string, unknown>
      return !isInjectionWell({
        kind: String(props.kind ?? ''),
        status: String(props.status ?? ''),
        lease_name: String(props.lease ?? props.lease_name ?? ''),
      })
    }),
  }
}
