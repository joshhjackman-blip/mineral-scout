import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isPlatformAdmin } from '@/lib/team'

function applyNoStore(response: NextResponse) {
  // Prevent CDNs / shared caches from storing auth-bearing responses.
  // Newer @supabase/ssr docs pass these via setAll's second arg; 0.9.0
  // types only expose the cookies array, so we set them ourselves.
  response.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate')
  response.headers.set('Expires', '0')
  response.headers.set('Pragma', 'no-cache')
}

/**
 * Refresh + gate the Supabase session for document navigations.
 *
 * Follows the current @supabase/ssr Next.js proxy pattern:
 * - getClaims() (not getUser/getSession) so we verify the JWT and only
 *   refresh when the access token is near expiry
 * - no-store headers so CDNs never cache auth responses
 * - when redirecting a logged-in user, copy refreshed cookies onto the
 *   redirect response
 * - when redirecting a logged-out user, do NOT copy cookies — a failed
 *   single-use refresh race can call setAll with cleared cookies, and
 *   forwarding those would permanently wipe a still-valid browser session
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options)
          })
          applyNoStore(supabaseResponse)
        },
      },
    },
  )

  // Do not put logic between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims ?? null
  const email = typeof claims?.email === 'string' ? claims.email : null
  const metadata =
    claims &&
    typeof claims.user_metadata === 'object' &&
    claims.user_metadata !== null
      ? (claims.user_metadata as Record<string, unknown>)
      : null
  const isLoggedIn = Boolean(claims?.sub)

  const redirectLoggedIn = (url: URL) => {
    const redirect = NextResponse.redirect(url)
    // Preserve rotated auth cookies from the refresh.
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie.name, cookie.value)
    })
    applyNoStore(redirect)
    return redirect
  }

  // Logged-out redirect: brand-new response, no cookie copy. Forwarding
  // supabaseResponse cookies here is what turned refresh races into
  // "logged out after every deploy".
  const redirectLoggedOut = (url: URL) => {
    const redirect = NextResponse.redirect(url)
    applyNoStore(redirect)
    return redirect
  }

  const path = request.nextUrl.pathname
  const isPublicPage =
    path.startsWith('/auth') ||
    path.startsWith('/landing') ||
    path.startsWith('/pricing') ||
    path.startsWith('/demo') ||
    path.startsWith('/book-demo')

  if (!isLoggedIn && !isPublicPage) {
    return redirectLoggedOut(new URL('/landing', request.url))
  }

  if (isLoggedIn && path.startsWith('/auth')) {
    return redirectLoggedIn(new URL('/', request.url))
  }

  const isAdminPath = path.startsWith('/admin') || path.startsWith('/owner')
  if (isAdminPath) {
    const isAdmin = isPlatformAdmin(metadata, email)
    if (!isAdmin) {
      return redirectLoggedIn(new URL('/', request.url))
    }
  }

  applyNoStore(supabaseResponse)
  return supabaseResponse
}
