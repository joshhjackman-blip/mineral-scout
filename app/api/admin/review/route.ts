import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { isPlatformAdmin } from '@/lib/team'

export const dynamic = 'force-dynamic'

type DeedRow = {
  id?: string
  county?: string | null
  section?: number | null
  township?: string | null
  range?: string | null
  grantor?: string | null
  grantee?: string | null
  interest?: number | null
  legal_desc?: string | null
  recorded_date?: string | null
  instrument_type?: string | null
  confidence?: number | null
  raw_text?: string | null
  needs_review?: boolean | null
}

const normalizeString = (value: unknown) => String(value ?? '').trim()

async function requireAdmin(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createServerClient(
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
            res.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (
    !session?.user ||
    !isPlatformAdmin(
      session.user.user_metadata as Record<string, unknown>,
      session.user.email,
    )
  ) {
    return { session: null as null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  return { session, error: null as NextResponse | null }
}

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const db = adminDb()
  const { data, error: rowError } = await db
    .from('oklahoma_mineral_deeds')
    .select(
      'id, county, section, township, range, grantor, grantee, interest, legal_desc, recorded_date, instrument_type, confidence, raw_text, needs_review'
    )
    .eq('needs_review', true)
    .order('recorded_date', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (rowError) {
    return NextResponse.json({ error: rowError.message }, { status: 500 })
  }

  const { count } = await db
    .from('oklahoma_mineral_deeds')
    .select('id', { count: 'exact', head: true })
    .eq('needs_review', true)

  return NextResponse.json({
    record: (data as DeedRow | null) ?? null,
    remaining: Number(count ?? 0),
  })
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'accept' | 'edit_accept' | 'reject'
    id?: string
    updates?: Partial<DeedRow>
    lookup?: {
      county?: string
      section?: number
      township?: string
      range?: string
      grantor?: string
      grantee?: string
      recorded_date?: string
    }
  }

  const action = body.action
  if (!action || !['accept', 'edit_accept', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const db = adminDb()
  const baseUpdate: Record<string, unknown> = {
    needs_review: false,
  }

  if (action === 'reject') {
    baseUpdate.confidence = 0
  }

  if (action === 'edit_accept') {
    const updates = body.updates ?? {}
    baseUpdate.grantor = normalizeString(updates.grantor)
    baseUpdate.grantee = normalizeString(updates.grantee)
    baseUpdate.legal_desc = normalizeString(updates.legal_desc)
    baseUpdate.instrument_type = normalizeString(updates.instrument_type)
    baseUpdate.recorded_date = normalizeString(updates.recorded_date)
    baseUpdate.raw_text = normalizeString(updates.raw_text)
    const interestNum = Number(updates.interest ?? 0)
    baseUpdate.interest = Number.isFinite(interestNum) ? interestNum : 0
    baseUpdate.confidence = 1
  }

  let query = db.from('oklahoma_mineral_deeds').update(baseUpdate)
  if (body.id) {
    query = query.eq('id', body.id)
  } else if (body.lookup) {
    query = query
      .eq('county', normalizeString(body.lookup.county))
      .eq('section', Number(body.lookup.section ?? 0))
      .eq('township', normalizeString(body.lookup.township))
      .eq('range', normalizeString(body.lookup.range))
      .eq('grantor', normalizeString(body.lookup.grantor))
      .eq('grantee', normalizeString(body.lookup.grantee))
      .eq('recorded_date', normalizeString(body.lookup.recorded_date))
  } else {
    return NextResponse.json({ error: 'Missing record identifier' }, { status: 400 })
  }

  const { error: updateError } = await query
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
