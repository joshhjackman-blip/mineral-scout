import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireApiUser } from '@/lib/api-auth'
import { phoneKey } from '@/lib/phone-activity'
import {
  queueSkipTraceReview,
  stripPhoneFromSkipTraceCache,
} from '@/lib/skip-trace-review'
import { getTeamOwnerId } from '@/lib/team'

export const dynamic = 'force-dynamic'

/**
 * Broker marked a skip-trace number as wrong. Queue it for /owner so we
 * can replace it, and pull it out of the shared cache.
 */
export async function POST(req: NextRequest) {
  const gate = await requireApiUser(req)
  if (gate.error) return gate.error

  const body = (await req.json().catch(() => ({}))) as {
    dealId?: string
    ownerName?: string
    phone?: string
    firstName?: string | null
    lastName?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    zip?: string | null
    county?: string | null
    tractAbstract?: string | null
  }

  const ownerName = String(body.ownerName ?? '').trim()
  const phone = String(body.phone ?? '').trim()
  if (!ownerName || !phoneKey(phone)) {
    return NextResponse.json(
      { success: false, data: null, error: 'ownerName and phone are required' },
      { status: 400 },
    )
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: sub } = await admin
    .from('subscriptions')
    .select('team_owner_id')
    .eq('user_id', gate.user.id)
    .maybeSingle()
  const teamOwnerId =
    getTeamOwnerId(
      gate.user.user_metadata as Record<string, unknown>,
      (sub as { team_owner_id?: string | null } | null)?.team_owner_id,
    ) || gate.user.id

  await stripPhoneFromSkipTraceCache(admin, ownerName, phone)
  const queued = await queueSkipTraceReview(admin, {
    ownerName,
    firstName: body.firstName,
    lastName: body.lastName,
    address: body.address,
    city: body.city,
    state: body.state,
    zip: body.zip,
    county: body.county,
    tractAbstract: body.tractAbstract,
    dealId: body.dealId,
    teamOwnerId,
    requestedBy: gate.user.id,
    requestedByEmail: gate.user.email,
    phones: [phone],
    reason: 'wrong_number',
    notes: `Wrong number: ${phone}`,
  })

  return NextResponse.json({
    success: queued,
    data: { queued },
    error: queued ? null : 'Could not queue wrong number',
  })
}
