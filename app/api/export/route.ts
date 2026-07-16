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
  abstract: string | null
}

type DevStatusRow = {
  abstract_number: string
  development_status: string | null
  pud_score: number | null
}

// Every county the CSV export can pull from. Kept in sync with
// lib/counties.ts. Passing ?countyId=all fans out to every entry.
const KNOWN_COUNTIES = [
  'gonzales',
  'howard',
  'martin',
  'crane',
  'glasscock',
  'loving',
  'midland',
  'pecos',
  'reagan',
  'reeves',
  'upton',
  'ward',
  'winkler',
]

const bareAbstract = (raw: unknown): string =>
  String(raw ?? '')
    .replace(/^A-\s*/i, '')
    .replace(/^\d{5}-/, '')
    .trim()
    .toUpperCase()

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { searchParams } = new URL(req.url)
  const minScore = parseInt(searchParams.get('minScore') ?? '0', 10)
  const motivatedOnly = searchParams.get('motivatedOnly') === 'true'
  const outOfStateOnly = searchParams.get('outOfStateOnly') === 'true'
  const ownerType = searchParams.get('ownerType') ?? 'all'

  // Comma-separated list of county ids, or the literal 'all' to
  // fan out to every county in KNOWN_COUNTIES. Empty defaults to
  // 'gonzales' for backwards compat with older bookmark links.
  const countyIdRaw = (searchParams.get('countyId') ?? 'gonzales').toLowerCase()
  const requestedCounties =
    countyIdRaw === 'all'
      ? KNOWN_COUNTIES
      : countyIdRaw
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)

  const fetchOne = async (countyId: string) => {
    const ownershipTable = `${countyId}_mineral_ownership`
    let query = supabase
      .from(ownershipTable)
      .select(
        'owner_name, mailing_address, mailing_city, mailing_state, mailing_zip, operator_name, propensity_score, motivated, out_of_state, acreage, prod_cumulative_sum_oil, rrc_lease_id, county_lease_name, abstract',
      )
      .gte('propensity_score', Number.isFinite(minScore) ? minScore : 0)
      .order('propensity_score', { ascending: false })
      .limit(5000)
    if (motivatedOnly) query = query.eq('motivated', true)
    if (outOfStateOnly) query = query.eq('out_of_state', true)
    const ownershipResult = await query

    // Ticket 1.3 §5: CSV export must carry development_status +
    // pud_score. Fetched here rather than joined via Supabase because
    // tract_development_status keys on the bare abstract and the
    // mineral ownership rows store it with variable normalization
    // (FIPS prefix, A- prefix, mixed case). Doing the key
    // normalization in Node is more forgiving.
    const devResult = await supabase
      .from('tract_development_status')
      .select('abstract_number, development_status, pud_score')
      .eq('county_id', countyId)
      .limit(5000)

    const devLookup: Record<string, DevStatusRow> = {}
    if (!devResult.error && devResult.data) {
      for (const r of devResult.data as DevStatusRow[]) {
        devLookup[bareAbstract(r.abstract_number)] = r
      }
    }

    return {
      countyId,
      rows: (ownershipResult.data ?? []) as OwnerRow[],
      devLookup,
      error: ownershipResult.error?.message ?? null,
    }
  }

  const perCounty = await Promise.all(requestedCounties.map(fetchOne))

  // Concatenate all rows with an added county_id column so the CSV
  // reader can tell which county each row came from. Filter out
  // "table does not exist" errors silently so an early-stage county
  // doesn't blow up the whole export.
  const combined: Array<OwnerRow & {
    _county_id: string
    _development_status: string
    _pud_score: number | string
  }> = []
  const hardErrors: Array<{ countyId: string; error: string }> = []
  for (const p of perCounty) {
    if (p.error) {
      const m = p.error.toLowerCase()
      if (
        !m.includes('not find') &&
        !m.includes('does not exist') &&
        !m.includes('relation') // "relation does not exist"
      ) {
        hardErrors.push({ countyId: p.countyId, error: p.error })
      }
      continue
    }
    for (const row of p.rows) {
      const dev = p.devLookup[bareAbstract(row.abstract)]
      combined.push({
        ...row,
        _county_id: p.countyId,
        _development_status: dev?.development_status ?? '',
        _pud_score: dev?.pud_score ?? '',
      })
    }
  }

  if (hardErrors.length > 0 && combined.length === 0) {
    return NextResponse.json(
      { error: hardErrors.map((e) => `${e.countyId}: ${e.error}`).join('; ') },
      { status: 500 },
    )
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

  const filtered =
    ownerType === 'all'
      ? combined
      : combined.filter(
          (o) => classifyOwner(o.owner_name ?? '') === ownerType,
        )

  const headers = [
    'County',
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
    'Development Status',
    'PUD Score',
  ]

  const csvEscape = (v: unknown): string => {
    const s = String(v ?? '').replace(/"/g, '""')
    return `"${s}"`
  }

  const rows = filtered.map((o) =>
    [
      csvEscape(o._county_id),
      csvEscape(o.owner_name),
      csvEscape(o.mailing_address),
      csvEscape(o.mailing_city),
      csvEscape(o.mailing_state),
      csvEscape(o.mailing_zip),
      csvEscape(o.operator_name),
      o.propensity_score ?? 0,
      o.motivated ? 'Yes' : 'No',
      o.out_of_state ? 'Yes' : 'No',
      o.acreage ?? '',
      o.prod_cumulative_sum_oil ?? '',
      csvEscape(o.rrc_lease_id),
      csvEscape(o.county_lease_name),
      csvEscape(o.abstract),
      csvEscape(o._development_status),
      o._pud_score === '' ? '' : o._pud_score,
    ].join(','),
  )

  const csv = [headers.join(','), ...rows].join('\n')

  const dateStamp = new Date().toISOString().split('T')[0]
  const filenameCounty =
    countyIdRaw === 'all'
      ? 'all-counties'
      : requestedCounties.length > 1
        ? `${requestedCounties.length}-counties`
        : requestedCounties[0] || 'gonzales'

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="mineral-map-${filenameCounty}-${dateStamp}.csv"`,
    },
  })
}
