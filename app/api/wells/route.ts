import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { COUNTIES } from '@/lib/counties'
import type { CountyKey } from '@/lib/counties'

type WellsRequestBody = {
  mode: 'tract' | 'owner'
  countyId: CountyKey
  abstractLabel?: string
  abstract?: string
  operator?: string
  fieldName?: string
  ownerName?: string
  leaseId?: string | number | null
}

type WellRow = {
  lease_name?: string | null
  operator_name?: string | null
  well_type?: string | null
  rrc_lease_id?: string | number | null
  oil_gas_code?: string | null
}

const normalizeLeaseId = (value: unknown): string =>
  String(value ?? '').replace(/^0+/, '').trim()

export async function POST(req: NextRequest) {
  const body = (await req.json()) as WellsRequestBody
  const {
    mode,
    countyId,
    abstractLabel,
    abstract,
    operator,
    fieldName,
    ownerName,
    leaseId,
  } = body

  if (!mode || !countyId || !(countyId in COUNTIES)) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
  }

  const response = NextResponse.next()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll().map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
          }))
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const {
    data: { session },
  } = await supabaseAuth.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const county = COUNTIES[countyId]

  try {
    if (mode === 'tract') {
      const tractAbstractLabel = String(abstractLabel ?? abstract ?? '').trim()
      if (county.id === 'howard') {
        const tractAbstract = tractAbstractLabel.replace(/^A-\s*/i, '').trim()
        if (!tractAbstract) {
          return NextResponse.json({ success: true, wells: [] })
        }

        const { data, error } = await adminClient
          .from(county.wellsTable)
          .select('lease_name, operator_name, well_type, rrc_lease_id, oil_gas_code')
          .eq('abstract', tractAbstract)
          .limit(50)

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }

        const seen = new Set<string>()
        const wells = ((data as WellRow[] | null) ?? [])
          .filter((well) => {
            const lease = String(well.lease_name ?? '').trim()
            if (!lease) return true
            if (seen.has(lease)) return false
            seen.add(lease)
            return true
          })
          .map((well) => ({
            ...well,
            oil_gas_code: String(well.oil_gas_code ?? 'O').toUpperCase(),
          }))

        return NextResponse.json({ success: true, wells })
      }

      let data: WellRow[] = []
      const operatorWord = String(operator ?? '').trim().split(/\s+/)[0]
      const fieldWord = String(fieldName ?? '').trim().split(/\s+/)[0]

      if (operatorWord) {
        const { data: opWells } = await adminClient
          .from(county.wellsTable)
          .select('lease_name, operator_name, well_type, rrc_lease_id')
          .ilike('operator_name', `%${operatorWord}%`)
          .limit(50)
        data = (opWells as WellRow[] | null) ?? []
      }

      if (data.length === 0 && fieldWord) {
        const { data: fieldWells } = await adminClient
          .from(county.wellsTable)
          .select('lease_name, operator_name, well_type, rrc_lease_id')
          .ilike('lease_name', `%${fieldWord}%`)
          .limit(20)
        data = (fieldWells as WellRow[] | null) ?? []
      }

      const seen = new Set<string>()
      const unique = data.filter((well) => {
        const leaseName = String(well.lease_name ?? '').trim()
        if (!leaseName) return true
        if (seen.has(leaseName)) return false
        seen.add(leaseName)
        return true
      })

      const wellLeaseIds = unique
        .map((well) => String(well.rrc_lease_id ?? '').trim())
        .filter(Boolean)

      if (wellLeaseIds.length === 0) {
        return NextResponse.json({ success: true, wells: unique })
      }

      const normalizedLeaseIds = wellLeaseIds
        .map((value) => normalizeLeaseId(value) || '0')
        .filter(Boolean)
      const lookupLeaseIds = Array.from(new Set([...wellLeaseIds, ...normalizedLeaseIds]))

      const { data: codes } = await adminClient
        .from(county.ownershipTable)
        .select('rrc_lease_id, rrc_oil_and_gas_code')
        .in('rrc_lease_id', lookupLeaseIds)
        .limit(50)

      const codeMap = new Map<string, string>(
        (codes ?? []).map((codeRow) => [
          String((codeRow as { rrc_lease_id?: string | number | null }).rrc_lease_id ?? '').trim(),
          String((codeRow as { rrc_oil_and_gas_code?: string | null }).rrc_oil_and_gas_code ?? 'O').toUpperCase(),
        ])
      )

      const wellsWithCode = unique.map((well) => {
        const rowLeaseId = String(well.rrc_lease_id ?? '').trim()
        const normalizedLeaseId = normalizeLeaseId(rowLeaseId) || '0'
        return {
          ...well,
          oil_gas_code: codeMap.get(rowLeaseId) ?? codeMap.get(normalizedLeaseId) ?? 'O',
        }
      })

      return NextResponse.json({ success: true, wells: wellsWithCode })
    }

    const leaseCandidates = new Set<string>(
      [String(leaseId ?? '').trim(), normalizeLeaseId(leaseId)].filter(Boolean)
    )

    if (county.id === 'howard') {
      const tractAbstract = String(abstractLabel ?? '').replace(/^A-\s*/i, '').trim()
      const normalizedOwnerName = String(ownerName ?? '').trim()

      if (tractAbstract && normalizedOwnerName) {
        const { data: ownerLeaseRows } = await adminClient
          .from(county.ownershipTable)
          .select('rrc_lease_id')
          .eq('abstract', tractAbstract)
          .eq('owner_name', normalizedOwnerName)
          .not('rrc_lease_id', 'is', null)
          .limit(20)

        ;(ownerLeaseRows ?? []).forEach((row) => {
          const rowLease = String(
            (row as { rrc_lease_id?: string | number | null }).rrc_lease_id ?? ''
          ).trim()
          if (rowLease) {
            leaseCandidates.add(rowLease)
            leaseCandidates.add(normalizeLeaseId(rowLease))
          }
        })
      }
    }

    const leaseList = Array.from(leaseCandidates).filter(Boolean)
    if (leaseList.length === 0) {
      return NextResponse.json({ success: true, wells: [] })
    }

    const { data, error } = await adminClient
      .from(county.wellsTable)
      .select('lease_name, operator_name, well_type, rrc_lease_id, oil_gas_code')
      .in('rrc_lease_id', leaseList)
      .limit(20)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let wells = Array.from(
      new Map(
        ((data as WellRow[] | null) ?? []).map((well) => [
          `${String(well.rrc_lease_id ?? '').trim()}-${String(well.lease_name ?? '').trim()}`,
          {
            ...well,
            oil_gas_code: String(well.oil_gas_code ?? 'O').toUpperCase(),
          },
        ])
      ).values()
    )

    if (county.id !== 'howard' && wells.length > 0) {
      const { data: codes } = await adminClient
        .from(county.ownershipTable)
        .select('rrc_lease_id, rrc_oil_and_gas_code')
        .in('rrc_lease_id', leaseList)
        .limit(20)

      const codeMap = new Map<string, string>(
        (codes ?? []).map((codeRow) => [
          String((codeRow as { rrc_lease_id?: string | number | null }).rrc_lease_id ?? '').trim(),
          String((codeRow as { rrc_oil_and_gas_code?: string | null }).rrc_oil_and_gas_code ?? 'O').toUpperCase(),
        ])
      )

      wells = wells.map((well) => {
        const rowLeaseId = String(well.rrc_lease_id ?? '').trim()
        const normalizedLeaseId = normalizeLeaseId(rowLeaseId) || '0'
        return {
          ...well,
          oil_gas_code: codeMap.get(rowLeaseId) ?? codeMap.get(normalizedLeaseId) ?? 'O',
        }
      })
    }

    return NextResponse.json({ success: true, wells })
  } catch (error) {
    console.error('Wells API error:', error)
    return NextResponse.json({ error: 'Failed to fetch wells' }, { status: 500 })
  }
}
