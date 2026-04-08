import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
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

  const isPublicPage =
    req.nextUrl.pathname.startsWith('/auth') ||
    req.nextUrl.pathname.startsWith('/landing') ||
    req.nextUrl.pathname.startsWith('/pricing')
  const isApiRoute = req.nextUrl.pathname.startsWith('/api')

  if (!session && !isPublicPage && !isApiRoute) {
    return NextResponse.redirect(new URL('/landing', req.url))
  }

  if (session && req.nextUrl.pathname.startsWith('/auth')) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  if (session && !isPublicPage && !isApiRoute) {
    const metaStatus = String(
      (session.user.user_metadata as Record<string, unknown> | undefined)?.subscription_status ?? ''
    ).toLowerCase()

    // Fast path: trust fresh metadata when already active/trialing.
    if (metaStatus === 'active' || metaStatus === 'trialing') {
      return res
    }

    // Fallback path: metadata may be stale, so check subscriptions table directly.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status')
      .eq('user_id', session.user.id)
      .maybeSingle()

    const subStatus = String(sub?.status ?? '').toLowerCase()
    if (subStatus === 'active' || subStatus === 'trialing') {
      return res
    }

    return NextResponse.redirect(new URL('/pricing', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
