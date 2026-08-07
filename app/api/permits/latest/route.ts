import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { COUNTIES, type CountyKey } from '@/lib/counties'

/**
 * GET /api/permits/latest
 *
 * Returns the newest filed/approved permit date across active counties.
 * Powers the little square badge on the map-page Permits button.
 * Cheap: two limit-1 ordered queries per county, no row payloads.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 120

const ACTIVE_COUNTIES = Object.keys(COUNTIES) as CountyKey[]

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

type AdminClient = {
  from: (table: string) => {
    select: (cols: string) => {
      not: (col: string, op: string, value: null) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => {
            maybeSingle: () => Promise<{
              data: Record<string, unknown> | null
              error: { message: string } | null
            }>
          }
        }
      }
    }
  }
}

async function latestForCounty(
  admin: AdminClient,
  countyId: CountyKey,
): Promise<string | null> {
  const table = `${countyId}_permits`

  const [approved, filed] = await Promise.all([
    admin
      .from(table)
      .select('approved_date')
      .not('approved_date', 'is', null)
      .order('approved_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from(table)
      .select('filed_date')
      .not('filed_date', 'is', null)
      .order('filed_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Missing table / column → treat as no data for that county.
  if (approved.error && filed.error) return null

  const a = approved.data?.approved_date
    ? String(approved.data.approved_date).slice(0, 10)
    : null
  const f = filed.data?.filed_date
    ? String(filed.data.filed_date).slice(0, 10)
    : null
  return maxIso(a, f)
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    return NextResponse.json(
      { success: false, data: null, error: 'Supabase credentials missing' },
      { status: 500 },
    )
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as AdminClient

  const perCounty = await Promise.all(
    ACTIVE_COUNTIES.map(async (countyId) => ({
      countyId,
      latest: await latestForCounty(admin, countyId),
    })),
  )

  let latest: string | null = null
  for (const row of perCounty) {
    latest = maxIso(latest, row.latest)
  }

  return NextResponse.json({
    success: true,
    data: {
      latest_date: latest,
      counties: perCounty,
    },
    error: null,
  })
}
