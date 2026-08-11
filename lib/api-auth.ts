import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { isPlatformAdmin } from '@/lib/team'

/**
 * Cookie-session auth for /api/* routes.
 *
 * Middleware intentionally skips /api (refresh-token races). Each route
 * that serves product data or triggers paid work must call requireApiUser
 * (or requireApiPlatformAdmin) itself. Same-origin browser fetches and
 * <img src="/api/..."> still send cookies, so logged-in users are unaffected.
 */

function createCookieClient(req: NextRequest) {
  return createServerClient(
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
          cookiesToSet.forEach(({ name, value }) => {
            req.cookies.set(name, value)
          })
        },
      },
    },
  )
}

export async function requireApiUser(
  req: NextRequest,
): Promise<{ user: User; error: null } | { user: null; error: NextResponse }> {
  const supabase = createCookieClient(req)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return { user, error: null }
}

export async function requireApiPlatformAdmin(
  req: NextRequest,
): Promise<{ user: User; error: null } | { user: null; error: NextResponse }> {
  const gate = await requireApiUser(req)
  if (gate.error) return gate
  if (
    !isPlatformAdmin(
      gate.user.user_metadata as Record<string, unknown>,
      gate.user.email,
    )
  ) {
    return {
      user: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return gate
}

/** Fail closed: missing or wrong CRON_SECRET → 401. */
export function requireCronSecret(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 401 },
    )
  }
  const auth = request.headers.get('authorization') || ''
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  return null
}
