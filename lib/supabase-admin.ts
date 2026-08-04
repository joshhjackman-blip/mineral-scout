import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role (or anon fallback) client for Route Handlers.
 * Always bypasses Next.js fetch caching — critical for Storage signed URLs
 * and fresh reads; cached JWTs expire and break <img> tags.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: 'no-store' }),
    },
  })
}

/** Same-origin proxy URL for a Raw-Data/pad-imagery object. */
export function padImageryProxyUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const key = path.replace(/^\/+/, '').trim()
  if (!key || key.includes('..') || !key.startsWith('pad-imagery/')) return null
  return `/api/pad-activity/image?path=${encodeURIComponent(key)}`
}
