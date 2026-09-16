-- Glasscock (48173), Reeves (48389), Pecos (48371) ownership + wells.
-- Permits tables already exist from 20260716200000_create_permian_permits.sql.
--
-- Mirror Howard via LIKE INCLUDING ALL. Idempotent.

create table if not exists public.glasscock_mineral_ownership
  (like public.howard_mineral_ownership including all);
create table if not exists public.glasscock_wells
  (like public.howard_wells including all);

create table if not exists public.reeves_mineral_ownership
  (like public.howard_mineral_ownership including all);
create table if not exists public.reeves_wells
  (like public.howard_wells including all);

create table if not exists public.pecos_mineral_ownership
  (like public.howard_mineral_ownership including all);
create table if not exists public.pecos_wells
  (like public.howard_wells including all);

create extension if not exists pg_trgm;

do $$
declare
  tbl text;
  tables text[] := array[
    'glasscock_mineral_ownership',
    'reeves_mineral_ownership',
    'pecos_mineral_ownership'
  ];
begin
  foreach tbl in array tables loop
    execute format(
      'create index if not exists idx_%s_abstract on public.%I (abstract);',
      replace(tbl, '_mineral_ownership', ''),
      tbl
    );
    execute format(
      'create index if not exists idx_%s_owner_name on public.%I (owner_name);',
      replace(tbl, '_mineral_ownership', ''),
      tbl
    );
    execute format(
      'create index if not exists idx_%s_owner_name_trgm on public.%I using gin (owner_name gin_trgm_ops);',
      replace(tbl, '_mineral_ownership', ''),
      tbl
    );
    execute format(
      'create index if not exists idx_%s_owner_acreage on public.%I (owner_name, acreage desc nulls last);',
      replace(tbl, '_mineral_ownership', ''),
      tbl
    );
  end loop;
end $$;

do $$
declare
  tbl text;
  tables text[] := array[
    'glasscock_mineral_ownership', 'glasscock_wells',
    'reeves_mineral_ownership', 'reeves_wells',
    'pecos_mineral_ownership', 'pecos_wells'
  ];
begin
  foreach tbl in array tables loop
    if not exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = tbl
    ) then
      continue;
    end if;
    execute format('alter table public.%I enable row level security;', tbl);
    execute format('drop policy if exists "allow read all" on public.%I;', tbl);
    execute format(
      'create policy "allow read all" on public.%I for select using (true);', tbl
    );
    execute format(
      'grant select on public.%I to anon, authenticated;',
      tbl
    );
  end loop;
end $$;
