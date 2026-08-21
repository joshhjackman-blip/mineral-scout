# Mineral Map

Ownership intelligence for Texas mineral brokers — a [Next.js 14](https://nextjs.org) (App Router)
application with a Mapbox map, CRM, billing, and a set of Python data-ingestion
scripts. Data and auth are backed by [Supabase](https://supabase.com).

## Getting Started

### 1. Install dependencies

Node.js 18.17+ is required (CI and the Cloud Agent environment use Node 22). The
project uses **npm** with a committed `package-lock.json`:

```bash
npm ci
```

### 2. Configure environment variables

Copy the template and fill in values:

```bash
cp .env.local.example .env.local
```

At minimum the app needs a Supabase project to boot — the browser and middleware
clients throw on startup if these are missing:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The interactive map additionally needs a Mapbox token:

- `NEXT_PUBLIC_MAPBOX_TOKEN`

Server-side features (admin routes, cron scrapers, billing, email, skip-trace)
need the remaining keys documented in `.env.local.example` — `SUPABASE_SERVICE_ROLE_KEY`,
`STRIPE_*`, `RESEND_API_KEY`, etc. For local development you will usually also want:

```bash
AGREEMENT_GATE_ENABLED=false   # skip the Platform Services Agreement gate
BILLING_PAYWALL_ENABLED=false  # skip the /pricing paywall redirect
```

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Unauthenticated visitors are
redirected to `/landing`; sign in via `/auth`.

## Common commands

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Start (after build) | `npm run start` |
| Lint | `npm run lint` |
| Type-check | `npx tsc --noEmit` |

## Database

PostgreSQL schema lives in `supabase/migrations/` and is applied to a hosted
Supabase project (via the Supabase CLI or dashboard). County data is loaded by
the Python scripts under `scripts/`.

## Python data scripts

Ingestion / enrichment pipelines live in `scripts/` and run under Python 3.12.
The weekly pad-activity pipeline pins its dependencies in
`scripts/pad_activity/requirements.txt`.

## Deploy

The Next.js app deploys to Vercel; cron schedules are defined in `vercel.json`.
