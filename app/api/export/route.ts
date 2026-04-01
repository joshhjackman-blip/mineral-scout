import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type OwnerRow = {
  owner_name: string | null
  mailing_address: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  operator_name: string | null
  propensity_score: number | null
  motivated: boolean | null
  out_of_state: boolean | null
  acreage: number | null
  prod_cumulative_sum_oil: number | null
  rrc_lease_id: string | null
  county_lease_name: string | null
}

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { searchParams } = new URL(req.url)
  const minScore = parseInt(searchParams.get('minScore') ?? '0', 10)
  const motivatedOnly = searchParams.get('motivatedOnly') === 'true'
  const outOfStateOnly = searchParams.get('outOfStateOnly') === 'true'
  const ownerType = searchParams.get('ownerType') ?? 'all'

  let query = supabase
    .from('gonzales_mineral_ownership')
    .select(
      'owner_name, mailing_address, mailing_city, mailing_state, mailing_zip, operator_name, propensity_score, motivated, out_of_state, acreage, prod_cumulative_sum_oil, rrc_lease_id, county_lease_name'
    )
    .gte('propensity_score', Number.isFinite(minScore) ? minScore : 0)
    .order('propensity_score', { ascending: false })
    .limit(5000)

  if (motivatedOnly) query = query.eq('motivated', true)
  if (outOfStateOnly) query = query.eq('out_of_state', true)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const classifyOwner = (name: string) => {
    const n = (name ?? '').toUpperCase()
    if (
      n.includes('TRUST') ||
      n.includes('ESTATE') ||
      n.includes('LIVING') ||
      n.includes('IRREVOCABLE')
    )
      return 'trust'
    if (
      n.includes('LLC') ||
      n.includes('LP') ||
      n.includes('INC') ||
      n.includes('CORP') ||
      n.includes('MINERALS') ||
      n.includes('ENERGY') ||
      n.includes('RESOURCES')
    )
      return 'company'
    return 'individual'
  }

  const typedData = (data ?? []) as OwnerRow[]
  const filtered =
    ownerType === 'all'
      ? typedData
      : typedData.filter((o) =>
          classifyOwner(o.owner_name ?? '') === ownerType
        )

  const headers = [
    'Owner Name',
    'Mailing Address',
    'City',
    'State',
    'Zip',
    'Operator',
    'Propensity Score',
    'Motivated',
    'Out of State',
    'Acreage',
    'Cumulative Oil (BBL)',
    'Lease ID',
    'Lease Name',
  ]

  const rows =
    filtered?.map((o) =>
      [
        `"${(o.owner_name ?? '').replace(/"/g, '""')}"`,
        `"${(o.mailing_address ?? '').replace(/"/g, '""')}"`,
        `"${(o.mailing_city ?? '').replace(/"/g, '""')}"`,
        `"${(o.mailing_state ?? '').replace(/"/g, '""')}"`,
        `"${(o.mailing_zip ?? '').replace(/"/g, '""')}"`,
        `"${(o.operator_name ?? '').replace(/"/g, '""')}"`,
        o.propensity_score ?? 0,
        o.motivated ? 'Yes' : 'No',
        o.out_of_state ? 'Yes' : 'No',
        o.acreage ?? '',
        o.prod_cumulative_sum_oil ?? '',
        `"${(o.rrc_lease_id ?? '').toString().replace(/"/g, '""')}"`,
        `"${(o.county_lease_name ?? '').replace(/"/g, '""')}"`,
      ].join(',')
    ) ?? []

  const csv = [headers.join(','), ...rows].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="mineral-map-gonzales-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  })
}
