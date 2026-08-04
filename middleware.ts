import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isPlatformAdmin } from '@/lib/team'

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
    req.nextUrl.pathname.startsWith('/pricing') ||
    req.nextUrl.pathname.startsWith('/demo') ||
    req.nextUrl.pathname.startsWith('/book-demo')
  const isApiRoute = req.nextUrl.pathname.startsWith('/api')

  if (!session && !isPublicPage && !isApiRoute) {
    return NextResponse.redirect(new URL('/landing', req.url))
  }

  if (session && req.nextUrl.pathname.startsWith('/auth')) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  const isAdminPath =
    req.nextUrl.pathname.startsWith('/admin') ||
    req.nextUrl.pathname.startsWith('/api/admin')
  const isAdmin = isPlatformAdmin(
    session?.user?.user_metadata as Record<string, unknown> | undefined,
    session?.user?.email,
  )

  if (isAdminPath) {
    if (!session || !isAdmin) {
      if (req.nextUrl.pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.redirect(new URL('/', req.url))
    }
    return res
  }

  // Stripe /pricing paywall archived (2026-07-23). Any authenticated
  // Supabase user can use the app — no active subscription required.
  // Restore the subscription_status / team_members gate from git when
  // billing is turned back on.

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
