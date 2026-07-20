-- Hotfix — anon key needs read access to <county>_wells so the
-- All-Counties sidebar's "Active wells" stat card and any other
-- browser-driven wells count / lookup returns the real number
-- instead of silently rendering 0.
--
-- Symptom that motivated this: Martin's tract-mode sidebar showed
-- "0 Active wells" on 2026-07-20 even though martin_wells has
-- ~17,309 rows. The sidebar's per-county live loader (see
-- app/page.tsx `perCounty` in useEffect) runs
--   supabase.from('martin_wells').select('id', { count: 'exact', head: true })
-- against the anon key. Martin's wells table was created via
-- `LIKE public.howard_wells INCLUDING ALL` in
-- 20260525000000_create_martin_tables.sql; Howard's table had
-- RLS enabled without an anon-facing policy, so the count query
-- returns 0 with no error (RLS silently filters every row).
--
-- Same "allow read all" pattern as
-- 20260716260000_allow_anon_read_mineral_ownership.sql. Wrapped
-- in a DO block so counties whose wells table doesn't exist yet
-- (the 10 upcoming Permian counties) don't blow up the migration.

DO $$
DECLARE
  county text;
  tbl text;
  counties text[] := ARRAY[
    'gonzales', 'howard', 'martin',
    'crane', 'glasscock', 'loving', 'midland', 'pecos',
    'reagan', 'reeves', 'upton', 'ward', 'winkler'
  ];
BEGIN
  FOREACH county IN ARRAY counties LOOP
    tbl := county || '_wells';
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = tbl
    ) THEN
      RAISE NOTICE 'Skipping %: table does not exist yet', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);

    EXECUTE format(
      'DROP POLICY IF EXISTS "allow read all" ON public.%I;', tbl
    );
    EXECUTE format(
      'CREATE POLICY "allow read all" ON public.%I FOR SELECT USING (true);',
      tbl
    );
  END LOOP;
END $$;
