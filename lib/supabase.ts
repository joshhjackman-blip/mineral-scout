import { createClient } from '@/lib/supabase/client'

// Browser singleton used by the map + /auth. Must stay on the same
// @supabase/ssr createBrowserClient instance as every other client page
// so cookie refresh cannot race against a second package copy.
export const supabase = createClient()
