import { createBrowserClient } from '@supabase/ssr'

// Browser singleton used by the map + /auth. Must stay on @supabase/ssr
// (same package as middleware) so cookie names/encoding match and
// sessions survive full reloads after a Vercel deploy.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)
