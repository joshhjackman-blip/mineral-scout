import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { COUNTIES } from '@/lib/counties'
import { requireApiUser } from '@/lib/api-auth'

// Server-side aggregate of drilling activity across every active
// county. Powers the BasinActivityWidget on the "All Counties"
// sidebar. Three counts + a headline breakdown per county:
//
//   activeRigs  = spud_date within RIG_LOOKBACK_DAYS AND
//                 completion_date is null AND
//                 NOT a disposal/injection well (SWD-style)
//                 — same definition as the red-dot rig overlay on
//                 the map, so the sidebar number and the map dots
//                 always agree.
//
//   newPermits  = approved_date or filed_date within
//                 PERMIT_LOOKBACK_DAYS
//
//   completions = completion_date within COMPLETION_LOOKBACK_DAYS
//                 — leading indicator of near-term production
//                 growth in the basin.
//
// The endpoint uses the service-role key because it aggregates
// permits across county tables that anon reads may not touch on
// some deployments. No PII is returned — just aggregated counts.

export const revalidate = 300
export const dynamic = 'force-dynamic'

const RIG_LOOKBACK_DAYS = 365
const PERMIT_LOOKBACK_DAYS = 30
const COMPLETION_LOOKBACK_DAYS = 30

function daysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  const t = Date.parse(s.slice(0, 10))
  return Number.isFinite(t) ? new Date(t) : null
}

function isDisposalWell(row: Record<string, unknown>): boolean {
  const lease = String(row.lease_name ?? '').toUpperCase()
  const type = String(row.permit_type ?? '').toUpperCase()
  return (
    /(^|\s)SWD(\s|$)/.test(lease) ||
    lease.includes('DISPOSAL') ||
    lease.includes('INJECTION') ||
    lease.includes('WATER GATHERING') ||
    type.includes('DISPOSAL') ||
    type.includes('INJECTION')
  )
}

interface CountyBreakdown {
  countyId: string
  displayName: string
  activeRigs: number
  newPermits: number
  completions: number
}

interface BasinActivityResponse {
  ok: boolean
  updatedAt: string
  totals: {
    activeRigs: number
    newPermits: number
    completions: number
  }
  windows: {
    rigLookbackDays: number
    permitLookbackDays: number
    completionLookbackDays: number
  }
  counties: CountyBreakdown[]
  error?: string
}

export async function GET(request: NextRequest) {
  const gate = await requireApiUser(request)
  if (gate.error) return gate.error

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    return NextResponse.json({
      ok: false,
      updatedAt: new Date().toISOString(),
      totals: { activeRigs: 0, newPermits: 0, completions: 0 },
      windows: {
        rigLookbackDays: RIG_LOOKBACK_DAYS,
        permitLookbackDays: PERMIT_LOOKBACK_DAYS,
        completionLookbackDays: COMPLETION_LOOKBACK_DAYS,
      },
      counties: [],
      error: 'Supabase credentials missing',
    } satisfies BasinActivityResponse, { status: 500 })
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const rigCutoffMs = Date.now() - RIG_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const permitCutoff = daysAgo(PERMIT_LOOKBACK_DAYS)
  const completionCutoff = daysAgo(COMPLETION_LOOKBACK_DAYS)

  const counties: CountyBreakdown[] = []
  const totals = { activeRigs: 0, newPermits: 0, completions: 0 }

  // Fetch each active county's permits table in parallel. Every
  // county table has the same shape post-Ticket 1.3, so a single
  // SELECT works for all.
  const tasks = Object.values(COUNTIES).map(async (county) => {
    const table = `${county.id}_permits`
    // Full column set. Fall back to the pre-Ticket-1.3 minimal set
    // if the county's migration hasn't landed yet.
    // Supabase's default JS client caps at 1000 rows unless the
    // server explicitly raises PGRST_MAX_ROWS. Howard alone runs
    // ~1250 permits, so we page in 1000-row chunks and stop when
    // an underfull page arrives.
    const attempt = async (cols: string) => {
      const out: Array<Record<string, unknown>> = []
      let offset = 0
      while (true) {
        const res = await sb
          .from(table)
          .select(cols)
          .range(offset, offset + 999)
        if (res.error) return { data: null, error: res.error }
        const chunk = (res.data as unknown as Array<Record<string, unknown>>) ?? []
        out.push(...chunk)
        if (chunk.length < 1000) break
        offset += 1000
        if (offset >= 20_000) break
      }
      return { data: out, error: null }
    }

    let rows: Array<Record<string, unknown>> = []
    let result = await attempt('spud_date,completion_date,approved_date,filed_date,permit_type,lease_name')
    if (result.error && /column .* does not exist/i.test(result.error.message ?? '')) {
      result = await attempt('approved_date,filed_date,permit_type,lease_name')
    }
    if (result.error) {
      // Table may not exist for this county yet — soft fail, contributes 0.
      return {
        countyId: county.id,
        displayName: county.displayName,
        activeRigs: 0,
        newPermits: 0,
        completions: 0,
      } satisfies CountyBreakdown
    }
    rows = (result.data as unknown as Array<Record<string, unknown>>) ?? []

    let activeRigs = 0
    let newPermits = 0
    let completions = 0

    for (const row of rows) {
      const spud = parseDate(row.spud_date)
      const completion = parseDate(row.completion_date)
      const approved = parseDate(row.approved_date)
      const filed = parseDate(row.filed_date)
      const disposal = isDisposalWell(row)

      // Active rig: recently spudded, not yet completed, not a
      // disposal well. Matches the map's rig-dot categorize()
      // function.
      if (spud && !completion && spud.getTime() >= rigCutoffMs && !disposal) {
        activeRigs += 1
      }
      // New permit: approved or filed inside the last 30 days.
      const permitDate = approved ?? filed
      if (permitDate && permitDate.toISOString().slice(0, 10) >= permitCutoff) {
        newPermits += 1
      }
      // Completion: well brought online inside the last 30 days.
      if (completion && completion.toISOString().slice(0, 10) >= completionCutoff) {
        completions += 1
      }
    }

    return {
      countyId: county.id,
      displayName: county.displayName,
      activeRigs,
      newPermits,
      completions,
    } satisfies CountyBreakdown
  })

  const settled = await Promise.all(tasks)
  for (const c of settled) {
    counties.push(c)
    totals.activeRigs += c.activeRigs
    totals.newPermits += c.newPermits
    totals.completions += c.completions
  }

  return NextResponse.json({
    ok: true,
    updatedAt: new Date().toISOString(),
    totals,
    windows: {
      rigLookbackDays: RIG_LOOKBACK_DAYS,
      permitLookbackDays: PERMIT_LOOKBACK_DAYS,
      completionLookbackDays: COMPLETION_LOOKBACK_DAYS,
    },
    counties,
  } satisfies BasinActivityResponse, {
    // Basin-level activity moves slowly (permits are daily, rigs
    // shift weekly). 5-minute browser + edge cache is plenty and
    // keeps sidebar loads snappy on repeat visits.
    headers: {
      'Cache-Control': 'public, max-age=180, s-maxage=300, stale-while-revalidate=600',
    },
  })
}
