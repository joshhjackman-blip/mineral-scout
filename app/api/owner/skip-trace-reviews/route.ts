import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { isPlatformOwner } from '@/lib/team'
import { skipTraceOwnerKey } from '@/lib/workspace'
import { parseContactLines, type SkipTraceReview } from '@/lib/skip-trace-review'

export const dynamic = 'force-dynamic'

async function requireOwner(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value)
            res.cookies.set(name, value, options)
          })
        },
      },
    },
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isPlatformOwner(user.email)) {
    return {
      user: null as null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return { user, error: null as NextResponse | null }
}

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function GET(req: NextRequest) {
  const { error } = await requireOwner(req)
  if (error) return error

  const status = req.nextUrl.searchParams.get('status') ?? 'open'
  const db = adminDb()
  let query = db
    .from('skip_trace_reviews')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status !== 'all') {
    query = query.eq('status', status)
  }
  const { data, error: rowError } = await query
  if (rowError) {
    return NextResponse.json({ error: rowError.message }, { status: 500 })
  }
  const reviews = (data ?? []) as SkipTraceReview[]
  return NextResponse.json({
    success: true,
    reviews,
    openCount: reviews.filter((r) => r.status === 'open').length,
  })
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireOwner(req)
  if (error || !user) return error

  const body = (await req.json()) as {
    id?: string
    action?: 'resolve' | 'dismiss'
    phones?: string
    emails?: string
    notes?: string
  }
  const id = String(body.id ?? '').trim()
  const action = body.action
  if (!id || (action !== 'resolve' && action !== 'dismiss')) {
    return NextResponse.json({ error: 'id and action are required' }, { status: 400 })
  }

  const db = adminDb()
  const { data: existing, error: lookupError } = await db
    .from('skip_trace_reviews')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (lookupError || !existing) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }

  const now = new Date().toISOString()

  if (action === 'dismiss') {
    const { error: updateError } = await db
      .from('skip_trace_reviews')
      .update({
        status: 'dismissed',
        notes: body.notes ?? existing.notes,
        resolved_at: now,
        resolved_by: user.id,
        updated_at: now,
      })
      .eq('id', id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  const phones = parseContactLines(String(body.phones ?? ''))
  const emails = parseContactLines(String(body.emails ?? existing.emails?.join('\n') ?? ''))
  if (phones.length === 0) {
    return NextResponse.json({ error: 'Enter at least one phone number' }, { status: 400 })
  }

  const cacheKey = skipTraceOwnerKey(existing.owner_name)
  await db.from('skip_trace_cache').delete().eq('owner_name', cacheKey)
  const { error: cacheError } = await db.from('skip_trace_cache').insert({
    owner_name: cacheKey,
    mailing_address: existing.mailing_address ?? '',
    phones,
    emails,
    source: 'owner_manual',
    updated_at: now,
  })
  if (cacheError) {
    console.error('Manual skip-trace cache write failed:', cacheError)
  }

  const dealPatch = {
    phone: phones[0],
    phones,
    email: emails[0] ?? null,
    emails,
    tag: 'skip_traced',
    updated_at: now,
  }
  if (existing.deal_id) {
    await db.from('deals').update(dealPatch).eq('id', existing.deal_id)
  }
  await db.from('deals').update(dealPatch).eq('owner_name', existing.owner_name)

  const { error: updateError } = await db
    .from('skip_trace_reviews')
    .update({
      phones,
      emails,
      notes: body.notes ?? existing.notes,
      status: 'resolved',
      resolved_at: now,
      resolved_by: user.id,
      updated_at: now,
    })
    .eq('id', id)
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, phones, emails })
}
