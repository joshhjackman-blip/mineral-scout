-- GRANT SELECT alone is not enough. CREATE TABLE (LIKE howard INCLUDING ALL)
-- copies RLS enablement but NOT policies, so the publishable key sees
-- content-range */0 on glasscock / reeves / pecos even after GRANT succeeds.
-- Recreate the read policy and grant to anon, authenticated, and public.

grant usage on schema public to anon, authenticated, public;

do $$
declare
  tbl text;
  tables text[] := array[
    'glasscock_mineral_ownership', 'glasscock_wells',
    'reeves_mineral_ownership', 'reeves_wells',
    'pecos_mineral_ownership', 'pecos_wells',
    'howard_wells',
    'martin_wells'
  ];
begin
  foreach tbl in array tables loop
    if not exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = tbl
    ) then
      raise notice 'Skipping %: table does not exist yet', tbl;
      continue;
    end if;
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
