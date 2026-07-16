import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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
  // `abstract` is added to the select so we can join to
  // tract_development_status client-side. Nullable for owners whose
  // rows don't carry an abstract (rare, but Gonzales has a handful).
  abstract: string | null
}

type DevStatusRow = {
  abstract_number: string
  development_status: string
  pud_score: number
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
  const countyId = (searchParams.get('countyId') ?? 'gonzales').toLowerCase()
  const ownershipTable = `${countyId}_mineral_ownership`

  let query = supabase
    .from(ownershipTable)
    .select(
      'owner_name, mailing_address, mailing_city, mailing_state, mailing_zip, operator_name, propensity_score, motivated, out_of_state, acreage, prod_cumulative_sum_oil, rrc_lease_id, county_lease_name, abstract'
    )
    .gte('propensity_score', Number.isFinite(minScore) ? minScore : 0)
    .order('propensity_score', { ascending: false })
    .limit(5000)

  if (motivatedOnly) query = query.eq('motivated', true)
  if (outOfStateOnly) query = query.eq('out_of_state', true)

  const { data, error } = await query

  // Ticket 1.3 §5: CSV export must carry development_status +
  // pud_score. Fetched here rather than joined via Supabase because
  // tract_development_status keys on the bare abstract and mineral
  // ownership rows store it with variable normalization; doing the
  // key normalization client-side is more forgiving.
  let devStatusByAbstract: Record<string, DevStatusRow> = {}
  const devResult = await supabase
    .from('tract_development_status')
    .select('abstract_number, development_status, pud_score')
    .eq('county_id', countyId)
    .limit(5000)
  if (!devResult.error && devResult.data) {
    devStatusByAbstract = Object.fromEntries(
      (devResult.data as DevStatusRow[]).map((r) => [r.abstract_number, r]),
    )
  }

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

  const normalizeAbstract = (raw: string | null | undefined) => {
    const text = String(raw ?? '').trim().toUpperCase()
    return text.startsWith('A-') ? text.slice(2).trim() : text
  }

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
    'Abstract',
    'Development Status',   // Ticket 1.3 §5
    'PUD Score',            // Ticket 1.3 §5
  ]

  const rows =
    filtered?.map((o) => {
      const abstract = normalizeAbstract(o.abstract)
      const dev = abstract ? devStatusByAbstract[abstract] : undefined
      return [
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
        `"${abstract ? `A-${abstract}` : ''}"`,
        `"${dev?.development_status ?? 'FRONTIER'}"`,
        dev?.pud_score ?? 0,
      ].join(',')
    }) ?? []

  const csv = [headers.join(','), ...rows].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="mineral-map-${countyId}-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  })
}
