-- Hotfix — anon key needs read access to <county>_mineral_ownership so
-- the OwnerDrawer's Leases tab can list a lead's holdings. The tract
-- sidebar's owner list works today because it reads from the
-- pre-baked <county>_parcels_enriched.geojson served as a static file
-- (bypasses RLS); the drawer's per-owner Supabase query got silently
-- filtered to zero rows.
--
-- Matches the "allow all" pattern the earlier permits + tract-status
-- migrations already use. Wrap in a DO block so counties whose
-- ownership table doesn't exist yet don't blow up.

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
    tbl := county || '_mineral_ownership';
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
