import { NextRequest, NextResponse } from 'next/server'
import { requireApiPlatformAdmin } from '@/lib/api-auth'
import { inspectIdicoreEnv } from '@/lib/idicore-wiring'
import { probeIdicoreAuth } from '@/lib/skip-trace-providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Auth-only idiCORE wiring check. Does not POST /search, so it does not
 * consume a skip-trace credit. Platform admins only.
 */
export async function GET(req: NextRequest) {
  const gate = await requireApiPlatformAdmin(req, { requireAgreement: false })
  if (gate.error) return gate.error

  try {
    const wiring = inspectIdicoreEnv(process.env)
    const auth = await probeIdicoreAuth()
    return NextResponse.json({
      success: true,
      data: {
        ...wiring,
        auth,
        billedSearch: false,
      },
      error: null,
    })
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
