-- Read policies for the 5 new Permian counties' tables.
--
-- The earlier allow-read migrations (e.g. 20260716260000) looped these county
-- names but SKIPPED them because their tables didn't exist yet. The tables were
-- later created via `CREATE TABLE ... (LIKE howard_* INCLUDING ALL)`, which
-- copies RLS *enablement* but NOT policies — so anon/authenticated reads get
-- silently filtered to zero rows. Symptoms: "Total owners: 0" on the county
-- overview, empty owner search / OwnerDrawer holdings, and empty /permits for
-- these counties. (The tract owner list still worked because it comes from the
-- static enriched GeoJSON / the service-role /api/tract-owners route.)
--
-- Idempotent: safe to re-run. Run in the Supabase SQL editor.

DO $$
DECLARE
  county text;
  suffix text;
  tbl text;
  counties text[] := ARRAY['midland', 'loving', 'reagan', 'upton', 'ward'];
  suffixes text[] := ARRAY['_mineral_ownership', '_wells', '_permits'];
BEGIN
  FOREACH county IN ARRAY counties LOOP
    FOREACH suffix IN ARRAY suffixes LOOP
      tbl := county || suffix;
      IF NOT EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
      ) THEN
        RAISE NOTICE 'Skipping %: table does not exist yet', tbl;
        CONTINUE;
      END IF;
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "allow read all" ON public.%I;', tbl);
      EXECUTE format(
        'CREATE POLICY "allow read all" ON public.%I FOR SELECT USING (true);', tbl
      );
    END LOOP;
  END LOOP;
END $$;
