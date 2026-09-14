-- Team-shared call outcomes on each skip-trace number.
-- Last-called / result live on deals.phone_activity; the log table
-- keeps a history. connected_phone is the number that actually picked up.
-- needs_phone marks a skip-trace that came back empty.
--
-- Idempotent; run in the Supabase SQL editor.

alter table public.deals
  add column if not exists phone_activity jsonb not null default '{}'::jsonb;
alter table public.deals
  add column if not exists connected_phone text;
alter table public.deals
  add column if not exists needs_phone boolean not null default false;

create table if not exists public.deal_phone_calls (
  id uuid primary key default gen_random_uuid(),
  team_owner_id uuid not null,
  deal_id uuid not null references public.deals(id) on delete cascade,
  phone_key text not null,
  phone_display text not null,
  outcome text not null
    check (outcome in ('no_answer', 'voicemail', 'connected', 'wrong_number', 'busy', 'do_not_call')),
  called_at timestamptz not null default now(),
  called_by uuid,
  called_by_name text
);

create index if not exists deal_phone_calls_deal_called
  on public.deal_phone_calls (deal_id, called_at desc);
create index if not exists deal_phone_calls_team_deal
  on public.deal_phone_calls (team_owner_id, deal_id);

alter table public.deal_phone_calls enable row level security;

drop policy if exists "deal_phone_calls_team_all" on public.deal_phone_calls;
create policy "deal_phone_calls_team_all"
  on public.deal_phone_calls
  for all
  to authenticated
  using (team_owner_id = public.current_workspace_id())
  with check (team_owner_id = public.current_workspace_id());

revoke all on public.deal_phone_calls from public;
revoke all on public.deal_phone_calls from anon;
grant select, insert, update, delete on public.deal_phone_calls to authenticated;
grant all on public.deal_phone_calls to service_role;
