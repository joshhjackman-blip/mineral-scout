import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { isPlatformOwner } from '@/lib/team'
import {
  parseQuotaProvider,
  processQuotaBurnTick,
  quotaStatus,
  setQuotaJobStatus,
  startQuotaJob,
} from '@/lib/skip-trace-quota'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

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

  try {
    const providers = await quotaStatus(adminDb())
    return NextResponse.json({ success: true, data: { providers } })
  } catch (err) {
    return NextResponse.json(
      { success: false, data: null, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireOwner(req)
  if (error) return error
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    action?: string
    provider?: string
    targetCount?: number
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = String(body.action ?? '').trim().toLowerCase()
  const db = adminDb()

  try {
    if (action === 'tick') {
      const result = await processQuotaBurnTick(db)
      const providers = await quotaStatus(db)
      return NextResponse.json({ success: true, data: { result, providers } })
    }

    const provider = parseQuotaProvider(body.provider)
    if (!provider) {
      return NextResponse.json({ error: 'provider must be idicore or accurateappend' }, { status: 400 })
    }

    if (action === 'start') {
      const job = await startQuotaJob(db, {
        provider,
        targetCount: Number(body.targetCount),
        createdBy: user.id,
      })
      const providers = await quotaStatus(db)
      return NextResponse.json({ success: true, data: { job, providers } })
    }

    const status = await quotaStatus(db)
    const current = status.find((row) => row.provider === provider)?.job
    if (!current?.id) {
      return NextResponse.json({ error: 'No active burn job for this provider' }, { status: 404 })
    }

    if (action === 'pause') {
      if (current.status !== 'running' && current.status !== 'queued') {
        return NextResponse.json({ error: 'Job is not running' }, { status: 400 })
      }
      const job = await setQuotaJobStatus(db, current.id, 'paused')
      const providers = await quotaStatus(db)
      return NextResponse.json({ success: true, data: { job, providers } })
    }

    if (action === 'resume') {
      if (current.status !== 'paused') {
        return NextResponse.json({ error: 'Job is not paused' }, { status: 400 })
      }
      const job = await setQuotaJobStatus(db, current.id, 'running')
      const providers = await quotaStatus(db)
      return NextResponse.json({ success: true, data: { job, providers } })
    }

    return NextResponse.json(
      { error: 'action must be start, pause, resume, or tick' },
      { status: 400 },
    )
  } catch (err) {
    return NextResponse.json(
      { success: false, data: null, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
}
