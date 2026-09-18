-- Crane (48103) ownership + wells.
-- Permits table already exists from 20260716200000_create_permian_permits.sql.
--
-- Mirror Howard. Unique index names so LIKE-copied Howard indexes
-- cannot collide (same lesson as Glasscock / Reeves / Pecos).
--
-- Safe to re-run. Run in the Supabase SQL editor if the migration
-- runner is not wired for this project.

create table if not exists public.crane_mineral_ownership
  (like public.howard_mineral_ownership including all);
create table if not exists public.crane_wells
  (like public.howard_wells including all);

create extension if not exists pg_trgm;

create index if not exists idx_crane_mo_abstract
  on public.crane_mineral_ownership (abstract);
create index if not exists idx_crane_mo_owner_name
  on public.crane_mineral_ownership (owner_name);
create index if not exists idx_crane_mo_owner_name_trgm
  on public.crane_mineral_ownership using gin (owner_name gin_trgm_ops);
create index if not exists idx_crane_mo_owner_acreage
  on public.crane_mineral_ownership (owner_name, acreage desc nulls last);
create index if not exists idx_crane_mo_rrc_lease_id
  on public.crane_mineral_ownership (rrc_lease_id);

grant usage on schema public to anon, authenticated, public;

do $$
declare
  tbl text;
  tables text[] := array['crane_mineral_ownership', 'crane_wells'];
begin
  foreach tbl in array tables loop
    execute format('alter table public.%I enable row level security;', tbl);
    execute format('drop policy if exists "allow read all" on public.%I;', tbl);
    execute format(
      'create policy "allow read all" on public.%I for select using (true);',
      tbl
    );
    execute format(
      'grant select on public.%I to anon, authenticated, public;',
      tbl
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
