export type County = {
  id: string
  name: string
  state: string
  displayName: string
  mapCenter: [number, number]
  mapZoom: number
  fips: string
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
  breakdown: { operator: string; pct: number }[]
  ownershipPctIsDecimal: boolean  // true = Howard style
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

// Gonzales was archived 2026-07-17. All its Supabase tables
// (gonzales_mineral_ownership, gonzales_wells, gonzales_permits,
// tract_development_status rows), public geojson files, and load
// scripts remain in place; only the UI + cron references were
// removed to reduce compute and focus the product on West Texas.
// To reactivate, re-add the Gonzales block from git history at
// commit 9afe6ef^ and re-enable it in the cron workflows.

export const COUNTIES: Record<string, County> = {
  howard: {
    id: 'howard',
    name: 'Howard',
    state: 'TX',
    displayName: 'Howard County, TX',
    mapCenter: [-101.45, 32.30],
    mapZoom: 10,
    fips: '48227',
    fipsCode: '227',
    ownershipTable: 'howard_mineral_ownership',
    wellsTable: 'howard_wells',
    geoJsonPath: '/howard_parcels_enriched.geojson',
    mapGeoJsonPath: '/howard_parcels_map.geojson?v=pdp-2026-07-16b',
    ownershipPctIsDecimal: true,
    abstractField: 'ABSTRACT_L',
    nriCode: '',
    operatorPatterns: [
      'apache', 'diamondback', 'sm energy', 'ovintiv',
      'highpeak', 'scout energy', 'vital energy', 'birch operations',
      'surge operating',
    ],
    wellsJoinStrategy: 'abstract',
    breakdown: [
      { operator: 'Apache Corporation', pct: 31 },
      { operator: 'Diamondback E&P', pct: 28 },
      { operator: 'SM Energy', pct: 18 },
      { operator: 'Other', pct: 23 },
    ],
  },
  martin: {
    id: 'martin',
    name: 'Martin',
    state: 'TX',
    displayName: 'Martin County, TX',
    // Stanton (county seat) sits near 32.13°N, 101.79°W; the county centroid
    // is a touch north and west of that.
    mapCenter: [-101.95, 32.30],
    mapZoom: 10,
    fips: '48317',
    fipsCode: '317',
    ownershipTable: 'martin_mineral_ownership',
    wellsTable: 'martin_wells',
    geoJsonPath: '/martin_parcels_enriched.geojson',
    mapGeoJsonPath: '/martin_parcels_map.geojson?v=pdp-2026-07-16b',
    // Mirrors Howard: CAD ownership rolls express interest as a 0–1 decimal
    // that gets multiplied by 100 for display.
    ownershipPctIsDecimal: true,
    abstractField: 'ABSTRACT_L',
    nriCode: '',
    // Top operators by row count from the 2025 ownership roll. Diamondback
    // and Pioneer/ExxonMobil dominate; Birch and Ovintiv each hold a few %;
    // the long tail (Endeavor, Apache, COG, Permian Resources, Concho/Conoco)
    // shows up on enough leases to be worth fuzzy-matching for CRM
    // auto-county detection.
    operatorPatterns: [
      'diamondback', 'pioneer', 'exxon', 'xto',
      'birch', 'ovintiv', 'cog operating', 'endeavor',
      'permian resources', 'apache', 'concho', 'conoco',
    ],
    wellsJoinStrategy: 'abstract',
    breakdown: [
      { operator: 'Diamondback E&P', pct: 35 },
      { operator: 'Pioneer / ExxonMobil', pct: 29 },
      { operator: 'Ovintiv + Birch', pct: 15 },
      { operator: 'Other', pct: 21 },
    ],
  },
  midland: {
    id: 'midland',
    name: 'Midland',
    state: 'TX',
    displayName: 'Midland County, TX',
    // Midland (county seat / city center) sits near 32.00°N, 102.08°W. The
    // county is roughly square; centering on the seat looks right at z10.
    mapCenter: [-102.03, 31.95],
    mapZoom: 10,
    fips: '48329',
    // StratMap parcels loaded so tracts render on the map; owner/lead
    // counts stay at zero until the Midland CAD tax roll ingestion runs.
    totalLeads: 0,
    fipsCode: '329',
    ownershipTable: 'midland_mineral_ownership',
    wellsTable: 'midland_wells',
    geoJsonPath: '/midland_parcels_enriched.geojson',
    mapGeoJsonPath: '/midland_parcels_map.geojson',
    ownershipPctIsDecimal: true,
    abstractField: 'ABSTRACT_L',
    nriCode: '',
    // Filled in after the tax roll lands; keeps CRM auto-county detection
    // from producing false positives on unrelated Permian operators.
    operatorPatterns: [],
    wellsJoinStrategy: 'abstract',
    stats: [
      { val: '0', lbl: 'Total owners' },
      { val: '0', lbl: 'Hot (8-10)' },
      { val: '0', lbl: 'Motivated (5-7)' },
      { val: '0', lbl: 'Prospect (2-4)' },
      { val: '75,645', lbl: 'Parcels loaded' },
      { val: '0', lbl: 'Active wells' },
    ],
    breakdown: [
      { operator: 'Pending tax roll', pct: 0 },
    ],
  },
  loving: {
    id: 'loving',
    name: 'Loving',
    state: 'TX',
    displayName: 'Loving County, TX',
    // Mentone (county seat) sits near 31.70°N, 103.60°W. Loving is the
    // least-populated county in the US so the parcels cluster loosely; a
    // slightly north-of-seat center keeps the whole footprint in view.
    mapCenter: [-103.60, 31.83],
    mapZoom: 10,
    fips: '48301',
    totalLeads: 0,
    fipsCode: '301',
    ownershipTable: 'loving_mineral_ownership',
    wellsTable: 'loving_wells',
    geoJsonPath: '/loving_parcels_enriched.geojson',
    mapGeoJsonPath: '/loving_parcels_map.geojson',
    ownershipPctIsDecimal: true,
    abstractField: 'ABSTRACT_L',
    nriCode: '',
    operatorPatterns: [],
    wellsJoinStrategy: 'abstract',
    stats: [
      { val: '0', lbl: 'Total owners' },
      { val: '0', lbl: 'Hot (8-10)' },
      { val: '0', lbl: 'Motivated (5-7)' },
      { val: '0', lbl: 'Prospect (2-4)' },
      { val: '1,914', lbl: 'Parcels loaded' },
      { val: '0', lbl: 'Active wells' },
    ],
    breakdown: [
      { operator: 'Pending tax roll', pct: 0 },
    ],
  },
}
