-- Multiple skip-trace contacts per deal.
--
-- idiCORE (and the other providers) can return several phone numbers / emails
-- for one owner. The scalar `phone` / `email` columns are kept as the primary
-- (first / best-ranked) contact for backward-compat; the new `phones` /
-- `emails` JSONB arrays hold the full de-duped lists that the CRM + owner
-- drawer now render.
--
-- Idempotent; run in the Supabase SQL editor.

alter table public.deals
  add column if not exists phones jsonb not null default '[]'::jsonb;
alter table public.deals
  add column if not exists emails jsonb not null default '[]'::jsonb;
