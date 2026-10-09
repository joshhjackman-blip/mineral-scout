import { NextRequest, NextResponse } from 'next/server'
import { requireApiPlatformAdmin } from '@/lib/api-auth'
import { probeAccurateAppendLicense } from '@/lib/skip-trace-providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * License-only Accurate Append check. Nameless Ads call — 400 means the
 * official key is live; does not append a person.
 */
export async function GET(req: NextRequest) {
  const gate = await requireApiPlatformAdmin(req, { requireAgreement: false })
  if (gate.error) return gate.error

  try {
    const probe = await probeAccurateAppendLicense()
    return NextResponse.json({
      success: true,
      data: probe,
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
