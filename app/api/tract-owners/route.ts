import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { COUNTIES, type CountyKey } from '@/lib/counties'
import {
  abstractVariants,
  bareAbstract,
  loadOwnersFromEnrichedGeoJson,
  sortOwnersByAcreage,
  type TractOwnerRow,
} from '@/lib/tract-owners'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// First cold load may pull the enriched parcels GeoJSON into memory.
export const maxDuration = 60

const HOWARD_COLS =
  'id, owner_name, mailing_city, mailing_state, mailing_zip, acreage, ownership_pct'
const MIN_COLS = 'id, owner_name, mailing_city, mailing_state'

function isMissingColumnError(msg: string): boolean {
  const m = msg.toLowerCase()
  return m.includes('column') && (m.includes('does not exist') || m.includes('not find'))
}

async function loadOwnersFromDb(
  countyId: CountyKey,
  abstract: string,
): Promise<{ owners: TractOwnerRow[]; error: string | null }> {
  const cfg = COUNTIES[countyId]
  if (!cfg) return { owners: [], error: 'Unknown county' }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return { owners: [], error: 'Supabase admin credentials missing' }
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const variants = abstractVariants(abstract)

  const run = (cols: string) =>
    admin
      .from(cfg.ownershipTable)
      .select(cols)
      .in('abstract', variants)
      .limit(500)

  let result = await run(HOWARD_COLS)
  if (result.error && isMissingColumnError(result.error.message)) {
    result = await run(MIN_COLS)
  }

  if (result.error) {
    return { owners: [], error: result.error.message }
  }

  return {
    owners: sortOwnersByAcreage((result.data ?? []) as unknown as TractOwnerRow[]),
    error: null,
  }
}

/**
 * GET /api/tract-owners?county=martin&abstract=616
 *
 * Auth required. Prefer service-role DB, fall back to enriched CAD GeoJSON
 * so the /permits expand panel never depends on a 60 MB browser download.
 */
export async function GET(req: NextRequest) {
  const cookieStore = cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {},
      },
    },
  )

  const {
    data: { session },
  } = await supabaseAuth.auth.getSession()
  if (!session?.user) {
    return NextResponse.json(
      { success: false, data: null, error: 'Unauthorized' },
      { status: 401 },
    )
  }

  const { hasSignedCurrentAgreement, isAgreementGateEnabled } = await import(
    '@/lib/agreement'
  )
  if (
    isAgreementGateEnabled() &&
    !hasSignedCurrentAgreement(
      session.user.user_metadata as Record<string, unknown> | undefined,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'agreement_required',
        redirect: '/legal/agreement/sign',
      },
      { status: 403 },
    )
  }

  const county = String(req.nextUrl.searchParams.get('county') ?? '')
    .trim()
    .toLowerCase() as CountyKey
  const abstract = String(req.nextUrl.searchParams.get('abstract') ?? '').trim()

  if (!county || !COUNTIES[county]) {
    return NextResponse.json(
      { success: false, data: null, error: 'Invalid county' },
      { status: 400 },
    )
  }
  if (!abstract) {
    return NextResponse.json(
      { success: false, data: null, error: 'abstract is required' },
      { status: 400 },
    )
  }

  const bare = bareAbstract(abstract)
  let source: 'db' | 'geojson' | 'empty' = 'empty'
  let owners: TractOwnerRow[] = []
  let dbError: string | null = null

  try {
    const db = await loadOwnersFromDb(county, abstract)
    dbError = db.error
    if (db.owners.length > 0) {
      owners = db.owners
      source = 'db'
    }
  } catch (err) {
    dbError = err instanceof Error ? err.message : 'DB lookup failed'
  }

  if (owners.length === 0) {
    try {
      const fromGeo = await loadOwnersFromEnrichedGeoJson(county, abstract)
      if (fromGeo.length > 0) {
        owners = fromGeo
        source = 'geojson'
      }
    } catch (err) {
      const geoErr = err instanceof Error ? err.message : 'GeoJSON fallback failed'
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: dbError ? `${dbError}; ${geoErr}` : geoErr,
        },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      county,
      abstract: bare,
      source,
      owners,
      count: owners.length,
      db_error: dbError,
    },
    error: null,
  })
}
