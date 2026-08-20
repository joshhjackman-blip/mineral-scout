/**
 * Shared helpers for loading mineral owners on a CAD abstract.
 *
 * The /permits expand panel used to query Supabase from the browser and,
 * on miss/timeout, download the full *_parcels_enriched.geojson (~53–63 MB).
 * That download silently failed often enough that tracts with 200+ CAD leads
 * (e.g. Martin A-616) rendered as "No owners recorded".
 *
 * Owners are now resolved server-side via /api/tract-owners:
 *   1) service-role Supabase query on <county>_mineral_ownership
 *   2) in-memory index built once from the enriched parcels GeoJSON
 */

import { promises as fs } from 'fs'
import path from 'path'
import { COUNTIES, type CountyKey } from '@/lib/counties'

export type TractOwnerRow = {
  id: string | number
  owner_name: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  mailing_address?: string | null
  acreage: number | null
  ownership_pct: number | null
  operator_name?: string | null
  propensity_score?: number | null
  motivated?: boolean | null
  out_of_state?: boolean | null
  rrc_lease_id?: string | number | null
  sptb_code?: string | null
}

export const bareAbstract = (raw: unknown): string =>
  String(raw ?? '')
    .replace(/^A-\s*/i, '')
    .replace(/^\d{5}-/, '')
    .trim()
    .toUpperCase()

export function abstractVariants(abstract: string): string[] {
  const bare = bareAbstract(abstract)
  const raw = String(abstract ?? '').trim()
  return Array.from(
    new Set(
      [bare, bare ? `A-${bare}` : '', raw, raw.toUpperCase()]
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  )
}

export function sortOwnersByAcreage(owners: TractOwnerRow[]): TractOwnerRow[] {
  return [...owners]
    .filter((o) => String(o.owner_name ?? '').trim().length > 0)
    .sort((a, b) => Number(b.acreage ?? 0) - Number(a.acreage ?? 0))
}

type GlobalOwnersCache = {
  __tractOwnersByCounty?: Map<CountyKey, Map<string, TractOwnerRow[]>>
  __tractOwnersLoad?: Map<CountyKey, Promise<Map<string, TractOwnerRow[]>>>
}

function cacheRoot(): GlobalOwnersCache {
  return globalThis as unknown as GlobalOwnersCache
}

function assetOrigin(): string {
  const app = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (app) return app
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'https://getmineralmap.com'
}

function normalizeOwnerRows(raw: unknown): TractOwnerRow[] {
  if (!Array.isArray(raw)) return []
  return sortOwnersByAcreage(
    raw.map((row, idx) => {
      const o = (row ?? {}) as Record<string, unknown>
      return {
        id: typeof o.id === 'number' || typeof o.id === 'string' ? o.id : idx,
        owner_name: (o.owner_name as string | null) ?? null,
        mailing_city: (o.mailing_city as string | null) ?? null,
        mailing_state: (o.mailing_state as string | null) ?? null,
        mailing_zip: (o.mailing_zip as string | null) ?? null,
        mailing_address:
          (o.mailing_address as string | null) ??
          (o.address_1 as string | null) ??
          null,
        acreage: o.acreage == null ? null : Number(o.acreage),
        ownership_pct: o.ownership_pct == null ? null : Number(o.ownership_pct),
        operator_name: (o.operator_name as string | null) ?? null,
        propensity_score: o.propensity_score == null ? null : Number(o.propensity_score),
        motivated: o.motivated == null ? null : Boolean(o.motivated),
        out_of_state: o.out_of_state == null ? null : Boolean(o.out_of_state),
        rrc_lease_id: (o.rrc_lease_id as string | number | null) ?? null,
        sptb_code: (o.sptb_code as string | null) ?? null,
      }
    }),
  )
}

function indexFromGeoJson(gj: GeoJSON.FeatureCollection): Map<string, TractOwnerRow[]> {
  const index = new Map<string, TractOwnerRow[]>()
  for (const feature of gj.features ?? []) {
    const props = (feature.properties ?? {}) as Record<string, unknown>
    const bare = bareAbstract(
      props.ABSTRACT_L ?? props.abstract_label ?? props.ABSTRACT_N ?? props.abstract,
    )
    if (!bare) continue
    let raw: unknown = props.owners_json
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw)
      } catch {
        raw = []
      }
    }
    const owners = normalizeOwnerRows(raw)
    // Keep the first non-empty list if duplicates appear.
    const prev = index.get(bare)
    if (!prev || (prev.length === 0 && owners.length > 0)) {
      index.set(bare, owners)
    }
  }
  return index
}

async function readGeoJsonFromDisk(countyId: CountyKey): Promise<GeoJSON.FeatureCollection | null> {
  const cfg = COUNTIES[countyId]
  if (!cfg) return null
  const rel = cfg.geoJsonPath.replace(/^\//, '')
  const candidates = [
    path.join(process.cwd(), 'public', rel),
    path.join(process.cwd(), rel),
  ]
  for (const filePath of candidates) {
    try {
      const text = await fs.readFile(filePath, 'utf8')
      return JSON.parse(text) as GeoJSON.FeatureCollection
    } catch {
      // try next candidate / fall through to CDN fetch
    }
  }
  return null
}

async function readGeoJsonFromCdn(countyId: CountyKey): Promise<GeoJSON.FeatureCollection | null> {
  const cfg = COUNTIES[countyId]
  if (!cfg) return null
  const url = `${assetOrigin()}${cfg.geoJsonPath}`
  try {
    const res = await fetch(url, { next: { revalidate: 300 } })
    if (!res.ok) return null
    return (await res.json()) as GeoJSON.FeatureCollection
  } catch {
    return null
  }
}

async function loadCountyOwnerIndex(countyId: CountyKey): Promise<Map<string, TractOwnerRow[]>> {
  const root = cacheRoot()
  if (!root.__tractOwnersByCounty) root.__tractOwnersByCounty = new Map()
  const hit = root.__tractOwnersByCounty.get(countyId)
  if (hit) return hit

  if (!root.__tractOwnersLoad) root.__tractOwnersLoad = new Map()
  const inflight = root.__tractOwnersLoad.get(countyId)
  if (inflight) return inflight

  const loadPromise = (async () => {
    const gj =
      (await readGeoJsonFromDisk(countyId)) ??
      (await readGeoJsonFromCdn(countyId))
    const index = gj ? indexFromGeoJson(gj) : new Map<string, TractOwnerRow[]>()
    root.__tractOwnersByCounty!.set(countyId, index)
    root.__tractOwnersLoad!.delete(countyId)
    return index
  })()

  root.__tractOwnersLoad.set(countyId, loadPromise)
  return loadPromise
}

/** CAD / enriched-geojson owners for one abstract (server-side, cached). */
export async function loadOwnersFromEnrichedGeoJson(
  countyId: CountyKey,
  abstract: string,
): Promise<TractOwnerRow[]> {
  if (!COUNTIES[countyId]) return []
  const index = await loadCountyOwnerIndex(countyId)
  return index.get(bareAbstract(abstract)) ?? []
}
