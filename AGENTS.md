# AGENTS.md

## Cursor Cloud specific instructions

### Overview

PharmaTrace is a single Next.js 14 (App Router) application — no monorepo, no Docker, no Python scripts yet (planned for Phase 2+). The only external service wired into code is **Supabase** (auth + future DB).

### Running the app

- `npm run dev` starts the Next.js dev server on `http://localhost:3000`.
- `npm run lint` runs ESLint; `npm run build` runs a full production build with type-checking.
- See `package.json` scripts for the full list.

### Environment variables

A `.env.local` file is required. Copy `.env.local.example` as a starting point. The two critical variables are:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Without these, every page that calls `createClient()` (root `/`, login, signup, middleware) will throw. Placeholder values allow the framework to render pages, but real Supabase credentials are needed for auth to function.

### Auth & routing

- The middleware (`middleware.ts`) protects `/dashboard/*`, `/suppliers/*`, and `/coa/*`. Unauthenticated users are redirected to `/auth/login`.
- The root page (`/`) redirects authenticated users to `/dashboard` and unauthenticated users to `/auth/login`.
- Login/signup forms call Supabase Auth directly from client components.

### Gotchas

- The project uses Next.js **14.2.x** (not 15), so App Router conventions match the v14 docs.
- `@supabase/ssr` is used for both server and client Supabase clients (not the older `@supabase/auth-helpers-nextjs`).
- No automated test framework (jest/vitest/playwright) is configured yet.
