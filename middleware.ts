import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * Session refresh + route gates for document navigations only.
 *
 * /api/* is intentionally excluded from the matcher. After a Vercel
 * deploy the browser hard-reloads and fires many parallel API calls;
 * running getClaims()/token refresh in middleware for each of those
 * races Supabase's single-use refresh tokens and silently logs users out.
 * API routes authenticate themselves via their own cookie clients.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match page navigations, skip:
     * - _next/static, _next/image, favicon
     * - /api/* (avoids refresh-token races on parallel fetches)
     * - files with extensions (images, geojson, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\..*).*)',
  ],
}
