import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { isPlatformOwner } from '@/lib/team'
import {
  acceptSignupRequest,
  declineSignupRequest,
  loadSignupRequestById,
} from '@/lib/signup-request-actions'

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
  const status = req.nextUrl.searchParams.get('status')?.trim() || 'pending'
  const admin = adminDb()
  let query = admin
    .from('signup_requests')
    .select(
      'id, full_name, email, company, status, wants_admin, seat_count, created_at, reviewed_at, onboarded_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)
  if (status !== 'all') query = query.eq('status', status)
  const { data, error: listError } = await query
  if (listError) {
    return NextResponse.json({
      success: true,
      data: { requests: [] },
      error: listError.message,
    })
  }
  return NextResponse.json({
    success: true,
    data: { requests: data ?? [] },
    error: null,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireOwner(req)
  if (gate.error) return gate.error
  if (!gate.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const reviewerId = gate.user.id

  const body = (await req.json().catch(() => ({}))) as {
    id?: string
    action?: string
    reason?: string
  }
  const id = String(body.id ?? '').trim()
  const action = body.action === 'decline' ? 'decline' : body.action === 'accept' ? 'accept' : null
  if (!id || !action) {
    return NextResponse.json(
      { success: false, data: null, error: 'id and action (accept|decline) are required' },
      { status: 400 },
    )
  }

  const admin = adminDb()
  const request = await loadSignupRequestById(admin, id)
  if (!request) {
    return NextResponse.json(
      { success: false, data: null, error: 'Request not found' },
      { status: 404 },
    )
  }
  if (request.status !== 'pending' && action === 'decline') {
    return NextResponse.json(
      { success: false, data: null, error: `Request is already ${request.status}` },
      { status: 400 },
    )
  }

  try {
    if (action === 'accept') {
      const result = await acceptSignupRequest(admin, {
        request,
        reviewerId,
      })
      return NextResponse.json({
        success: true,
        data: {
          status: result.request.status,
          emailed: result.emailed,
          email_error: result.emailError ?? null,
          action_url: result.actionUrl ?? null,
        },
        error: null,
      })
    }
    const declined = await declineSignupRequest(admin, {
      request,
      reviewerId,
      reason: body.reason,
    })
    return NextResponse.json({
      success: true,
      data: { status: declined.request.status, emailed: declined.emailed },
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, data: null, error: message }, { status: 500 })
  }
}
