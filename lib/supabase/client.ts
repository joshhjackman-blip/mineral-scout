import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser Supabase client. Always import from here (or `@/lib/supabase`)
 * — never from `@supabase/auth-helpers-nextjs` directly.
 *
 * auth-helpers-nextjs@0.15 is a republish of @supabase/ssr but lives in a
 * separate node_modules folder with its own module-level singleton. Mixing
 * the two packages gives the app two GoTrue clients that both auto-refresh
 * the same cookie, burn the single-use refresh token, and force a re-login
 * on every hard reload (including every production deploy).
 */
export function createClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables.')
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
