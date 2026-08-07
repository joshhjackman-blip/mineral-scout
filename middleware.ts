import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isPlatformAdmin } from '@/lib/team'

/**
 * Session refresh + route gates.
 *
 * Important: every deploy causes a full document load (stale Next chunks).
 * That hits this middleware, which must refresh the Supabase access token
 * and write the new cookies onto the *same* response we return.
 *
 * The previous version used getSession() and built NextResponse.redirect()
 * without copying refreshed cookies — so after an update the browser kept
 * an expired access token, middleware treated you as logged out, and you
 * landed on /landing again.
 *
 * Pattern follows the current @supabase/ssr Next.js guide:
 * create client → getUser() immediately → return the cookie-bearing response
 * (or a redirect that clones those cookies).
 */
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            req.cookies.set(name, value)
          })
          res = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  // Must run before any redirects — this is what refreshes the JWT and
  // triggers setAll above. Do not put logic between createServerClient
  // and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const redirectWithCookies = (url: URL) => {
    const redirect = NextResponse.redirect(url)
    // Preserve refreshed auth cookies on redirects — returning a brand
    // new NextResponse.redirect() without this drops the rotated JWT
    // and the next request looks logged-out.
    res.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie)
    })
    return redirect
  }

  const isPublicPage =
    req.nextUrl.pathname.startsWith('/auth') ||
    req.nextUrl.pathname.startsWith('/landing') ||
    req.nextUrl.pathname.startsWith('/pricing') ||
    req.nextUrl.pathname.startsWith('/demo') ||
    req.nextUrl.pathname.startsWith('/book-demo')
  const isApiRoute = req.nextUrl.pathname.startsWith('/api')

  if (!user && !isPublicPage && !isApiRoute) {
    return redirectWithCookies(new URL('/landing', req.url))
  }

  if (user && req.nextUrl.pathname.startsWith('/auth')) {
    return redirectWithCookies(new URL('/', req.url))
  }

  const isAdminPath =
    req.nextUrl.pathname.startsWith('/admin') ||
    req.nextUrl.pathname.startsWith('/owner') ||
    req.nextUrl.pathname.startsWith('/api/admin')
  const isAdmin = isPlatformAdmin(
    user?.user_metadata as Record<string, unknown> | undefined,
    user?.email,
  )

  if (isAdminPath) {
    if (!user || !isAdmin) {
      if (req.nextUrl.pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return redirectWithCookies(new URL('/', req.url))
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
