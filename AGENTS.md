# PharmaTrace

## Cursor Cloud specific instructions

### Overview

PharmaTrace is a Next.js 14 (App Router) application using TypeScript, Tailwind CSS, and shadcn/ui. It uses Supabase (cloud-hosted) for auth, database, and storage. The project is currently in Phase 1 (scaffold + auth + dashboard shell). There is no Python backend, Docker, or database migrations yet.

### Running the app

- **Dev server:** `npm run dev` (port 3000)
- **Build:** `npm run build`
- **Lint:** `npm run lint`

All standard commands are in `package.json` scripts.

### Environment variables

A `.env.local` file is required with at least `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See `.env.local.example` for the full list. Without these env vars, server components that create a Supabase client will throw, and the middleware will redirect all protected routes to login.

With placeholder/invalid Supabase credentials the app renders correctly but auth API calls (login/signup) will fail at runtime. To test auth flows end-to-end, real Supabase project credentials are required.

### Gotchas

- The root page (`/`) always redirects: to `/dashboard` if authenticated, or to `/auth/login` otherwise.
- Middleware guards `/dashboard/*`, `/suppliers/*`, `/coa/*` — these all redirect to `/auth/login` without a valid session.
- The login and signup pages are server components that call `supabase.auth.getUser()` before rendering; if Supabase env vars are completely absent (not just invalid), these pages will throw an error instead of rendering.
