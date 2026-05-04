export type County = {
  id: string
  name: string
  state: string
  displayName: string
  mapCenter: [number, number]
  mapZoom: number
  fips: string
  totalLeads: number
  fipsCode: string
  ownershipTable: string
  wellsTable: string
  geoJsonPath: string
  // Slim variant of geoJsonPath used by the Mapbox renderer. Drops the
  // ~95–98% of bytes that come from the embedded `owners_json` payload —
  // those owners are still loaded from the full file in `app/page.tsx` for
  // the side panel, but Mapbox doesn't need them and was choking on the
  // 24/53 MB FeatureCollections during low/medium-zoom tile generation.
  mapGeoJsonPath: string
  stats: { val: string; lbl: string }[]
  breakdown: { operator: string; pct: number }[]
  ownershipPctIsDecimal: boolean  // true = Howard style, false = Gonzales style
  abstractField: string           // field name in GeoJSON for abstract label
  nriCode: string                 // sptb_code value that means NRI (skip NRA calc)
  // Lowercased substrings used by the CRM to derive a deal's county from
  // its operator_name when no `county` column is set on the row. New
  // counties just push their operator names here; CRM picks them up
  // automatically.
  operatorPatterns: string[]
  // How the wells API joins wells to a tract/owner. Howard owners reference
  // the abstract directly; Gonzales owners carry an `rrc_lease_id` that
  // matches `gonzales_wells.rrc_lease_id`. Add a new strategy here when a
  // future county uses a different join key.
  wellsJoinStrategy: 'abstract' | 'rrc_lease_id'
}

export type CountyKey = keyof typeof COUNTIES

export const COUNTIES: Record<string, County> = {
  gonzales: {
    id: 'gonzales',
    name: 'Gonzales',
    state: 'TX',
    displayName: 'Gonzales County, TX',
    mapCenter: [-97.45, 29.45],
    mapZoom: 10,
    fips: '48177',
    totalLeads: 73000,
    fipsCode: '177',
    ownershipTable: 'gonzales_mineral_ownership',
    wellsTable: 'gonzales_wells',
    geoJsonPath: '/gonzales_parcels_enriched.geojson',
    mapGeoJsonPath: '/gonzales_parcels_map.geojson',
    ownershipPctIsDecimal: false,
    abstractField: 'ABSTRACT_L',
    nriCode: 'XV',
    operatorPatterns: ['eog', 'baytex', 'marathon', 'auterra'],
    wellsJoinStrategy: 'rrc_lease_id',
    stats: [
      { val: '73,430', lbl: 'Total owners' },
      { val: '3,950', lbl: 'Hot (8-10)' },
      { val: '19,047', lbl: 'Motivated (5-7)' },
      { val: '46,401', lbl: 'Prospect (2-4)' },
      { val: '207', lbl: 'Survey abstracts' },
      { val: '4,512', lbl: 'Active wells' },
    ],
    breakdown: [
      { operator: 'EOG Resources', pct: 68 },
      { operator: 'Baytex Energy', pct: 21 },
      { operator: 'Marathon Oil', pct: 7 },
      { operator: 'Other', pct: 4 },
    ],
  },
  howard: {
    id: 'howard',
    name: 'Howard',
    state: 'TX',
    displayName: 'Howard County, TX',
    mapCenter: [-101.45, 32.30],
    mapZoom: 10,
    fips: '48227',
    totalLeads: 216000,
    fipsCode: '227',
    ownershipTable: 'howard_mineral_ownership',
    wellsTable: 'howard_wells',
    geoJsonPath: '/howard_parcels_enriched.geojson',
    mapGeoJsonPath: '/howard_parcels_map.geojson',
    ownershipPctIsDecimal: true,
    abstractField: 'ABSTRACT_L',
    nriCode: '',
    operatorPatterns: [
      'apache', 'diamondback', 'sm energy', 'ovintiv',
      'highpeak', 'scout energy', 'vital energy', 'birch operations',
      'surge operating',
    ],
    wellsJoinStrategy: 'abstract',
    stats: [
      { val: '215,592', lbl: 'Total owners' },
      { val: '22,072', lbl: 'Hot (8-10)' },
      { val: '33,096', lbl: 'Motivated (5-7)' },
      { val: '134,278', lbl: 'Prospect (2-4)' },
      { val: '987', lbl: 'Survey abstracts' },
      { val: '17,483', lbl: 'Active wells' },
    ],
    breakdown: [
      { operator: 'Apache Corporation', pct: 31 },
      { operator: 'Diamondback E&P', pct: 28 },
      { operator: 'SM Energy', pct: 18 },
      { operator: 'Other', pct: 23 },
    ],
  },
}
