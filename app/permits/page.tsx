'use client'

// Recent permits page — surfaces every drilling permit filed or
// approved across our active counties in the last N days, and behind
// each permit exposes the owners on the tract it landed on so brokers
// can go call them. Data flow:
//
//   1. Query every <county>_permits table in parallel, filtered to
//      the selected date window on approved_date / filed_date.
//   2. For each permit that carries lat/lon, fetch that county's
//      parcels GeoJSON once, cache it, and run point-in-polygon to
//      resolve the abstract label. Permits without a lat/lon fall
//      back to a lease-name lookup.
//   3. For each unique (county, abstract) touched, fetch the owners
//      from <county>_mineral_ownership using the same tiered fallback
//      the OwnerDrawer uses (Howard/Martin have different columns
//      than Gonzales).
//   4. Render one card per permit with an expandable owners list;
//      each owner has Call / Email / Skip trace / Open in map actions.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CountyKey } from '@/lib/counties'
import { COUNTIES } from '@/lib/counties'
import AppLogo from '@/app/components/AppLogo'

type PermitStatus = 'approved' | 'pending' | 'other'

type RawPermit = {
  id: number | string
  permit_number: string | null
  api_number: string | null
  operator_name: string | null
  lease_name: string | null
  county_code: string | null
  latitude: number | string | null
  longitude: number | string | null
  permit_type: string | null
  status: string | null
  filed_date: string | null
  approved_date: string | null
}

type EnrichedPermit = RawPermit & {
  county_id: CountyKey
  county_display: string
  status_bucket: PermitStatus
  best_date: string | null
  abstract: string | null
  owner_load_state: 'idle' | 'loading' | 'loaded' | 'error'
  owner_count: number
}

type OwnerRow = {
  id?: number | string
  owner_name: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  acreage?: number | null
  ownership_pct?: number | null
  phone?: string | null
  email?: string | null
}

type WindowChoice = 7 | 30 | 90 | 365

// Every county the permits page pulls from. Kept in sync with the
// daily RRC scraper's default county list. Counties whose _permits
// table doesn't exist yet return an empty array from Supabase and
// are silently skipped downstream.
const PERMIT_COUNTIES: CountyKey[] = [
  'gonzales', 'howard', 'martin',
]

// Slim column list to keep the payload small when hitting the 13
// county tables in parallel.
const PERMIT_COLUMNS =
  'id, permit_number, api_number, operator_name, lease_name, county_code, latitude, longitude, permit_type, status, filed_date, approved_date'

const bareAbstract = (raw: unknown): string =>
  String(raw ?? '')
    .replace(/^A-\s*/i, '')
    .replace(/^\d{5}-/, '')
    .trim()
    .toUpperCase()

function statusToBucket(status: string | null | undefined): PermitStatus {
  const s = String(status ?? '').toUpperCase()
  if (s.includes('APPROV') || s.includes('ISSUED') || s.includes('PRODUCING')) return 'approved'
  if (s.includes('PEND') || s.includes('FILED') || s.includes('SUBMIT')) return 'pending'
  return 'other'
}

function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  const now = Date.now()
  return Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24))
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

// Point-in-ring / point-in-geometry — copies of the isPointInRing +
// isPointInGeometry helpers in app/page.tsx. Not extracted to a shared
// module yet because they'll likely evolve differently: the permits
// page only needs polygon containment for permit -> abstract resolution
// and can accept the perf cost of pure-JS ray casting on the ~1k-3k
// tract features per county.
function isPointInRing(lon: number, lat: number, ring: readonly (readonly number[])[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0])
    const yi = Number(ring[i][1])
    const xj = Number(ring[j][0])
    const yj = Number(ring[j][1])
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function isPointInGeometry(
  lon: number,
  lat: number,
  geometry: GeoJSON.Geometry | null | undefined,
): boolean {
  if (!geometry) return false
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as unknown as number[][][]
    if (rings.length === 0) return false
    if (!isPointInRing(lon, lat, rings[0])) return false
    for (let i = 1; i < rings.length; i += 1) {
      if (isPointInRing(lon, lat, rings[i])) return false
    }
    return true
  }
  if (geometry.type === 'MultiPolygon') {
    const polys = geometry.coordinates as unknown as number[][][][]
    for (const poly of polys) {
      if (poly.length === 0) continue
      if (!isPointInRing(lon, lat, poly[0])) continue
      let insideHole = false
      for (let i = 1; i < poly.length; i += 1) {
        if (isPointInRing(lon, lat, poly[i])) { insideHole = true; break }
      }
      if (!insideHole) return true
    }
  }
  return false
}

// Cache the per-county parcels GeoJSON so switching / expanding
// permits doesn't refetch a 5+ MB file. Keyed by county id.
const parcelsCache = new Map<CountyKey, GeoJSON.FeatureCollection>()
async function loadParcels(countyId: CountyKey): Promise<GeoJSON.FeatureCollection | null> {
  const cached = parcelsCache.get(countyId)
  if (cached) return cached
  const cfg = COUNTIES[countyId]
  if (!cfg) return null
  try {
    const path = cfg.mapGeoJsonPath ?? cfg.geoJsonPath
    const res = await fetch(path)
    if (!res.ok) return null
    const gj = (await res.json()) as GeoJSON.FeatureCollection
    parcelsCache.set(countyId, gj)
    return gj
  } catch {
    return null
  }
}

async function abstractForPermit(permit: RawPermit, countyId: CountyKey): Promise<string | null> {
  const lat = Number(permit.latitude)
  const lon = Number(permit.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  const gj = await loadParcels(countyId)
  if (!gj) return null
  for (const feature of gj.features) {
    if (isPointInGeometry(lon, lat, feature.geometry)) {
      const props = (feature.properties ?? {}) as Record<string, unknown>
      const abstract = String(
        props.ABSTRACT_L ?? props.abstract_label ?? props.ABSTRACT_N ?? '',
      ).trim()
      if (abstract) return abstract
    }
  }
  return null
}

// Owners for a (county, abstract) — mirrors OwnerDrawer's tiered
// column fallback so Howard/Martin (block/section/survey shape) and
// Gonzales (county_lease_name shape) both work.
async function loadOwnersForAbstract(
  countyId: CountyKey,
  abstract: string,
): Promise<OwnerRow[]> {
  const cfg = COUNTIES[countyId]
  if (!cfg) return []
  const bare = bareAbstract(abstract)

  const runQuery = async (cols: string) =>
    supabase
      .from(cfg.ownershipTable)
      .select(cols)
      .or(`abstract.eq.${bare},abstract.eq.A-${bare},abstract.eq.${abstract}`)
      .limit(200)

  const HOWARD_COLS = 'id, owner_name, mailing_city, mailing_state, mailing_zip, acreage, ownership_pct'
  const MIN_COLS    = 'id, owner_name, mailing_city, mailing_state'

  const isMissingColumnError = (msg: string) => {
    const m = msg.toLowerCase()
    return m.includes('column') && (m.includes('does not exist') || m.includes('not find'))
  }

  let result = await runQuery(HOWARD_COLS)
  if (result.error && isMissingColumnError(result.error.message)) {
    result = await runQuery(MIN_COLS)
  }
  if (result.error) return []
  return ((result.data ?? []) as unknown as OwnerRow[])
    .filter((o) => String(o.owner_name ?? '').trim().length > 0)
    .sort((a, b) =>
      Number(b.acreage ?? 0) - Number(a.acreage ?? 0),
    )
}

// Bulk cached-only phone/email lookup so we can show contact info in
// the expanded permit card without triggering skip-trace on every
// owner. Uses the public skip_trace_cache table populated by past
// skip-trace runs.
async function loadCachedContacts(
  ownerNames: string[],
): Promise<Record<string, { phone?: string | null; email?: string | null }>> {
  if (ownerNames.length === 0) return {}
  const uniq = Array.from(new Set(ownerNames.filter(Boolean)))
  const upper = uniq.map((n) => n.toUpperCase())
  const { data } = await supabase
    .from('skip_trace_cache')
    .select('owner_name, phones, emails')
    .in('owner_name', upper)
  const out: Record<string, { phone?: string | null; email?: string | null }> = {}
  for (const row of (data ?? []) as Array<{
    owner_name: string
    phones?: string[] | null
    emails?: string[] | null
  }>) {
    const key = String(row.owner_name ?? '').toUpperCase()
    out[key] = {
      phone: row.phones?.[0] ?? null,
      email: row.emails?.[0] ?? null,
    }
  }
  return out
}

export default function PermitsPage() {
  const [permits, setPermits] = useState<EnrichedPermit[]>([])
  const [loading, setLoading] = useState(true)
  // Default window: last 90 days. RRC's public bulk permit exports
  // (EWA snapshots) usually lag the current date by 4-12 weeks — a
  // 7-day window would show zero permits until we upgrade to a paid
  // real-time feed. Brokers still get plenty of leads at 90 days.
  const [windowDays, setWindowDays] = useState<WindowChoice>(90)
  const [statusFilter, setStatusFilter] = useState<'all' | PermitStatus>('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [ownersByPermit, setOwnersByPermit] = useState<Record<string, OwnerRow[]>>({})
  const [ownerLoading, setOwnerLoading] = useState<Record<string, boolean>>({})

  // Fetch permits from every registered county in parallel and
  // resolve each permit's abstract via point-in-polygon on the
  // county's parcels GeoJSON. Runs whenever windowDays changes.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const since = isoDaysAgo(windowDays)

    const fetchAll = async () => {
      const perCounty = await Promise.all(
        PERMIT_COUNTIES.map(async (countyId) => {
          const cfg = COUNTIES[countyId]
          if (!cfg) return [] as EnrichedPermit[]
          // Filter on either date — Supabase doesn't support .or with
          // a range shorthand cleanly, so we grab everything from the
          // last N days by best_date (max of the two) client-side.
          const { data, error } = await supabase
            .from(`${countyId}_permits`)
            .select(PERMIT_COLUMNS)
            .or(`filed_date.gte.${since},approved_date.gte.${since}`)
            .limit(500)
          if (error) {
            // Table missing for a county whose migration isn't in yet.
            return [] as EnrichedPermit[]
          }
          return (data as RawPermit[]).map<EnrichedPermit>((row) => {
            const best = row.approved_date && row.filed_date
              ? (row.approved_date > row.filed_date ? row.approved_date : row.filed_date)
              : (row.approved_date ?? row.filed_date ?? null)
            return {
              ...row,
              county_id: countyId,
              county_display: cfg.displayName,
              status_bucket: statusToBucket(row.status),
              best_date: best,
              abstract: null,
              owner_load_state: 'idle',
              owner_count: 0,
            }
          })
        }),
      )

      if (cancelled) return
      const merged = perCounty.flat()

      // Resolve abstract for each permit via point-in-polygon. Runs
      // in parallel per county to keep total wall-clock time down.
      const withAbstracts = await Promise.all(
        merged.map(async (p) => ({
          ...p,
          abstract: await abstractForPermit(p, p.county_id),
        })),
      )

      if (cancelled) return
      withAbstracts.sort((a, b) => String(b.best_date ?? '').localeCompare(String(a.best_date ?? '')))
      setPermits(withAbstracts)
      setLoading(false)
    }

    void fetchAll()
    return () => {
      cancelled = true
    }
  }, [windowDays])

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return permits
    return permits.filter((p) => p.status_bucket === statusFilter)
  }, [permits, statusFilter])

  const approvedCount = permits.filter((p) => p.status_bucket === 'approved').length
  const pendingCount = permits.filter((p) => p.status_bucket === 'pending').length

  const toggleExpand = useCallback((permitKey: string, permit: EnrichedPermit) => {
    setExpanded((prev) => {
      const wasOpen = !!prev[permitKey]
      const next = { ...prev, [permitKey]: !wasOpen }
      if (wasOpen) return next
      // First open — fetch owners on demand.
      if (!ownersByPermit[permitKey] && !ownerLoading[permitKey]) {
        void (async () => {
          if (!permit.abstract) {
            setOwnersByPermit((cur) => ({ ...cur, [permitKey]: [] }))
            return
          }
          setOwnerLoading((cur) => ({ ...cur, [permitKey]: true }))
          const owners = await loadOwnersForAbstract(permit.county_id, permit.abstract)
          const contacts = await loadCachedContacts(owners.map((o) => String(o.owner_name ?? '')))
          const merged = owners.map((o) => {
            const key = String(o.owner_name ?? '').toUpperCase()
            const c = contacts[key] ?? {}
            return { ...o, phone: c.phone, email: c.email }
          })
          setOwnersByPermit((cur) => ({ ...cur, [permitKey]: merged }))
          setOwnerLoading((cur) => ({ ...cur, [permitKey]: false }))
        })()
      }
      return next
    })
  }, [ownersByPermit, ownerLoading])

  return (
    <div style={{ minHeight: '100dvh', background: '#F8FAFC', display: 'flex', flexDirection: 'column' }}>
      {/* Header — mirrors the map page's chrome with the same subtle
          photo texture, so the whole app reads as one product. */}
      <div
        style={{
          height: 52,
          minHeight: 52,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.98) 100%), " +
            "url('/hero-permian.jpg') center/cover no-repeat",
          borderBottom: '1px solid #E5E7EB',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 20px',
        }}
      >
        <Link href="/" style={{ textDecoration: 'none' }}>
          <AppLogo width={150} />
        </Link>
        <span style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Public Sans, system-ui, sans-serif' }}>·</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#111827', fontFamily: 'Public Sans, system-ui, sans-serif' }}>
          Recent Permits
        </span>
        <div style={{ flex: 1 }} />
        <Link
          href="/"
          style={{
            fontSize: 12,
            color: '#6B7280',
            textDecoration: 'none',
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #E5E7EB',
            fontFamily: 'Public Sans, system-ui, sans-serif',
          }}
        >
          ← Map
        </Link>
      </div>

      <div style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: '24px 20px 40px', flex: 1 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{
            fontFamily: 'Libre Baskerville, Georgia, serif',
            fontSize: 28,
            fontWeight: 700,
            color: '#111827',
            marginBottom: 6,
          }}>
            Permits — last {windowDays >= 365 ? 'year' : `${windowDays} days`}
          </h1>
          <p style={{
            fontFamily: 'Public Sans, system-ui, sans-serif',
            fontSize: 14,
            color: '#6B7280',
            marginBottom: 0,
          }}>
            {loading
              ? 'Loading permits across all counties…'
              : `${permits.length} permit${permits.length === 1 ? '' : 's'} · ${approvedCount} approved · ${pendingCount} pending`}
          </p>
        </div>

        {/* Filter row */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Public Sans, system-ui, sans-serif', marginRight: 4 }}>
              Window:
            </span>
            {([
              { d: 7   as WindowChoice, label: '7 days' },
              { d: 30  as WindowChoice, label: '30 days' },
              { d: 90  as WindowChoice, label: '90 days' },
              { d: 365 as WindowChoice, label: '1 year' },
            ]).map(({ d, label }) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                style={{
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: 'Public Sans, system-ui, sans-serif',
                  background: windowDays === d ? '#0F172A' : '#FFFFFF',
                  border: windowDays === d ? '1px solid #0F172A' : '1px solid #E5E7EB',
                  color: windowDays === d ? '#FFFFFF' : '#6B7280',
                  fontWeight: windowDays === d ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Public Sans, system-ui, sans-serif', marginRight: 4 }}>
              Status:
            </span>
            {([
              { key: 'all',      label: 'All',      color: '#0F172A' },
              { key: 'approved', label: 'Approved', color: '#2563EB' },
              { key: 'pending',  label: 'Pending',  color: '#EA580C' },
            ] as const).map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                style={{
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: 'Public Sans, system-ui, sans-serif',
                  background: statusFilter === s.key ? `${s.color}15` : '#FFFFFF',
                  border: statusFilter === s.key ? `1px solid ${s.color}` : '1px solid #E5E7EB',
                  color: statusFilter === s.key ? s.color : '#6B7280',
                  fontWeight: statusFilter === s.key ? 600 : 400,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Permit list */}
        {loading ? (
          <div style={{
            padding: 40,
            textAlign: 'center',
            fontSize: 14,
            color: '#6B7280',
            fontFamily: 'Public Sans, system-ui, sans-serif',
          }}>
            Fetching permits from all counties…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            padding: 40,
            textAlign: 'center',
            fontSize: 14,
            color: '#6B7280',
            fontFamily: 'Public Sans, system-ui, sans-serif',
            background: '#FFFFFF',
            borderRadius: 8,
            border: '1px solid #E5E7EB',
          }}>
            No permits match the current filters.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map((permit, i) => {
              const permitKey = `${permit.county_id}-${permit.id ?? i}`
              const isOpen = !!expanded[permitKey]
              const owners = ownersByPermit[permitKey] ?? []
              const loadingOwners = !!ownerLoading[permitKey]
              const days = daysAgo(permit.best_date)
              const dayLabel = days === 0 ? 'Today'
                : days === 1 ? 'Yesterday'
                : days != null ? `${days} days ago`
                : 'Date unknown'
              return (
                <div
                  key={permitKey}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E5E7EB',
                    borderRadius: 10,
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
                  }}
                >
                  <button
                    onClick={() => toggleExpand(permitKey, permit)}
                    style={{
                      width: '100%',
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: 14,
                      alignItems: 'center',
                      padding: '14px 18px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'Public Sans, system-ui, sans-serif',
                    }}
                  >
                    <StatusBadge status={permit.status_bucket} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#111827',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {permit.lease_name || permit.permit_number || 'Unnamed permit'}
                      </div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                        {permit.operator_name || 'Unknown operator'}
                        {' · '}
                        {permit.county_display}
                        {permit.abstract && (
                          <> · <span style={{ fontFamily: 'monospace' }}>{permit.abstract}</span></>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: '#6B7280' }}>{dayLabel}</span>
                      <span style={{
                        display: 'inline-block',
                        transform: isOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.15s',
                        color: '#94A3B8',
                        fontSize: 12,
                      }}>▼</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div style={{
                      borderTop: '1px solid #F3F4F6',
                      background: '#FAFBFC',
                      padding: '14px 18px',
                    }}>
                      {!permit.abstract ? (
                        <div style={{ fontSize: 12, color: '#94A3B8', fontFamily: 'Public Sans, system-ui, sans-serif' }}>
                          Couldn&apos;t match this permit to a tract (missing lat/lon).
                        </div>
                      ) : loadingOwners ? (
                        <div style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Public Sans, system-ui, sans-serif' }}>
                          Loading owners on {permit.abstract}…
                        </div>
                      ) : owners.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#94A3B8', fontFamily: 'Public Sans, system-ui, sans-serif' }}>
                          No owners recorded on {permit.abstract} yet.
                        </div>
                      ) : (
                        <>
                          <div style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: '#6B7280',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            marginBottom: 8,
                            fontFamily: 'Public Sans, system-ui, sans-serif',
                          }}>
                            {owners.length} lead{owners.length === 1 ? '' : 's'} on this tract
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {owners.map((owner, oi) => (
                              <OwnerRowCard
                                key={`${owner.id ?? oi}-${owner.owner_name}`}
                                owner={owner}
                                countyId={permit.county_id}
                                abstract={permit.abstract!}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: PermitStatus }) {
  const style = status === 'approved'
    ? { bg: '#DBEAFE', color: '#1D4ED8', label: 'APPROVED' }
    : status === 'pending'
      ? { bg: '#FED7AA', color: '#9A3412', label: 'PENDING' }
      : { bg: '#F3F4F6', color: '#6B7280', label: 'OTHER' }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        borderRadius: 999,
        background: style.bg,
        color: style.color,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.06em',
        fontFamily: 'Public Sans, system-ui, sans-serif',
        whiteSpace: 'nowrap',
      }}
    >
      {style.label}
    </span>
  )
}

function OwnerRowCard({
  owner, countyId, abstract,
}: {
  owner: OwnerRow
  countyId: CountyKey
  abstract: string
}) {
  const nra = owner.acreage != null && owner.ownership_pct != null
    ? Number(owner.acreage) * Number(owner.ownership_pct) / 100
    : null
  const phone = owner.phone ?? null
  const email = owner.email ?? null
  const mapDeepLink = `/?county=${countyId}&owner=${encodeURIComponent(owner.owner_name ?? '')}&abstract=${encodeURIComponent(abstract)}`

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 10,
        alignItems: 'center',
        padding: '10px 12px',
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 8,
        fontFamily: 'Public Sans, system-ui, sans-serif',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
          {owner.owner_name}
        </div>
        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
          {(owner.mailing_city && owner.mailing_state)
            ? `${owner.mailing_city}, ${owner.mailing_state}${owner.mailing_zip ? ' ' + owner.mailing_zip : ''}`
            : 'Address on file'}
          {nra != null && nra > 0 && (
            <> · <span style={{ fontFamily: 'monospace', color: '#374151' }}>{nra.toFixed(nra < 1 ? 3 : 2)} NRA</span></>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {phone ? (
          <a
            href={`tel:${phone.replace(/[^0-9+]/g, '')}`}
            style={{
              fontSize: 11,
              padding: '5px 10px',
              borderRadius: 6,
              background: '#16A34A',
              color: '#FFFFFF',
              textDecoration: 'none',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
            title={phone}
          >
            📞 {phone}
          </a>
        ) : (
          <span style={{
            fontSize: 11,
            padding: '5px 10px',
            borderRadius: 6,
            background: '#F3F4F6',
            color: '#94A3B8',
            fontStyle: 'italic',
          }}>
            No phone
          </span>
        )}
        {email && (
          <a
            href={`mailto:${email}`}
            style={{
              fontSize: 11,
              padding: '5px 10px',
              borderRadius: 6,
              background: '#EFF6FF',
              color: '#1D4ED8',
              textDecoration: 'none',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
            title={email}
          >
            ✉️
          </a>
        )}
        <Link
          href={mapDeepLink}
          style={{
            fontSize: 11,
            padding: '5px 10px',
            borderRadius: 6,
            background: '#FFFFFF',
            color: '#374151',
            textDecoration: 'none',
            border: '1px solid #E5E7EB',
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          Open ↗
        </Link>
      </div>
    </div>
  )
}
