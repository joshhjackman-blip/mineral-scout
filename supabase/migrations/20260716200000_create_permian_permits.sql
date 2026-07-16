-- Mirror of gonzales_permits / howard_permits / martin_permits (see
-- 20260331030000_create_permits_table.sql and 20260716010000_create_howard_martin_permits.sql)
-- for the 10 new Permian counties added earlier this week:
--
--   Crane, Glasscock, Loving, Midland, Pecos, Reagan,
--   Reeves, Upton, Ward, Winkler
--
-- After this migration lands, scripts/scrape_rrc_permits.py can upsert
-- rows for every one of these counties. The RRC daily scrape workflow
-- (.github/workflows/rrc-permits-daily.yml) already lists them all in
-- its `counties` default so the next scheduled run picks them up.

DO $$
DECLARE
  county text;
  counties text[] := ARRAY[
    'crane', 'glasscock', 'loving', 'midland', 'pecos',
    'reagan', 'reeves', 'upton', 'ward', 'winkler'
  ];
BEGIN
  FOREACH county IN ARRAY counties LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS public.%I (
        id SERIAL PRIMARY KEY,
        permit_number TEXT,
        api_number TEXT,
        operator_name TEXT,
        lease_name TEXT,
        county_code TEXT,
        latitude NUMERIC,
        longitude NUMERIC,
        permit_type TEXT,
        status TEXT,
        filed_date TEXT,
        approved_date TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    $sql$, county || '_permits');

    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;',
      county || '_permits'
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS "allow all permits" ON public.%I;',
      county || '_permits'
    );
    EXECUTE format(
      'CREATE POLICY "allow all permits" ON public.%I FOR ALL USING (true);',
      county || '_permits'
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (api_number);',
      'idx_' || county || '_permits_api_number',
      county || '_permits'
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (operator_name);',
      'idx_' || county || '_permits_operator_name',
      county || '_permits'
    );
  END LOOP;
END $$;
