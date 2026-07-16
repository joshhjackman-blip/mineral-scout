## Environment variables

Copy `.env.local.example` to `.env.local` (or set them in Vercel /
GitHub Actions secrets) before running any script that talks to
Supabase or Anthropic.

Key ones for Ticket 1.3 (PUD / development-status tracking):

| Var | Where it's read | Notes |
|---|---|---|
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | Every ingest + compute script + the app | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Ingest + compute scripts, `/api/legal/*`, `/api/export` | required for tables under RLS |
| `ANTHROPIC_API_KEY` | `scripts/agent_operator_dev_programs.py` (Phase 3 operator agent) | quarterly job — cron uses the Batch API |
| `ANTHROPIC_MODEL` | Every Claude call in this repo | Defaults to `claude-haiku-4-5` per Ticket 1.3 §6 ("keep spend minimal"). Bump per-job with `--model` on the CLI when a specific run needs a stronger model. **Never hardcode a model string** in application code. |

The operator agent's cron path forces the [Anthropic Batch API](https://docs.anthropic.com/en/docs/build-with-claude/batch-processing)
for the 50% discount; pass `--realtime` locally when you need streamed
completions during iteration.

## Getting Started

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
