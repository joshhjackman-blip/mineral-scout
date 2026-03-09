# PharmaTrace

## Cursor Cloud specific instructions

### Overview
PharmaTrace is a B2B SaaS platform for compounding pharmacies (Next.js 14 App Router + Supabase). Currently in early Phase 1 — scaffold, auth, and dashboard shell. See `.cursorrules` for full product context and build phases.

### Running the app
- **Dev server:** `npm run dev` (port 3000)
- **Lint:** `npm run lint`
- **Build:** `npm run build`
- Standard npm scripts are in `package.json`.

### Supabase dependency
The app requires a hosted Supabase instance. Two env vars are **mandatory** for any page to render:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Without them, `lib/supabase/server.ts` and `lib/supabase/client.ts` throw on client creation. The middleware (`middleware.ts`) gracefully redirects to `/auth/login` if they're missing, but server-rendered pages (including `/auth/login` itself) will crash.

A `.env.local` with placeholder values allows the dev server to start and the UI to render, but auth flows (login/signup) will fail with "Failed to fetch" since the placeholder URL is unreachable. To test auth end-to-end, provide real Supabase project credentials.

### Routes
- `/` — redirects to `/dashboard` (authenticated) or `/auth/login` (unauthenticated)
- `/auth/login`, `/auth/signup` — public auth pages
- `/dashboard/*`, `/suppliers/*`, `/coa/*` — protected by auth middleware
